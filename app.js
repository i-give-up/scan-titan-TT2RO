/**
 * app.js
 * Master orchestrator connecting the UI layer to pixelReader.js and ocrEngine.js modules.
 */

import { analyzeTitanParts } from './modules/pixelReader.js';
import { parseRaidImage, parseInfoImage } from './modules/ocrEngine.js';

// Dom Elements
const statusText = document.getElementById('status');
const sceneInput = document.getElementById('sceneInput'); // raid.jpg
const templateInput = document.getElementById('templateInput'); // info.jpg
const matchBtn = document.getElementById('matchBtn');

// Previews & Visual Debug Elements
const raidPreview = document.getElementById('scenePreview');
const infoPreview = document.getElementById('templatePreview');
const debugSection = document.getElementById('debugSection');
const debugCanvas = document.getElementById('debugCanvas');
const canvasContainer = document.querySelector('.canvas-container');

/**
 * Global Callback executed when OpenCV.js finishes loading.
 * Configured in index.html script onload hook.
 */
window.onOpenCvReady = function() {
    statusText.textContent = "✅ System ready. Please upload your Raid and Info screenshots.";
    statusText.style.color = "#2ea44f";
    sceneInput.disabled = false;
    templateInput.disabled = false;
    
    setupImagePreview(sceneInput, raidPreview);
    setupImagePreview(templateInput, infoPreview);
};

/**
 * Utility to process user image uploads and display local thumbnail assets
 */
function setupImagePreview(inputEl, imgPreviewEl) {
    inputEl.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            imgPreviewEl.src = URL.createObjectURL(file);
            imgPreviewEl.style.display = 'block';
            evaluateButtonState();
        }
    });
}

function evaluateButtonState() {
    if (sceneInput.files.length && templateInput.files.length) {
        matchBtn.disabled = false;
    }
}

/**
 * Core execution pipeline triggered by the user
 */
matchBtn.addEventListener('click', async () => {
    matchBtn.disabled = true;
    statusText.textContent = "⏳ Phase 1: Analyzing Titan color layers and action strategies...";
    statusText.style.color = "#0366d6";
    
    // Show the visual debug panel container immediately
    debugSection.style.display = "block";
    
    // Small delay to allow UI loading text thread to paint on slower devices
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        // 1. Core Pixels Scan + Pass Debug Canvas Reference
        const analysisOutput = analyzeTitanParts(raidPreview, debugCanvas);
        const visualPartStates = analysisOutput.results;
        const dCtx = analysisOutput.dCtx;
        const bounds = analysisOutput.bounds; // Capture the bounding data parameters

        // Draw the OCR text tracking regions over the calibration interface screen matrix
        if (dCtx) {
            const w = raidPreview.naturalWidth;
            dCtx.strokeStyle = '#2ea44f';
            dCtx.lineWidth = Math.max(4, w * 0.003);
        
            // Draw the green boxes shifted to match the content boundaries
            const nameY = Math.round(0.10 * bounds.height) + bounds.top; // Match the 0.10 start coordinate
            const nameH = Math.round(0.15 * bounds.height);             // Match the 0.15 height frame
            dCtx.strokeRect(Math.round(0.05 * w), nameY, Math.round(0.90 * w), nameH);
            
            const moraleY = Math.round(0.35 * bounds.height) + bounds.top;
            const moraleH = Math.round(0.40 * bounds.height);
            dCtx.strokeStyle = '#2ea44f';
            dCtx.strokeRect(Math.round(0.05 * w), moraleY, Math.round(0.90 * w), moraleH);
            dCtx.fillStyle = '#2ea44f';
            dCtx.fillText("[OCR Zone: Full Center Morale Sweep]", Math.round(0.05 * w), moraleY - 6);
        }

        statusText.textContent = "⏳ Phase 2: Running OCR text mapping on Raid metrics...";
        // 2. OCR Scan on Raid Image (Name, Morale & Health Numbers)
        const raidOcrResults = await parseRaidImage(raidPreview, bounds);
        const titanName = raidOcrResults.titanLordName || "Unknown Titan";

        statusText.textContent = `⏳ Phase 3: Merging data blocks and parsing targeted metrics for ${titanName}...`;
        // 3. OCR Scan on Stats Image using the located Titan name
        const infoOcrResults = await parseInfoImage(infoPreview, titanName);

        // 4. Build consolidated data structure combining both screens
        const consolidatedData = compileDataset(visualPartStates, raidOcrResults, infoOcrResults, titanName);

        // 5. Draw results dashboard on screen
        renderOutputDashboard(consolidatedData);

        statusText.textContent = "🎯 Complete! Structured Raid Report generated below.";
        statusText.style.color = "#2ea44f";

    } catch (error) {
        statusText.textContent = "⚠️ Processing failure. Ensure your screenshots match typical template crops.";
        statusText.style.color = "#cb2431";
        console.error("Pipeline failure details:", error);
    } finally {
        matchBtn.disabled = false;
    }
});

/**
 * Combines pixel reading logic with text arrays into a structured object map
 */
