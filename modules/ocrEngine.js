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
    const worker = await Tesseract.createWorker();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    
    if (whitelist) {
        await worker.setParameters({ tessedit_char_whitelist: whitelist });
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

/**
 * Sweeps the 8 titan parts to extract remaining health string values.
 * @param {HTMLImageElement} raidImgElement - The uploaded raid screen
 * @returns {Promise<Object>} Map of parts to their scanned health strings (e.g., { head: "3.96B" })
 */
export async function parsePartHealthPools(raidImgElement) {
    const healthPools = {};

    for (const [partName, cropMap] of Object.entries(PART_HEALTH_TEXT_CROPS)) {
        // Slice a sharp, narrow canvas window exactly over the expected text layer
        const textCrop = createCropCanvas(raidImgElement, cropMap.x, cropMap.y, cropMap.w, cropMap.h);
        
        // Whitelist numbers and gaming tier suffixes (M for Millions, B for Billions, K for Thousands)
        const rawText = await processCrop(textCrop, '0123456789.MBKmbk');
        
        // Clean up formatting and catch cases where the text is empty because the bar is missing
        let cleanText = rawText.trim().toUpperCase().replace(/\s+/g, '');
        
        // Match numbers optionally followed by scale letters
        const validMetricRegex = /^[0-9]+(\.[0-9]+)?[MBK]?$/;
        
        if (!cleanText || !validMetricRegex.test(cleanText)) {
            healthPools[partName] = "Missing Bar / Skeleton";
        } else {
            healthPools[partName] = cleanText;
        }
    }

    return healthPools;
}

/**
 * 1 & 3. Processes raid.jpg to extract Titan Name, Build Morale value, and Part Health Pools
 */
export async function parseRaidImage(raidImgElement) {
    const nameCrop = createCropCanvas(raidImgElement, 0.20, 0.12, 0.60, 0.05);
    const moraleCrop = createCropCanvas(raidImgElement, 0.05, 0.70, 0.90, 0.06);

    const rawNameText = await processCrop(nameCrop, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ');
    const rawMoraleText = await processCrop(moraleCrop, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.+% ');
    
    // Call the new tracking health sweep
    const partHealthPools = await parsePartHealthPools(raidImgElement);

    const moraleRegex = /Build\s+Morale\s+Active\s+\+?([0-9.]+)%/i;
    const moraleMatch = rawMoraleText.match(moraleRegex);
    const moraleValue = moraleMatch ? `${moraleMatch[1]}%` : "Not Found";

    return {
        titanLordName: rawNameText.trim().replace(/\s+/g, ' '),
        moraleBonus: moraleValue,
        partHealthPools: partHealthPools // Merged health pool array
    };
}


/**
 * 4 & 5. Processes info.jpg to extract Green Raid Bonus and Target Titan Stats
 * @param {HTMLImageElement} infoImgElement - The uploaded information panel image
 * @param {string} targetTitanName - The name extracted from the raid image (e.g., "Klonk the Illuminator")
 */
export async function parseInfoImage(infoImgElement, targetTitanName) {
    // 1. Crop full text sweep to dynamically target table locations
    const fullCanvas = createCropCanvas(infoImgElement, 0, 0, 1.0, 1.0);
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
