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
        leftLeg:        { x: 0.348, y: 0.435, w: 0.14, h: 0.016 },
        rightLeg:       { x: 0.505, y: 0.435, w: 0.14, h: 0.016 }
    };

    const healthPools = {};
    
    // Recreate your file's original internal cropped canvas utility framework
    const raidCanvas = document.createElement('canvas');
    const raidCtx = raidCanvas.getContext('2d');
    raidCanvas.width = raidImgElement.naturalWidth;
    raidCanvas.height = raidImgElement.naturalHeight;
    raidCtx.drawImage(raidImgElement, 0, 0);
    
    
    // Initialize a single shared worker outside the loop to handle all 8 parts
    const sharedWorker = await Tesseract.createWorker('eng');
    await sharedWorker.setParameters({
      tessedit_char_whitelist: '0123456789.MBKmbk',
      tessedit_pageseg_mode: '7', // Treat the image strictly as a single text line (Crucial for fragments)
      load_system_dawg: '0',      // Turn off language dictionaries so numbers don't auto-correct to words
      load_freq_dawg: '0',
    });
    
    // Locate the canvas drawing loop inside parsePartHealthPools inside modules/ocrEngine.js and match this structure:
    for (const [partName, cropMap] of Object.entries(PART_HEALTH_TEXT_CROPS)) {
        const cX = Math.round(cropMap.x * raidImgElement.naturalWidth);
        const cY = Math.round((cropMap.y * bounds.height) + bounds.top - (cropMap.h * bounds.height / 2));
        const cW = Math.round(cropMap.w * raidImgElement.naturalWidth);
        const cH = Math.round(cropMap.h * bounds.height);
    
        // Setup the intermediate canvas matrix
        const textCrop = document.createElement('canvas');
        const tCtx = textCrop.getContext('2d');
    
        // APPLY 3X IMAGE UPSCALING (Gives Tesseract massive quality boost on small screen metrics)
        const scaleFactor = 3;
        textCrop.width = cW * scaleFactor;
        textCrop.height = cH * scaleFactor;
    
        // Use high-quality image smoothing during the upscale transform
        tCtx.imageSmoothingEnabled = true;
        tCtx.imageSmoothingQuality = 'high';
    
        // Draw and scale the image onto our working grid using our freshly computed absolute coordinates
        tCtx.drawImage(
          raidCanvas,
          cX, cY, cW, cH,                        // Source rectangle (computed pixel values)
          0, 0, textCrop.width, textCrop.height // Destination upscale rectangle
        );

        // --- EXACT COLOR BINARIZATION FILTERS ---
        // Color-Targeted Binarization Filter
        const imgData = tCtx.getImageData(0, 0, textCrop.width, textCrop.height);
        const d = imgData.data;
        
        // Define your target color metrics
        const targets = [
          { r: 255, g: 255, b: 255 }, // #ffffff (Pure White)
          { r: 129, g: 130, b: 162 }, // #8182a2 (Muted Blue/Grey Text)
          { r: 255, g: 255, b: 239 }, // #ffffef (Pale Yellow)
          { r: 226, g: 255, b: 255 }  // #e2ffff (Very Pale Cyan)
        ];
        
        // Compression buffer threshold (handles fuzzy edges or anti-aliasing artifacts)
        // 35 and 50 are too much? Even 20
        const colorDistanceTolerance = 15; 
        
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
        
          let matchesText = false;
        
          // Verify current pixel against each known UI text color signature
          for (const target of targets) {
            const distance = Math.sqrt(
              Math.pow(r - target.r, 2) +
              Math.pow(g - target.g, 2) +
              Math.pow(b - target.b, 2)
            );
        
            if (distance < colorDistanceTolerance) {
              matchesText = true;
              break; // Exit early if we match a text color
            }
          }
        
          // Tesseract Rule: Force text pixels to solid BLACK (0)
          // Force all non-matching background pixels to solid WHITE (255)
          const outputColor = matchesText ? 0 : 255;
        
          d[i] = outputColor;     // Red
          d[i + 1] = outputColor; // Green
          d[i + 2] = outputColor; // Blue
        }
        
        tCtx.putImageData(imgData, 0, 0);
        // --- END OF EXACT COLOR EXTRACTION ---
        
        // --- VISUAL DEBUGGER START ---
        // Check if a debug container exists on your page; if not, create one at the bottom of the body
        let debugContainer = document.getElementById('tesseract-debug-container');
        if (!debugContainer) {
          debugContainer = document.createElement('div');
          debugContainer.id = 'tesseract-debug-container';
          debugContainer.style.position = 'fixed';
          debugContainer.style.bottom = '10px';
          debugContainer.style.right = '10px';
          debugContainer.style.zIndex = '99999';
          debugContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
          debugContainer.style.color = '#fff';
          debugContainer.style.padding = '10px';
          debugContainer.style.borderRadius = '8px';
          debugContainer.style.maxHeight = '500px';
          debugContainer.style.overflowY = 'auto';
          debugContainer.style.fontFamily = 'monospace';
          debugContainer.style.fontSize = '12px';
          debugContainer.style.border = '2px solid #ff4444';
          document.body.appendChild(debugContainer);
          
          // Wipe out all old content ONLY when processing the very first item in the loop array
          const partKeys = Object.keys(PART_HEALTH_TEXT_CROPS);
          if (partName === partKeys[0]) {
            debugContainer.innerHTML = '<strong>OCR Preprocessing Debug Frames:</strong><br><br>';
          }
        }
        
        // Create a visual row wrapper for this specific titan part crop
        const row = document.createElement('div');
        row.style.marginBottom = '12px';
        row.style.borderBottom = '1px solid #444';
        row.style.paddingBottom = '4px';
        
        const label = document.createElement('div');
        label.innerText = `Part: ${partName} (${cW}x${cH} scaled 3x)`;
        row.appendChild(label);
        
        // Create an image snapshot of the canvas data buffer matrix
        const debugImg = document.createElement('img');
        debugImg.src = textCrop.toDataURL();
        debugImg.style.border = '1px solid #00ff00'; // Green border around the crop area frame
        debugImg.style.backgroundColor = '#fff';     // White background highlight
        debugImg.style.margin = '4px 0';
        debugImg.style.display = 'block';
        row.appendChild(debugImg);
        
        // Placeholder text element to view what text Tesseract extracts next
        const ocrTextLabel = document.createElement('div');
        ocrTextLabel.id = `debug-text-${partName}`;
        ocrTextLabel.style.color = '#ffcc00';
        ocrTextLabel.innerText = 'Extracting...';
        row.appendChild(ocrTextLabel);
        
        debugContainer.appendChild(row);
        // --- VISUAL DEBUGGER END ---

        // Convert processed canvas buffer to DataURL for Tesseract to ingest
        const processedDataUrl = textCrop.toDataURL();
        
        try {
          // 5. OCR Pass execution on the high-contrast single line text frame
          const ocrResult = await sharedWorker.recognize(processedDataUrl);
          let cleanText = ocrResult.data.text.trim().toUpperCase().replace(/\s+/g, '');
          const textLabel = document.getElementById(`debug-text-${partName}`);
          if (textLabel) textLabel.innerText = `Extracted Text: "${cleanText}"`;
    
          // Strict syntax validation regex checking for valid numbers and optional metric suffixes
          const validMetricRegex = /^[0-9]+\.[0-9]+[MBK8]?$/;
          const extraEightBeforeBRegex = /\.[0-9]{2}8B$/;
    
          if (!cleanText || !validMetricRegex.test(cleanText)) {
            healthPools[partName] = "Missing Bar / Skeleton";
          } else if (cleanText.endsWith('8')){
            // Workaround: If the scanned text ends with 8, assume that Tesseract misread "B" as "8"
            healthPools[partName] = cleanText.slice(0, -1) + 'B';
          } else if (extraEightBeforeBRegex.test(cleanText)){
            // Workaround: Sometimes Tesseract detects an extra 8 before B at the end  
            healthPools[partName] = cleanText.slice(0, -2) + 'B';  
          } else {
            healthPools[partName] = cleanText;
          }
        } catch (ocrError) {
          console.error(`OCR Extraction failed for part ${partName}:`, ocrError);
          healthPools[partName] = "Missing Bar / Skeleton";
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
export async function parseInfoImage(infoImgElement, targetTitanName, bounds) {
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

    /*
    // 2. Parse out the Raid Bonus value (typically searching for "Affliction Chance" multiplier)
    const bonusLine = lines.find(line => /Affliction\s+Chance/i.test(line) || /x[0-9.]+/i.test(line));
    if (bonusLine) {
        const bonusMatch = bonusLine.match(/(x[0-9.]+[^]*)/i);
        if (bonusMatch) raidBonus = bonusMatch[1].trim();
    }
    */

    const areaBonusCropX = Math.round(0.572 * infoImgElement.naturalWidth);
    const areaBonusCropY = Math.round(0.184 * bounds.height) + bounds.top;
    const areaBonusCropW = Math.round(0.354 * infoImgElement.naturalWidth);
    const areaBonusCropH = Math.round(0.022 * bounds.height);

    const areaBonusCanvas = document.createElement('canvas');
    areaBonusCanvas.width = areaBonusCropW; areaBonusCanvas.height = areaBonusCropH;
    areaBonusCanvas.getContext('2d').drawImage(infoImgElement, areaBonusCropX, areaBonusCropY, areaBonusCropW, areaBonusCropH, 0, 0, areaBonusCropW, areaBonusCropH);

    const areaBonusCanvasText = await processCrop(areaBonusCanvas);
    const areaBonusLines = areaBonusCanvasText.split('\n').map(line => line.trim()).filter(Boolean);

    const AREA_BONUSES = [
        "+3s Attack Duration",
        "+30% Affliction Damage",
        "+50% Affliction Duration",
        "+30% Burst Damage",
        "x1.3 Burst Chance",
        "+15% All Support Effects",
        "x1.3 Affliction Chance",
        "+15% All Raid Damage"
    ];

    for (const areaBonus of AREA_BONUSES) {
        // If any token matches a clean segment inside the scanned output, resolve the profile name
        const matchFound = areaBonusCanvasText.includes(areaBonus);
        if (matchFound) {
            raidBonus = areaBonus;
            break;
        }
    }

    console.log('Area Bonus Canvas Text: ', areaBonusCanvasText);

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
