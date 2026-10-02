/**
 * ocrEngine.js
 * Handles text, numeric extraction, and regex parsing for Tap Titans 2 screenshots.
 */

/**
 * Helper function to instantiate a Tesseract worker, run OCR on a canvas crop, and cleanly close the worker.
 * @param {HTMLCanvasElement} canvasCrop - The isolated section of the screenshot
 * @param {string} whitelist - Optional character whitelist to reduce recognition errors
 */
async function processCrop(canvasCrop, whitelist = '') {
    // Pass the target language code directly into the initialization constructor
    const worker = await Tesseract.createWorker('eng');
    
    if (whitelist) {
        await worker.setParameters({ 
            tessedit_char_whitelist: whitelist 
        });
    }

    const { data: { text } } = await worker.recognize(canvasCrop);
    await worker.terminate();
    return text;
}

/**
 * Helper to dynamically create a canvas slice from a larger master image element
 */
function createCropCanvas(imgElement, startXPct, startYPct, widthPct, heightPct) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const w = imgElement.naturalWidth;
    const h = imgElement.naturalHeight;
    
    canvas.width = Math.round(widthPct * w);
    canvas.height = Math.round(heightPct * h);
    
    ctx.drawImage(
        imgElement, 
        Math.round(startXPct * w), Math.round(startYPct * h), canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height
    );
    
    return canvas;
}

/**
 * Sweeps the 8 titan parts to extract remaining health string values.
 * @param {HTMLImageElement} raidImgElement - The uploaded raid screen
 * @returns {Promise<Object>} Map of parts to their scanned health strings (e.g., { head: "3.96B" })
 */
async function parsePartHealthPools(raidImgElement, bounds) {
    // Centered directly on the health bar rectangles.
    // 'x' = left edge of health bar rectangle
    // 'y' = vertical center of health bar rectangle
    const PART_HEALTH_TEXT_CROPS = {
        head:           { x: 0.420, y: 0.273, w: 0.14, h: 0.016 },
        leftShoulder:   { x: 0.245, y: 0.292, w: 0.14, h: 0.016 },
        rightShoulder:  { x: 0.607, y: 0.290, w: 0.14, h: 0.016 },
        leftArm:        { x: 0.243, y: 0.376, w: 0.14, h: 0.016 },
        rightArm:       { x: 0.605, y: 0.378, w: 0.14, h: 0.016 },
        torso:          { x: 0.423, y: 0.358, w: 0.14, h: 0.016 },
        leftLeg:        { x: 0.348, y: 0.438, w: 0.14, h: 0.016 },
        rightLeg:       { x: 0.505, y: 0.435, w: 0.14, h: 0.016 }
    };

    const healthPools = {};
    // Initialize a single shared worker outside the loop to handle all 8 parts
    const sharedWorker = await Tesseract.createWorker('eng');
    await sharedWorker.setParameters({
      tessedit_char_whitelist: '0123456789.MBKmbk'
    });
    
    // Locate the canvas drawing loop inside parsePartHealthPools inside modules/ocrEngine.js and match this structure:
    for (const [partName, cropMap] of Object.entries(PART_HEALTH_TEXT_CROPS)) {
        const cX = Math.round(cropMap.x * raidImgElement.naturalWidth);
        const cY = Math.round((cropMap.y * bounds.height) + bounds.top - (cropMap.h * bounds.height / 2));
        const cW = Math.round(cropMap.w * raidImgElement.naturalWidth);
        const cH = Math.round(cropMap.h * bounds.height);
    
        const textCrop = document.createElement('canvas');
        textCrop.width = cW; textCrop.height = cH;
        const tCtx = textCrop.getContext('2d');
        tCtx.drawImage(raidImgElement, cX, cY, cW, cH, 0, 0, cW, cH);

        /**
         * Use a two-pass color isolation approach. It crops the target area, performs an initial OCR pass, 
         * and either applies a fallback brightness threshold if no words are found or samples pixel 
         * color from the first detected word to apply a tolerance-based color mask for improved accuracy
         * before sanitizing the final text output
        */
        // Run Pass 1 to detect word objects on the current cropped area
        const pass1Result = await sharedWorker.recognize(textCrop);
        const words = pass1Result.data.words;
        console.log('Part name: ', partName, ', Health text from first pass: ', words);
        const imgData = tCtx.getImageData(0, 0, cW, cH);
        const d = imgData.data;
        
        if (words && words.length > 0) {
          // Extract structural coordinates of the first found word object
          const sampleWord = words[0].bbox;
          
          // Calculate center coordinates safely inside the word frame
          const sampleX = Math.floor(sampleWord.x0 + (sampleWord.x1 - sampleWord.x0) / 2);
          const sampleY = Math.floor(sampleWord.y0 + (sampleWord.y1 - sampleWord.y0) / 2);
          
          // Clamp boundaries to prevent image pixel array buffer overflows
          const clampX = Math.max(0, Math.min(cW - 1, sampleX));
          const clampY = Math.max(0, Math.min(cH - 1, sampleY));
          
          // Calculate target RGB index inside canvas array frame
          const pixelIndex = (clampY * cW + clampX) * 4;
          const targetRGB = {
            r: d[pixelIndex],
            g: d[pixelIndex + 1],
            b: d[pixelIndex + 2]
          };
          
          const tolerance = 45;
        
          // Process image byte structure using color distance masking
          for (let i = 0; i < d.length; i += 4) {
            const colorDistance = Math.sqrt(
              Math.pow(d[i] - targetRGB.r, 2) +
              Math.pow(d[i + 1] - targetRGB.g, 2) +
              Math.pow(d[i + 2] - targetRGB.b, 2)
            );
            
            // Convert match regions to solid white, everything else to solid black
            const matchVal = colorDistance < tolerance ? 255 : 0;
            d[i] = matchVal;
            d[i + 1] = matchVal;
            d[i + 2] = matchVal;
          }
        } else {
          // FALLBACK: Use your original brightness threshold method if pass 1 fails
          for (let i = 0; i < d.length; i += 4) {
            const brightness = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
            const fallbackVal = brightness > 160 ? 255 : 0;
            d[i] = fallbackVal;
            d[i + 1] = fallbackVal;
            d[i + 2] = fallbackVal;
          }
        }
        
        // Write the high-contrast binary data map back into the canvas
        tCtx.putImageData(imgData, 0, 0);

        // --- PASS 2: Recognize complete text on the isolated mask image ---
        const pass2Result = await sharedWorker.recognize(textCrop);
        let cleanText = pass2Result.data.text.trim().toUpperCase().replace(/\s+/g, '');
        
        const validMetricRegex = /^[0-9]+(\.[0-9]+)?[MBKmbk]?$/;
        if (!cleanText || !validMetricRegex.test(cleanText)) {
          healthPools[partName] = "Missing Bar / Skeleton";
        } else {
          healthPools[partName] = cleanText;
        }
    }
    // Terminate the shared worker instance after completing all passes
    await sharedWorker.terminate();
    return healthPools;
}

