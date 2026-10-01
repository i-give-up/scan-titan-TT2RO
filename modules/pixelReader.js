/**
 * pixelReader.js
 * Handles visual state analysis for Tap Titans 2 raid images using HTML5 Canvas.
 */

// Normalized anchors mapping the location of each part.
// Shifted to the absolute far-left edge (~1-2% into the bar asset) to catch 2% HP remaining.
const TITAN_PART_ANCHORS = {
    head:           { bar: { x: 0.41, y: 0.28 }, box: { x: 0.50, y: 0.32 } }, 
    leftShoulder:   { bar: { x: 0.23, y: 0.30 }, box: { x: 0.30, y: 0.34 } }, 
    rightShoulder:  { bar: { x: 0.59, y: 0.30 }, box: { x: 0.70, y: 0.34 } }, 
    leftArm:        { bar: { x: 0.17, y: 0.38 }, box: { x: 0.30, y: 0.42 } }, 
    rightArm:       { bar: { x: 0.66, y: 0.38 }, box: { x: 0.70, y: 0.42 } }, 
    torso:          { bar: { x: 0.41, y: 0.36 }, box: { x: 0.50, y: 0.40 } }, 
    leftLeg:        { bar: { x: 0.33, y: 0.46 }, box: { x: 0.40, y: 0.48 } }, 
    rightLeg:       { bar: { x: 0.53, y: 0.46 }, box: { x: 0.60, y: 0.48 } }  
};

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

    // 1. Check for Skeleton (Missing Bar or background color)
    if (l < 15 || (s < 12 && l < 40)) {
        return "Skeleton Part";
    }

    // 2. Check for Cursed Armor Layer (Three distinct color conditions)
    const isPurpleCurse = (h >= 260 && h <= 330 && s > 20); // Targets #9755b3 variants
    const isGoldCurse   = (r > 220 && g > 140 && g < 185 && b < 20);  // Targets #f3a200 variants
    const isRedCurse    = (r > 170 && r < 210 && g > 30 && g < 65 && b < 35); // Targets #bf2f13 variants

    if (isPurpleCurse || isGoldCurse || isRedCurse) {
        return "Cursed Armor Layer";
    }

    // 3. Check for Body Layer (Blue/Cyan)
    if (h >= 170 && h <= 250 && s > 30) {
        return "Body Layer";
    }

    // 4. Check for Armor Layer (Grey/White/Metallic)
    if (s <= 18 && l >= 35) {
        return "Armor Layer";
    }

    return "Unknown / Hidden";
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
 * @returns {Object} Extracted component states for all 8 parts
 */
export function analyzeTitanParts(raidImageElement) {
    const canvas = document.createElement('canvas');
    canvas.width = raidImageElement.naturalWidth;
    canvas.height = raidImageElement.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(raidImageElement, 0, 0);

    const width = canvas.width;
    const height = canvas.height;
    const results = {};

    // Setup visual debug drawing if requested
    // dCtx = debug context
    let dCtx = null;
    if (debugCanvasElement) {
        debugCanvasElement.width = width;
        debugCanvasElement.height = height;
        dCtx = debugCanvasElement.getContext('2d');
        dCtx.drawImage(raidImageElement, 0, 0);
    }

    for (const [partName, anchors] of Object.entries(TITAN_PART_ANCHORS)) {
        // Calculate absolute pixel coordinates from normalized anchor definitions
        const barX = Math.round(anchors.bar.x * width);
        const barY = Math.round(anchors.bar.y * height);
        const boxX = Math.round(anchors.box.x * width);
        const boxY = Math.round(anchors.box.y * height);

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

    return { results, dCtx };
}