function compileDataset(visuals, raidOcr, infoOcr, name) {
    const finalParts = {};
    const structuralParts = ['head', 'leftShoulder', 'rightShoulder', 'leftArm', 'rightArm', 'torso', 'leftLeg', 'rightLeg'];

    structuralParts.forEach(part => {
        const visualMeta = visuals[part] || { layer: 'Unknown', action: 'Target/Attack' };
        const healthText = raidOcr.partHealthPools?.[part] || 'Missing Bar / Skeleton';

        // Override target if pixel engine flagged a missing bar region as a skeleton
        let interpretedLayer = visualMeta.layer;
        if (healthText.includes('Skeleton') || healthText.includes('Missing')) {
            interpretedLayer = 'Skeleton Part';
        }

        finalParts[part] = {
            layer: interpretedLayer,
            action: visualMeta.action,
            currentHealth: healthText
        };
    });

    return {
        titanName: name,
        moraleBonus: raidOcr.moraleBonus,
        raidBonusMultiplier: infoOcr.raidBonus,
        parts: finalParts,
        titanLordBaseStats: infoOcr.titanStats
    };
}

/**
 * Dynamically modifies HTML layouts to map an interactive reporting grid
 */
function renderOutputDashboard(data) {
    // Clear dynamic area container
    canvasContainer.innerHTML = '';

    const dashboardHtml = `
        <div class="report-card" style="width:100%; border:1px solid #e1e4e8; padding:20px; border-radius:6px; background:#fff; margin-top:20px;">
            <h3 style="margin-top:0; color:#24292e; border-bottom:1px solid #e1e4e8; padding-bottom:8px;">📊 Target Profile: ${data.titanName}</h3>
            
            <div style="display:flex; gap:30px; margin-bottom:20px; flex-wrap:wrap; font-size:14px;">
                <div><strong>Build Morale Value:</strong> <span style="color:#0366d6">${data.moraleBonus}</span></div>
                <div><strong>Raid Card Bonus:</strong> <span style="color:#2ea44f">${data.raidBonusMultiplier}</span></div>
            </div>

            <h4 style="margin-bottom:10px;">🛡️ Active Titan Part Statuses (raid.jpg)</h4>
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:14px; margin-bottom:25px;">
                <thead>
                    <tr style="background:#f6f8fa; border-bottom:2px solid #e1e4e8;">
                        <th style="padding:10px; border:1px solid #e1e4e8;">Titan Part</th>
                        <th style="padding:10px; border:1px solid #e1e4e8;">Current HP</th>
                        <th style="padding:10px; border:1px solid #e1e4e8;">Detected Layer</th>
                        <th style="padding:10px; border:1px solid #e1e4e8;">Action Directive</th>
                    </tr>
                </thead>
                <tbody>
                    \${Object.entries(data.parts).map(([partName, meta]) => {
                        const styleColor = meta.action.includes('Ignore') ? '#cb2431' : '#2ea44f';
                        const formattedName = partName.replace(/([A-Z])/g, ' \$1').replace(/^./, str => str.toUpperCase());
                        
                        return `
                            <tr style="border-bottom:1px solid #e1e4e8;">
                                <td style="padding:10px; border:1px solid #e1e4e8; font-weight:bold;">${formattedName}</td>
                                <td style="padding:10px; border:1px solid #e1e4e8;">${meta.currentHealth}</td>
                                <td style="padding:10px; border:1px solid #e1e4e8;">${meta.layer}</td>
                                <td style="padding:10px; border:1px solid #e1e4e8; color:${styleColor}; font-weight:bold;">${meta.action}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>

            <h4 style="margin-bottom:10px;">📋 Lord Reference Database Metrics (info.jpg)</h4>
            <div style="background:#f6f8fa; padding:15px; border-radius:6px; font-size:13px; font-family:monospace; border:1px solid #e1e4e8; line-height:1.6;">
                <div><strong>Titan Specific Target Debuff:</strong> <span style="color:#cb2431">${data.titanLordBaseStats.debuff}</span></div>
                <div><strong>Cursed Armor Coefficient:</strong> <span style="color:#cb2431">${data.titanLordBaseStats.cursedArmorEffect}</span></div>
                <div style="margin-top:10px; font-weight:bold;">Extracted Reference Bounds:</div>
                <ul style="margin:5px 0 0 20px; padding:0;">
                    <li>Head Layer Pools -> Body: ${data.titanLordBaseStats.body.head} | Armor: ${data.titanLordBaseStats.armor.head}</li>
                    <li>Torso Layer Pools -> Body: ${data.titanLordBaseStats.body.torso} | Armor: ${data.titanLordBaseStats.armor.torso}</li>
                    <li>Arms Layer Pools -> Body: ${data.titanLordBaseStats.body.arms} | Armor: ${data.titanLordBaseStats.armor.arms}</li>
                    <li>Legs Layer Pools -> Body: ${data.titanLordBaseStats.body.legs} | Armor: ${data.titanLordBaseStats.armor.legs}</li>
                </ul>
            </div>
        </div>
    `;

    canvasContainer.innerHTML = dashboardHtml;
    console.log(data);
}