/**
 * 1 & 3. Processes raid.jpg to extract Titan Name (via Lookup) and Build Morale value
 * @param {HTMLImageElement} raidImgElement 
 * @param {Object} bounds - Content boundaries from pixelReader.js
 */
export async function parseRaidImage(raidImgElement, bounds) {
    // Crop out the part of image containing titan lord name
    const nameCropX = Math.round(0.229 * raidImgElement.naturalWidth);
    const nameCropY = Math.round(0.199 * bounds.height) + bounds.top;
    const nameCropW = Math.round(0.701 * raidImgElement.naturalWidth);
    const nameCropH = Math.round(0.024 * bounds.height);

    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = nameCropW; nameCanvas.height = nameCropH;
    nameCanvas.getContext('2d').drawImage(raidImgElement, nameCropX, nameCropY, nameCropW, nameCropH, 0, 0, nameCropW, nameCropH);

    // Crop out the part of image containing morale bonus
    const moraleCropX = Math.round(0.599 * raidImgElement.naturalWidth);
    const moraleCropY = Math.round(0.528 * bounds.height) + bounds.top; 
    const moraleCropW = Math.round(0.332 * raidImgElement.naturalWidth);
    const moraleCropH = Math.round(0.024 * bounds.height); // Capture the whole center spectrum at once
    
    const moraleCanvas = document.createElement('canvas');
    moraleCanvas.width = moraleCropW; moraleCanvas.height = moraleCropH;
    moraleCanvas.getContext('2d').drawImage(raidImgElement, moraleCropX, moraleCropY, moraleCropW, moraleCropH, 0, 0, moraleCropW, moraleCropH);

    // Run parallel OCR loops
    const rawTopText = await processCrop(nameCanvas);
    const rawMoraleText = await processCrop(moraleCanvas);
    const partHealthPools = await parsePartHealthPools(raidImgElement, bounds);

    // There are 8 possible Titan Lords in a clan raid + tokens for partial matching
    const TITAN_LORDS_REGISTRY = [
        { officialName: "Lojak the Fissure", tokens: ["loja", "ojak", "fiss", "ssur"] },
        { officialName: "Takedar the Reborn", tokens: ["take", "keda", "rebo", "born"] },
        { officialName: "Jukk the Overseer", tokens: ["jukk", "over", "seer"] },
        { officialName: "Sterl the Unmaker", tokens: ["ster", "unma", "make"] },
        { officialName: "Mohaca the Gale", tokens: ["moha", "haca", "gale"] },
        { officialName: "Terro the Seeker", tokens: ["terr", "erro", "seek"] },
        { officialName: "Klonk the Illuminator", tokens: ["klon", "lonk", "illu", "umin"] },
        { officialName: "Priker the Otherworldly", tokens: ["prik", "rike", "othe", "worl"] }
    ];

    let titanLordName = "Unknown Titan";
    // Strip punctuation and normalize string to protect against spacing bugs
    const normalizedScannedText = rawTopText.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Search text for registry signatures
    for (const lord of TITAN_LORDS_REGISTRY) {
        // If any token matches a clean segment inside the scanned output, resolve the profile name
        const matchFound = lord.tokens.some(token => normalizedScannedText.includes(token));
        if (matchFound) {
            titanLordName = lord.officialName; // Force snap to clean official string formatting!
            break;
        }
    }

    // print to console for debugging purposes
    console.log(normalizedScannedText);
    console.log('rawMoraleText: ', rawMoraleText);
 
    let moraleValue = rawMoraleText.match(/\+(\d+\.\d+%)\s*Bonus Damage/)[1];

    return {
        titanLordName: titanLordName,
        moraleBonus: moraleValue,
        partHealthPools: partHealthPools
    };
}


