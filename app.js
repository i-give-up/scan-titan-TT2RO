const status = document.getElementById('status');
const sceneInput = document.getElementById('sceneInput');
const templateInput = document.getElementById('templateInput');
const matchBtn = document.getElementById('matchBtn');
const outputCanvas = document.getElementById('outputCanvas');

// Enable inputs once OpenCV.js finishes downloading
function onOpenCvReady() {
    status.textContent = "✅ OpenCV.js is ready! Upload your images.";
    status.style.color = "#2ea44f";
    sceneInput.disabled = false;
    templateInput.disabled = false;
    
    setupPreview(sceneInput, 'scenePreview');
    setupPreview(templateInput, 'templatePreview');
}

// Helper to handle image file uploads and local image previewing
function setupPreview(inputElement, previewId) {
    inputElement.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const img = document.getElementById(previewId);
            img.src = URL.createObjectURL(file);
            img.style.display = 'block';
            checkReadyToMatch();
        }
    });
}

function checkReadyToMatch() {
    if (sceneInput.files.length && templateInput.files.length) {
        matchBtn.disabled = false;
    }
}

// Main logic executing Scale-Invariant Feature Matching
matchBtn.addEventListener('click', () => {
    status.textContent = "🔍 Analyzing features and scales...";
    status.style.color = "#0366d6";

    setTimeout(() => {
        try {
            // 1. Read images directly from HTML img previews
            let src = cv.imread('scenePreview');
            let templ = cv.imread('templatePreview');

            // 2. Convert to Grayscale for faster processing
            let srcGray = new cv.Mat();
            let templGray = new cv.Mat();
            cv.cvtColor(src, srcGray, cv.COLOR_RGBA2GRAY, 0);
            cv.cvtColor(templ, templGray, cv.COLOR_RGBA2GRAY, 0);

            // 3. Setup Scale-Invariant ORB Detector
            let orb = new cv.ORB();
            let keypointsSrc = new cv.KeyPointVector();
            let keypointsTempl = new cv.KeyPointVector();
            let descriptorsSrc = new cv.Mat();
            let descriptorsTempl = new cv.Mat();

            orb.detectAndCompute(srcGray, new cv.Mat(), keypointsSrc, descriptorsSrc);
            orb.detectAndCompute(templGray, new cv.Mat(), keypointsTempl, descriptorsTempl);

            // 4. Match features using Brute-Force
            let matcher = new cv.BFMatcher(cv.NORM_HAMMING, true);
            let matches = new cv.DMatchVector();
            matcher.match(descriptorsTempl, descriptorsSrc, matches);

            // 5. Filter out weak visual feature matches
            let goodMatches = [];
            for (let i = 0; i < matches.size(); ++i) {
                let match = matches.get(i);
                if (match.distance < 45) { // Strict filtering for resolution variations
                    goodMatches.push(match);
                }
            }

            // 6. Calculate coordinates and plot result
            if (goodMatches.length >= 3) {
                let totalX = 0, totalY = 0;
                goodMatches.forEach(match => {
                    let kp = keypointsSrc.get(match.trainIdx);
                    totalX += kp.pt.x;
                    totalY += kp.pt.y;
                });

                let centerX = totalX / goodMatches.length;
                let centerY = totalY / goodMatches.length;

                // Draw a visual crosshair target over the located position
                outputCanvas.style.display = "block";
                cv.imshow('outputCanvas', src); // Draw base scene first
                
                let ctx = outputCanvas.getContext('2d');
                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 4;
                ctx.beginPath();
                // Draw outer tracking square
                ctx.rect(centerX - 30, centerY - 30, 60, 60);
                // Center dot
                ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
                ctx.stroke();

                status.textContent = `🎯 Located template at X: ${Math.round(centerX)}, Y: ${Math.round(centerY)}`;
                status.style.color = "#2ea44f";
            } else {
                status.textContent = "❌ Could not find a match. The scales might be too extremely different or features are too blurry.";
                status.style.color = "#cb2431";
            }

            // Clean memory leak allocations (Critical in OpenCV.js)
            src.delete(); templ.delete(); srcGray.delete(); templGray.delete();
            orb.delete(); keypointsSrc.delete(); keypointsTempl.delete();
            descriptorsSrc.delete(); descriptorsTempl.delete(); matcher.delete(); matches.delete();

        } catch (err) {
            status.textContent = "⚠️ Error occurred during computation.";
            status.style.color = "#cb2431";
            console.error(err);
        }
    }, 50);
});
