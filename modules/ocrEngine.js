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
    // Normalized center bounding regions for where the health text overlays on the screen.
    // These are slightly wider and offset from the pure left-edge bar markers to capture the full string (e.g., "65.38M").
    const PART_HEALTH_TEXT_CROPS = {
        head:           { x: 0.38, y: 0.25, w: 0.24, h: 0.03 },
        leftShoulder:   { x: 0.18, y: 0.27, w: 0.22, h: 0.03 },
        rightShoulder:  { x: 0.60, y: 0.27, w: 0.22, h: 0.03 },
        leftArm:        { x: 0.12, y: 0.35, w: 0.22, h: 0.03 },
        rightArm:       { x: 0.66, y: 0.35, w: 0.22, h: 0.03 },
        torso:          { x: 0.38, y: 0.33, w: 0.24, h: 0.03 },
        leftLeg:        { x: 0.28, y: 0.43, w: 0.22, h: 0.03 },
        rightLeg:       { x: 0.50, y: 0.43, w: 0.22, h: 0.03 }
    };

    const healthPools = {};
    for (const [partName, cropMap] of Object.entries(PART_HEALTH_TEXT_CROPS)) {
        const cX = Math.round(cropMap.x * raidImgElement.naturalWidth);
        const cY = Math.round(cropMap.y * bounds.height) + bounds.top; // Balanced shifting
        const cW = Math.round(cropMap.w * raidImgElement.naturalWidth);
        const cH = Math.round(cropMap.h * bounds.height);

        const textCrop = document.createElement('canvas');
        textCrop.width = cW; textCrop.height = cH;
        textCrop.getContext('2d').drawImage(raidImgElement, cX, cY, cW, cH, 0, 0, cW, cH);
        
        const rawText = await processCrop(textCrop, '0123456789.MBKmbk');
        let cleanText = rawText.trim().toUpperCase().replace(/\s+/g, '');
        const validMetricRegex = /^[0-9]+(\.[0-9]+)?[MBK]?\$/;
        
        if (!cleanText || !validMetricRegex.test(cleanText)) {
            healthPools[partName] = "Missing Bar / Skeleton";
        } else {
            healthPools[partName] = cleanText;
        }
    }
    return healthPools;
}

/**
 * 1 & 3. Processes raid.jpg to extract Titan Name (via Lookup) and Build Morale value
 * @param {HTMLImageElement} raidImgElement 
 * @param {Object} bounds - Content boundaries from pixelReader.js
 */
export async function parseRaidImage(raidImgElement, bounds) {
    // 1. Safe, wide coordinate sweep covering the entire top panel area (Y: 10% to 25%)
    const nameCropX = Math.round(0.05 * raidImgElement.naturalWidth);
    const nameCropY = Math.round(0.10 * bounds.height) + bounds.top;
    const nameCropW = Math.round(0.90 * raidImgElement.naturalWidth);
    const nameCropH = Math.round(0.15 * bounds.height);

    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = nameCropW; nameCanvas.height = nameCropH;
    nameCanvas.getContext('2d').drawImage(raidImgElement, nameCropX, nameCropY, nameCropW, nameCropH, 0, 0, nameCropW, nameCropH);

    // 1. WIDEN THE WINDOW: Create a tall, safe tracking zone (Y: 0.54 to 0.66) 
    // This ensures that even if the row moves up or down, it will always be caught inside this box.
    const moraleCropX = Math.round(0.05 * raidImgElement.naturalWidth);
    const moraleCropY = Math.round(0.54 * bounds.height) + bounds.top; 
    const moraleCropW = Math.round(0.90 * raidImgElement.naturalWidth);
    const moraleCropH = Math.round(0.12 * bounds.height); // Made 3x taller to catch the whole zone!
    
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
    // console.log(normalizedScannedText);

    // Search text for registry signatures
    for (const lord of TITAN_LORDS_REGISTRY) {
        // If any token matches a clean segment inside the scanned output, resolve the profile name
        const matchFound = lord.tokens.some(token => normalizedScannedText.includes(token));
        if (matchFound) {
            titanLordName = lord.officialName; // Force snap to clean official string formatting!
            break;
        }
    }

    console.log('rawMoraleText: ', rawMoraleText);
    // 3. ROBUST REGEX PARSING: Extract the value out of the text mass
    // This looks for anything resembling "Morale", "Active", or "Bonus", then grabs the nearby numbers and percent sign
    const moraleRegex = /(?:morale|active|bonus)[^0-9]*\+?\s*([0-9.]+)\s*%/i;
    const moraleMatch = rawMoraleText.match(moraleRegex);
    let moraleValue = "Not Found";
    
    if (moraleMatch) {
        moraleValue = `${moraleMatch[1]}%`;
    } else {
        // Fallback: If "Morale" keyword was garbled, just look for any isolated percentage number inside the wide box
        const secondaryRegex = /([0-9.]+)\s*%/;
        const fallbackMatch = rawMoraleText.match(secondaryRegex);
        if (fallbackMatch) moraleValue = `${fallbackMatch[1]}%`;
    }

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