/**
 * 4 & 5. Processes info.jpg to extract Green Raid Bonus and Target Titan Stats
 * @param {HTMLImageElement} infoImgElement - The uploaded information panel image
 * @param {string} targetTitanName - The name extracted from the raid image (e.g., "Klonk the Illuminator")
 */
export async function parseInfoImage(infoImgElement, targetTitanName) {
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = infoImgElement.naturalWidth;
    fullCanvas.height = infoImgElement.naturalHeight;
    fullCanvas.getContext('2d').drawImage(infoImgElement, 0, 0);

    const fullText = await processCrop(fullCanvas);
    const lines = fullText.split('\n').map(line => line.trim()).filter(Boolean);


    let raidBonus = "Not Found";
    let stats = {
        body: { head: "N/A", torso: "N/A", arms: "N/A", legs: "N/A" },
        armor: { head: "N/A", torso: "N/A", arms: "N/A", legs: "N/A" },
        debuff: "Not Found",
        cursedArmorEffect: "Not Found"
    };

    // 2. Parse out the Raid Bonus value (typically searching for "Affliction Chance" multiplier)
    const bonusLine = lines.find(line => /Affliction\s+Chance/i.test(line) || /x[0-9.]+/i.test(line));
    if (bonusLine) {
        const bonusMatch = bonusLine.match(/(x[0-9.]+[^]*)/i);
        if (bonusMatch) raidBonus = bonusMatch[1].trim();
    }

    // 3. Find table starting block matching your target Titan Lord
    // Normalize string comparisons to defend against minor OCR typo variations
    const cleanTarget = targetTitanName.toLowerCase().replace(/[^a-z]/g, '');
    let titanIndex = lines.findIndex(line => line.toLowerCase().replace(/[^a-z]/g, '').includes(cleanTarget));

    // Fallback search using partial matching if an exact string sweep fails
    if (titanIndex === -1 && cleanTarget.length > 3) {
        const partial = cleanTarget.substring(0, 4);
        titanIndex = lines.findIndex(line => line.toLowerCase().includes(partial));
    }

    if (titanIndex !== -1) {
        // Step forward from Titan header line to capture body/armor columns and red stat modifications
        let searchWindow = lines.slice(titanIndex, titanIndex + 12);
        
        // Match numbers following Part structural labels (e.g., "Head 2.50B 1.20B")
        const rowRegex = /(Head|Torso|Arms|Legs)\s+([0-9.]+[BMK]?)\s+([0-9.]+[BMK]?)/i;
        
        searchWindow.forEach(line => {
            const match = line.match(rowRegex);
            if (match) {
                const part = match[1].toLowerCase();
                const bodyVal = match[2];
                const armorVal = match[3];
                
                if (part === 'arms' || part === 'legs') {
                    stats.body[part] = bodyVal;
                    stats.armor[part] = armorVal;
                } else {
                    stats.body[part] = bodyVal;
                    stats.armor[part] = armorVal;
                }
            }

            // Capture Red Modifier elements (Health targets & Curse damage reductions)
            if (/%?\s*Torso\s+Health/i.test(line) || /\+[0-9.]+%[^]*Health/i.test(line)) {
                stats.debuff = line;
            }
            if (/Affliction\s+Damage\s+Per\s+Curse/i.test(line) || /-[0-9.]+%[^]*Curse/i.test(line)) {
                stats.cursedArmorEffect = line;
            }
        });
    }

    return {
        raidBonus,
        titanStats: stats
    };
}
