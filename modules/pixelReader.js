/**
 * pixelReader.js
 * Handles visual state analysis for Tap Titans 2 raid images using HTML5 Canvas.
 */

// Normalized anchors mapping the location of each part.
// Shifted to the absolute far-left edge (~1-2% into the bar asset) to catch 2% HP remaining.
const TITAN_PART_ANCHORS = {
    head:           { bar: { x: 0.423, y: 0.273 }, box: { x: 0.495, y: 0.297 } }, 
    leftShoulder:   { bar: { x: 0.245, y: 0.292 }, box: { x: 0.311, y: 0.315 } }, 
    rightShoulder:  { bar: { x: 0.607, y: 0.290 }, box: { x: 0.666, y: 0.315 } }, 
    leftArm:        { bar: { x: 0.243, y: 0.376 }, box: { x: 0.311, y: 0.407 } }, 
    rightArm:       { bar: { x: 0.605, y: 0.377 }, box: { x: 0.666, y: 0.407 } }, 
    torso:          { bar: { x: 0.423, y: 0.357 }, box: { x: 0.495, y: 0.386 } }, 
    leftLeg:        { bar: { x: 0.348, y: 0.437 }, box: { x: 0.416, y: 0.461 } }, 
    rightLeg:       { bar: { x: 0.505, y: 0.435 }, box: { x: 0.582, y: 0.461 } }  
};

/**
 * Automatically detects the true top and bottom margins of the gameplay area
 * by scanning past solid black padding pixels.
 * Requires a sequence of 5 consecutive rows of non-black pixel 
 */
function findGameContentBounds(ctx, width, height) {
    let topBoundary = 0;
    let bottomBoundary = height;
    const requiredRows = 5;

    // 1. Scan from top down to locate the game's upper header edge
    for (let y = 0; y < height - requiredRows; y++) {
        let validConsecutiveRows = true;
        for (let checkY = 0; checkY < requiredRows; checkY++) {
            const currentY = y + checkY;
            const p1 = ctx.getImageData(Math.round(width * 0.25), currentY, 1, 1).data;
            const p2 = ctx.getImageData(Math.round(width * 0.50), currentY, 1, 1).data;
            const p3 = ctx.getImageData(Math.round(width * 0.75), currentY, 1, 1).data;

            const isBlack = (p1[0] < 15 && p1[1] < 15 && p1[2] < 15) &&
                            (p2[0] < 15 && p2[1] < 15 && p2[2] < 15) &&
                            (p3[0] < 15 && p3[1] < 15 && p3[2] < 15);

            if (isBlack) {
                validConsecutiveRows = false;
                break;
            }
        }
        if (validConsecutiveRows) {
            topBoundary = y;
            break;
        }
    }

    // 2. Scan from bottom up to locate the game's lower border edge
    for (let y = height - 1; y >= requiredRows; y--) {
        let validConsecutiveRows = true;
        for (let checkY = 0; checkY < requiredRows; checkY++) {
            const currentY = y - checkY;
            const p1 = ctx.getImageData(Math.round(width * 0.25), currentY, 1, 1).data;
            const p2 = ctx.getImageData(Math.round(width * 0.50), currentY, 1, 1).data;
            const p3 = ctx.getImageData(Math.round(width * 0.75), currentY, 1, 1).data;

            const isBlack = (p1[0] < 15 && p1[1] < 15 && p1[2] < 15) &&
                            (p2[0] < 15 && p2[1] < 15 && p2[2] < 15) &&
                            (p3[0] < 15 && p3[1] < 15 && p3[2] < 15);

            if (isBlack) {
                validConsecutiveRows = false;
                break;
            }
        }
        if (validConsecutiveRows) {
            bottomBoundary = y;
            break;
        }
    }

    return {
        top: topBoundary,
        bottom: bottomBoundary,
        height: bottomBoundary - topBoundary
    };
}


/**
 * Converts RGB values to HSL (Hue, Saturation, Lightness).
 * HSL makes color detection much less sensitive to screen brightness variations.
 */
function rgbToHsl(r, g, b) {
    // divide each value by 255 then assign it back to the same variable
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic i.e. shade of grey
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Identifies the titan part layer based on the HSL and RGB color near the left edge of the HP bar.
 */
function determineLayerState(hsl, rgb) {
    const { h, s, l } = hsl;
    const [r, g, b] = rgb;
    console.log("hsl", hsl, "\nrgb", rgb);
    // Check for Cursed Armor Layer (Three distinct color conditions)
    const isPurpleCurse = (h >= 260 && h <= 330 && s > 20); // Targets #9755b3 variants
    const isGoldCurse   = (r > 220 && g > 140 && g < 185 && b < 20);  // Targets #f3a200 variants
    const isRedCurse    = (r > 170 && r < 210 && g > 30 && g < 65 && b < 35); // Targets #bf2f13 variants

    if (isPurpleCurse || isGoldCurse || isRedCurse) {
        return "Cursed Armor Layer";
    }

    // Check for Body Layer (Blue/Cyan)
    if (h >= 170 && h <= 250 && s > 30) {
        return "Body Layer";
    }

    // Check for Armor Layer (Grey/White/Metallic)
    if (h >= 236 && s <= 44 && l >= 89) {
        return "Armor Layer";
    }

    return "Skeleton Layer";
}

/**
 * Scans a strategy square box to see if it contains an 'X' (Ignore marker).
 * It calculates the brightness contrast inside the bounding box.
 */
function checkIsIgnored(ctx, pixelX, pixelY, boxRadius = 12) {
    // Extract a small sub-grid containing the icon inside the strategy box
    const imgData = ctx.getImageData(pixelX - boxRadius, pixelY - boxRadius, boxRadius * 2, boxRadius * 2);
    const data = imgData.data;

    let redPixelCount = 0;
    let totalPixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];

        // The 'X' indicator inside Tap Titans 2 is consistently a vibrant red/crimson icon
        if (r > 140 && g < 50 && b < 50) {
            redPixelCount++;
        }
    }

    // If a significant cluster of bright red pixels is detected inside the square, it's an 'X'
    const redRatio = redPixelCount / totalPixels;
    return redRatio > 0.08; 
}

/**
 * Main Orchestrator function for pixel reading
 * @param {HTMLImageElement} raidImageElement - The uploaded raid image element
 * @param {HTMLCanvasElement} debugCanvasElement - The debug canvas element duh
 * @returns {Object} Extracted component states for all 8 parts
 */
export function analyzeTitanParts(raidImageElement, debugCanvasElement = null) {
    const canvas = document.createElement('canvas');
    canvas.width = raidImageElement.naturalWidth;
    canvas.height = raidImageElement.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(raidImageElement, 0, 0);

    const width = canvas.width;
    const rawHeight = canvas.height;

    // NEW: Get the true dimensions by subtracting the black space
    const bounds = findGameContentBounds(ctx, width, rawHeight);
    
    const results = {};

    // Setup visual debug drawing if requested
    // dCtx = debug context
    let dCtx = null;
    if (debugCanvasElement) {
        debugCanvasElement.width = width;
        debugCanvasElement.height = rawHeight;
        dCtx = debugCanvasElement.getContext('2d');
        dCtx.drawImage(raidImageElement, 0, 0);
    }

    for (const [partName, anchors] of Object.entries(TITAN_PART_ANCHORS)) {
        // Calculate Y mapping relative to the game bounds, then add top offset
        const barX = Math.round(anchors.bar.x * width);
        const barY = Math.round(anchors.bar.y * bounds.height) + bounds.top;
        const boxX = Math.round(anchors.box.x * width);
        const boxY = Math.round(anchors.box.y * bounds.height) + bounds.top;

        // Get RGB of the health bar
        const pixelData = ctx.getImageData(barX, barY, 1, 1).data;
        const rgb = [pixelData[0], pixelData[1], pixelData[2]];
        const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);

        // Evaluate states
        const layer = determineLayerState(hsl, rgb);
        const isIgnored = checkIsIgnored(ctx, boxX, boxY);

        results[partName] = {
            layer: layer,
            action: isIgnored ? "Ignore (X)" : "Target/Attack"
        };

        // Draw targets onto the debug interface
        if (dCtx) {
            // Draw color sample target dot (Red fill)
            dCtx.fillStyle = '#ff0000';
            dCtx.beginPath();
            dCtx.arc(barX, barY, Math.max(6, width * 0.005), 0, 2 * Math.PI);
            dCtx.fill();

            // Draw strategy outline box (Blue square)
            dCtx.strokeStyle = '#0066ff';
            dCtx.lineWidth = Math.max(3, width * 0.003);
            const radius = 12; // matching standard boxRadius
            dCtx.strokeRect(boxX - radius, boxY - radius, radius * 2, radius * 2);
            
            // Draw text identifier labels over elements
            dCtx.fillStyle = '#000';
            dCtx.font = `bold ${Math.max(14, width * 0.012)}px monospace`;
            dCtx.fillText(partName, boxX - radius, boxY - radius - 5);
        }
    }

    // Return the bounds info along with the findings so app.js can use it
    return { results, dCtx, bounds };
}
