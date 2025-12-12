class ColorDetector {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.indicator = document.getElementById('detectionIndicator');
        this.statusText = document.getElementById('statusText');
        this.fpsText = document.getElementById('fpsText');
        
        this.stream = null;
        this.isRunning = false;
        this.animationFrame = null;
        this.frameCount = 0;
        this.lastFpsTime = Date.now();
        this.flashlightOn = false;
        this.lastDetectionState = false; // Track previous detection state for vibration
        this.lastVibrationTime = 0; // Track last vibration time for cooldown
        this.vibrationCooldown = 500; // Minimum time between vibrations (ms)
        this.userInteractionOccurred = false; // Track if user has interacted (required for vibration on mobile)
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.vibrationSupported = false; // Will be set after testing
        this.circleAngle = 0; // Angle for orbiting circle animation
        this.smallDetectionCenter = null; // Center point of small detection
        this.smallDetectionRadius = 0; // Radius for orbiting circle
        this.detectionHistoryForCircle = []; // Store recent detection centers for stability
        this.stableDetectionFrames = 0; // Count consecutive frames with small detection
        this.minStableFrames = 2; // Require 2 consecutive frames before showing circle (reduced for responsiveness)
        
        // Color detection settings - optimized for blood detection
        this.targetColor = { r: 255, g: 0, b: 0 }; // Default red
        this.hueTolerance = 10; // Default tolerance
        this.saturationMin = 0.01; // Default to 1%
        this.brightnessMin = 0.25; // Default to 25%
        this.brightnessMax = 1.0; // Allow all brightness levels
        
        // Temporal smoothing for more consistent detection
        this.detectionHistory = [];
        this.historySize = 2; // Reduced to 2 frames for faster response with blood spots
        this.previousMask = null;
        
        this.setupEventListeners();
        this.updateSettings();
        this.initializeDisplayValues();
    }
    
    initializeDisplayValues() {
        // Initialize display values to match defaults
        document.getElementById('hueToleranceValue').textContent = this.hueTolerance;
        document.getElementById('saturationMinValue').textContent = Math.round(this.saturationMin * 100);
        document.getElementById('brightnessMinValue').textContent = Math.round(this.brightnessMin * 100);
    }
    
    setupEventListeners() {
        // Mark user interaction when any button is clicked (required for vibration API on mobile)
        const markUserInteraction = () => {
            this.userInteractionOccurred = true;
            // Test vibration immediately to ensure it's enabled
            this.testVibrationSupport();
        };
        
        document.getElementById('startBtn').addEventListener('click', () => {
            markUserInteraction();
            this.startCamera();
        });
        document.getElementById('stopBtn').addEventListener('click', () => {
            markUserInteraction();
            this.stopCamera();
        });
        document.getElementById('flashlightToggle').addEventListener('click', () => {
            markUserInteraction();
            this.toggleFlashlight();
        });
        
        document.getElementById('targetColor').addEventListener('input', (e) => {
            const hex = e.target.value;
            this.targetColor = this.hexToRgb(hex);
            this.updateSettings();
        });
        
        document.getElementById('hueTolerance').addEventListener('input', (e) => {
            this.hueTolerance = parseInt(e.target.value);
            document.getElementById('hueToleranceValue').textContent = this.hueTolerance;
        });
        
        document.getElementById('saturationMin').addEventListener('input', (e) => {
            this.saturationMin = parseInt(e.target.value) / 100;
            document.getElementById('saturationMinValue').textContent = Math.round(this.saturationMin * 100);
        });
        
        document.getElementById('brightnessMin').addEventListener('input', (e) => {
            this.brightnessMin = parseInt(e.target.value) / 100;
            document.getElementById('brightnessMinValue').textContent = Math.round(this.brightnessMin * 100);
        });
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 0, b: 0 };
    }
    
    rgbToHsv(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        
        let h = 0;
        if (diff !== 0) {
            if (max === r) {
                h = ((g - b) / diff) % 6;
            } else if (max === g) {
                h = (b - r) / diff + 2;
            } else {
                h = (r - g) / diff + 4;
            }
        }
        h = h * 60;
        if (h < 0) h += 360;
        
        const s = max === 0 ? 0 : diff / max;
        const v = max;
        
        return { h, s, v };
    }
    
    updateSettings() {
        const targetHsv = this.rgbToHsv(this.targetColor.r, this.targetColor.g, this.targetColor.b);
        this.targetHue = targetHsv.h;
    }
    
    async startCamera() {
        try {
            this.statusText.textContent = 'Requesting camera access...';
            
            // Try to get camera with preferred settings first
            let constraints = {
                video: {
                    facingMode: 'environment', // Use back camera
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };
            
            try {
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (firstError) {
                // If back camera fails, try any available camera
                console.log('Back camera not available, trying any camera:', firstError);
                constraints = {
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                };
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            }
            
            this.video.srcObject = this.stream;
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Camera initialization timeout'));
                }, 10000); // 10 second timeout
                
                this.video.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    this.video.play().then(() => {
                        this.canvas.width = this.video.videoWidth;
                        this.canvas.height = this.video.videoHeight;
                        resolve();
                    }).catch(reject);
                };
                
                this.video.onerror = (e) => {
                    clearTimeout(timeout);
                    console.error('Video error:', e);
                    reject(new Error('Video playback error: ' + (e.message || 'Unknown error')));
                };
                
                // Also check if video fails to load
                this.video.addEventListener('error', (e) => {
                    clearTimeout(timeout);
                    console.error('Video load error:', e);
                }, { once: true });
            });
            
            // Wait a bit for video to be fully ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify video is actually playing
            if (this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            this.isRunning = true;
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            this.statusText.textContent = 'Camera active - Detecting colors...';
            
            // Show flashlight toggle button (but don't auto-enable)
            const flashlightToggle = document.getElementById('flashlightToggle');
            if (flashlightToggle) {
                flashlightToggle.classList.remove('hidden');
            }
            
            // Flashlight starts off - user can toggle it manually
            this.flashlightOn = false;
            
            // Clear any previous detection history
            this.detectionHistory = [];
            this.lastDetectionState = false; // Reset detection state when starting camera
            
            // Start map tracking when camera starts
            if (window.mapTrackingService) {
                window.mapTrackingService.startTracking();
            }
            
            this.detectColors();
            } else {
                throw new Error('Video not ready after initialization');
            }
        } catch (error) {
            console.error('Error accessing camera:', error);
            let errorMessage = 'Could not access camera. ';
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage += 'Please allow camera access in your browser settings.';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorMessage += 'No camera found. Please connect a camera.';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                errorMessage += 'Camera is being used by another application.';
            } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
                errorMessage += 'Camera does not support requested settings.';
            } else {
                errorMessage += error.message || 'Please check permissions and try again.';
            }
            
            this.statusText.textContent = 'Error: ' + errorMessage;
            this.isRunning = false;
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
        }
    }
    
    async enableFlashlight() {
        if (!this.stream) return false;
        
        try {
            const videoTrack = this.stream.getVideoTracks()[0];
            if (videoTrack && videoTrack.getCapabilities) {
                const capabilities = videoTrack.getCapabilities();
                // Check if torch is supported
                if (capabilities.torch) {
                    await videoTrack.applyConstraints({
                        advanced: [{ torch: true }]
                    });
                    console.log('Flashlight enabled');
                    return true;
                }
            }
        } catch (error) {
            // Flashlight not supported or failed to enable
            console.log('Flashlight not available:', error);
        }
        return false;
    }
    
    async disableFlashlight() {
        if (!this.stream) return false;
        
        try {
            const videoTrack = this.stream.getVideoTracks()[0];
            if (videoTrack && videoTrack.getCapabilities) {
                const capabilities = videoTrack.getCapabilities();
                // Check if torch is supported
                if (capabilities.torch) {
                    await videoTrack.applyConstraints({
                        advanced: [{ torch: false }]
                    });
                    console.log('Flashlight disabled');
                    return true;
                }
            }
        } catch (error) {
            // Flashlight not supported or failed to disable
            console.log('Flashlight disable error:', error);
        }
        return false;
    }
    
    async toggleFlashlight() {
        if (!this.isRunning || !this.stream) return;
        
        const flashlightToggle = document.getElementById('flashlightToggle');
        
        if (this.flashlightOn) {
            // Turn off
            const success = await this.disableFlashlight();
            if (success) {
                this.flashlightOn = false;
                if (flashlightToggle) {
                    flashlightToggle.classList.remove('active');
                }
            }
        } else {
            // Turn on
            const success = await this.enableFlashlight();
            if (success) {
                this.flashlightOn = true;
                if (flashlightToggle) {
                    flashlightToggle.classList.add('active');
                }
            }
        }
    }
    
    stopCamera() {
        // Disable flashlight first
        this.disableFlashlight();
        this.flashlightOn = false;
        
        // Hide flashlight toggle button
        const flashlightToggle = document.getElementById('flashlightToggle');
        if (flashlightToggle) {
            flashlightToggle.classList.add('hidden');
            flashlightToggle.classList.remove('active');
        }
        
        this.isRunning = false;
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.video.srcObject = null;
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        this.statusText.textContent = 'Camera stopped';
        
        this.indicator.classList.add('hidden');
        this.lastDetectionState = false; // Reset detection state when camera stops
        
        // Stop map tracking when camera stops
        if (window.mapTrackingService) {
            window.mapTrackingService.stopTracking();
        }
    }
    
    testVibrationSupport() {
        // Test if vibration actually works on this device
        if ('vibrate' in navigator) {
            try {
                // Try a very short vibration to test support
                const result = navigator.vibrate(10);
                this.vibrationSupported = result !== false;
                console.log(`Vibration API test: ${this.vibrationSupported ? 'SUPPORTED' : 'NOT SUPPORTED'}`, {
                    isIOS: this.isIOS,
                    hasVibrate: 'vibrate' in navigator,
                    userAgent: navigator.userAgent
                });
                
                // If on iOS and vibration returned false, it's likely not supported
                if (this.isIOS && result === false) {
                    console.warn('⚠️ iOS detected: Vibration API may not be fully supported. iOS 18+ may have limited support.');
                }
            } catch (e) {
                this.vibrationSupported = false;
                console.warn('Vibration test failed:', e);
            }
        } else {
            this.vibrationSupported = false;
            console.log('Vibration API not available in navigator');
        }
    }
    
    vibrateOnDetection() {
        // Check cooldown to prevent rapid vibrations
        const now = Date.now();
        if (now - this.lastVibrationTime < this.vibrationCooldown) {
            return; // Still in cooldown period
        }
        
        // On mobile, vibration requires user interaction first
        // If no user interaction has occurred, try to enable it
        if (!this.userInteractionOccurred) {
            console.log('Vibration skipped: no user interaction yet');
            return;
        }
        
        // If we haven't tested yet, test now
        if (this.vibrationSupported === false && 'vibrate' in navigator) {
            this.testVibrationSupport();
        }
        
        // Use Vibration API to provide haptic feedback when red is detected
        if (this.vibrationSupported && 'vibrate' in navigator) {
            try {
                // More aggressive vibration pattern for better mobile detection
                // Pattern: medium vibration, short pause, medium vibration
                const vibrationPattern = [200, 100, 200];
                const result = navigator.vibrate(vibrationPattern);
                
                if (result === false) {
                    // Vibration was blocked/not supported
                    console.warn('Vibration was blocked or not supported');
                    this.vibrationSupported = false;
                } else {
                    this.lastVibrationTime = now;
                    console.log('✅ Vibration triggered on red detection', {
                        pattern: vibrationPattern,
                        isIOS: this.isIOS
                    });
                }
            } catch (error) {
                console.error('Vibration failed:', error);
                this.vibrationSupported = false;
            }
        } else {
            if (this.isIOS) {
                console.log('⚠️ iOS device detected - Vibration API has limited/no support on iOS. Visual indicator will still work.');
            } else {
                console.log('Vibration API not supported in this browser');
            }
        }
    }
    
    // Find connected components (blobs) in the mask
    findConnectedComponents(mask, width, height) {
        const visited = new Uint8Array(width * height);
        const components = [];
        const minDetectionPixels = 200; // Minimum pixels for a valid blob (lowered for better small detection on mobile)
        const maxSmallDetectionPercentage = 2.5; // Max 2.5% of screen (increased to catch smaller detections)
        const totalPixels = width * height;
        
        // Flood fill to find connected components
        const floodFill = (startX, startY, componentId) => {
            const stack = [[startX, startY]];
            const pixels = [];
            let minX = startX, minY = startY, maxX = startX, maxY = startY;
            let sumX = 0, sumY = 0;
            
            while (stack.length > 0) {
                const [x, y] = stack.pop();
                const idx = y * width + x;
                
                // Check bounds and if already visited or not part of mask
                if (x < 0 || x >= width || y < 0 || y >= height || 
                    visited[idx] || mask[idx] !== 1) {
                    continue;
                }
                
                visited[idx] = 1;
                pixels.push([x, y]);
                sumX += x;
                sumY += y;
                
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                
                // Check 8-connected neighbors
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        stack.push([x + dx, y + dy]);
                    }
                }
            }
            
            if (pixels.length >= minDetectionPixels) {
                const detectionPercentage = (pixels.length / totalPixels) * 100;
                if (detectionPercentage <= maxSmallDetectionPercentage) {
                    const centerX = sumX / pixels.length;
                    const centerY = sumY / pixels.length;
                    const detectionWidth = maxX - minX;
                    const detectionHeight = maxY - minY;
                    const detectionRadius = Math.max(detectionWidth, detectionHeight) / 2;
                    const circleRadius = detectionRadius + 15; // Add padding
                    
                    components.push({
                        centerX,
                        centerY,
                        radius: circleRadius,
                        pixelCount: pixels.length,
                        pixels: pixels
                    });
                }
            }
        };
        
        // Find all connected components
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 1 && !visited[idx]) {
                    floodFill(x, y, components.length);
                }
            }
        }
        
        return components;
    }
    
    drawOrbitingCircle(mask, width, height) {
        if (!mask || mask.length === 0) {
            this.smallDetectionCenter = null;
            this.detectionHistoryForCircle = [];
            this.stableDetectionFrames = 0;
            return;
        }
        
        // Find all individual connected components (blobs)
        const components = this.findConnectedComponents(mask, width, height);
        
        if (components.length === 0) {
            return;
        }
        
        // Draw a circle around each detected blob
        // Ensure canvas context is properly set up for mobile
        this.ctx.save();
        this.ctx.strokeStyle = '#32FF32'; // Lime green
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Force canvas to be ready for drawing on mobile
        if (!this.ctx || this.canvas.width === 0 || this.canvas.height === 0) {
            this.ctx.restore();
            return;
        }
        
        for (const component of components) {
            const { centerX, centerY, radius } = component;
            
            // Validate coordinates
            if (isNaN(centerX) || isNaN(centerY) || isNaN(radius) || radius <= 0) {
                continue;
            }
            
            // Draw circle outline around the detection
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
        
        // Force canvas to flush on mobile devices
        // Some mobile browsers need explicit flushing
        if (this.ctx.commit) {
            this.ctx.commit();
        }
    }
    
    detectColors() {
        if (!this.isRunning) return;
        
        try {
            // Check if video is ready
            if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
                this.animationFrame = requestAnimationFrame(() => this.detectColors());
                return;
            }
            
            // Ensure canvas dimensions match video
            if (this.canvas.width !== this.video.videoWidth || this.canvas.height !== this.video.videoHeight) {
                this.canvas.width = this.video.videoWidth;
                this.canvas.height = this.video.videoHeight;
            }
            
            // Safety check - ensure dimensions are valid
            if (this.canvas.width === 0 || this.canvas.height === 0) {
                this.animationFrame = requestAnimationFrame(() => this.detectColors());
                return;
            }
            
            // Draw current frame to canvas
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
            // Get image data (this captures the current video frame)
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const data = imageData.data;
            
            // Create a mask for detected pixels
            const width = this.canvas.width;
            const height = this.canvas.height;
        const mask = new Uint8Array(width * height);
        let matchingPixels = 0;
        let totalSampled = 0;
        
        // Improved color matching with better red detection
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const hsv = this.rgbToHsv(r, g, b);
            
            // Improved hue matching with better wrapping for red
            let hueDiff = Math.abs(hsv.h - this.targetHue);
            if (hueDiff > 180) {
                hueDiff = 360 - hueDiff;
            }
            
            // Better red/blood detection - handle wrap-around and dark blood
            let isMatch = false;
            const isRedTarget = this.targetHue < 30 || this.targetHue > 330;
            
            if (isRedTarget) {
                // For red/blood: check both sides of the hue circle
                const hue1 = hsv.h;
                const hue2 = hsv.h < 180 ? hsv.h + 360 : hsv.h - 360;
                const diff1 = Math.abs(hue1 - this.targetHue);
                const diff2 = Math.abs(hue2 - this.targetHue);
                const minDiff = Math.min(diff1, diff2);
                
                // Stricter red detection - respect hue tolerance setting
                const hueMatch = minDiff <= this.hueTolerance;
                const satMatch = hsv.s >= this.saturationMin;
                const brightMatch = hsv.v >= this.brightnessMin && hsv.v <= this.brightnessMax;
                
                // Simple, consistent matching - no special cases
                // Just use the slider values directly
                isMatch = hueMatch && satMatch && brightMatch;
            } else {
                isMatch = hueDiff <= this.hueTolerance &&
                         hsv.s >= this.saturationMin &&
                         hsv.v >= this.brightnessMin &&
                         hsv.v <= this.brightnessMax;
            }
            
            const pixelIndex = i / 4;
            const x = pixelIndex % width;
            const y = Math.floor(pixelIndex / width);
            
            if (isMatch) {
                matchingPixels++;
                mask[y * width + x] = 1;
                // Keep original red color - do NOT modify the pixel color
            } else {
                // Convert to grayscale for non-matching areas
                const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                data[i] = gray;     // R
                data[i + 1] = gray; // G
                data[i + 2] = gray; // B
                mask[y * width + x] = 0;
            }
            
            totalSampled++;
        }
        
        // Apply morphological operations to reduce noise (dilation then erosion)
        const smoothedMask = this.smoothMask(mask, width, height);
        
        // Use smoothed mask directly (less aggressive temporal smoothing for blood detection)
        // Temporal smoothing - average with previous frames (reduced for better responsiveness)
        this.detectionHistory.push(smoothedMask);
        if (this.detectionHistory.length > 2) { // Reduced from 3 to 2 for faster response
            this.detectionHistory.shift();
        }
        
        // Use current frame primarily, with light temporal smoothing
        let finalMask;
        if (this.detectionHistory.length >= 2) {
            // Light averaging - only if we have history
            finalMask = this.averageMasks(this.detectionHistory, width, height);
        } else {
            // Use current frame directly if no history yet
            finalMask = smoothedMask;
        }
        
        // Count detected pixels in final mask for accurate detection state
        let detectedPixelsInFinal = 0;
        for (let i = 0; i < finalMask.length; i++) {
            if (finalMask[i] === 1) {
                detectedPixelsInFinal++;
            }
        }
        
        const matchPercentage = matchingPixels / totalSampled;
        const isDetected = detectedPixelsInFinal > 0; // Use final mask for detection state
        
        // Vibrate when detection starts (transition from not detected to detected)
        if (isDetected && !this.lastDetectionState) {
            console.log('Red detected! Triggering vibration');
            this.vibrateOnDetection();
        } else if (isDetected && this.lastDetectionState && this.lastVibrationTime > 0) {
            // If detection is sustained, vibrate periodically (every 2 seconds)
            // Only do this if we've already had at least one vibration (lastVibrationTime > 0)
            const timeSinceLastVibration = Date.now() - this.lastVibrationTime;
            if (timeSinceLastVibration >= 2000) {
                console.log('Sustained red detection - periodic vibration');
                this.vibrateOnDetection();
            }
        }
        
        // Update detection state
        this.lastDetectionState = isDetected;
        
        // Update indicator only (no overlay message)
        if (isDetected) {
            this.indicator.classList.remove('hidden');
        } else {
            this.indicator.classList.add('hidden');
        }
        
        // Put modified image data back to canvas AFTER processing masks
        // This ensures the grayscale and color highlighting is visible
        this.ctx.putImageData(imageData, 0, 0);
        
        // Draw orbiting green circle for small detections AFTER putImageData
        // This ensures circles are drawn on top and visible on mobile
        // Use smoothedMask for more responsive detection (shows circles immediately)
        this.drawOrbitingCircle(smoothedMask, width, height);
        
        // Calculate FPS
        this.frameCount++;
        const now = Date.now();
        if (now - this.lastFpsTime >= 1000) {
            const fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
            this.fpsText.textContent = `FPS: ${fps}`;
        }
        
        // Continue detection loop
        this.animationFrame = requestAnimationFrame(() => this.detectColors());
        } catch (error) {
            console.error('Error in detectColors:', error);
            // Don't stop the camera on detection errors, just log and continue
            this.animationFrame = requestAnimationFrame(() => this.detectColors());
        }
    }
    
    smoothMask(mask, width, height) {
        // Light smoothing optimized for small blood spots
        // Use minimal smoothing to preserve small spots
        const smoothed = new Uint8Array(mask.length);
        
        // Copy border pixels as-is
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
                    smoothed[idx] = mask[idx];
                }
            }
        }
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                
                // If pixel is already detected, keep it
                if (mask[idx] === 1) {
                    smoothed[idx] = 1;
                    continue;
                }
                
                // Check 3x3 neighborhood - only fill if there's strong evidence (5+ neighbors)
                // This preserves small spots while reducing noise
                let count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (mask[(y + dy) * width + (x + dx)] === 1) {
                            count++;
                        }
                    }
                }
                // Only fill gaps if 5+ neighbors (more conservative to preserve small spots)
                smoothed[idx] = count >= 5 ? 1 : mask[idx];
            }
        }
        
        return smoothed;
    }
    
    averageMasks(masks, width, height) {
        if (masks.length === 0) return new Uint8Array(width * height);
        if (masks.length === 1) return masks[0];
        
        const averaged = new Uint8Array(width * height);
        // Use OR operation instead of majority vote - if detected in any frame, show it
        // This is better for small blood spots that might flicker
        for (let i = 0; i < width * height; i++) {
            let detected = 0;
            for (let j = 0; j < masks.length; j++) {
                if (masks[j][i] === 1) {
                    detected = 1;
                    break; // OR operation - if any frame has it, keep it
                }
            }
            averaged[i] = detected;
        }
        
        return averaged;
    }
}

// Tab Switching
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            document.getElementById(`${targetTab}Tab`).classList.add('active');
        });
    });
}

// Weather API Integration
class WeatherService {
    constructor() {
        this.zipCode = localStorage.getItem('lastZipCode') || '';
        this.setupEventListeners();
        this.loadStoredData();
    }
    
    setupEventListeners() {
        const getWeatherBtn = document.getElementById('getWeatherBtn');
        const zipCodeInput = document.getElementById('zipCode');
        
        getWeatherBtn.addEventListener('click', () => this.getWeather());
        zipCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.getWeather();
            }
        });
        
        // Load zip code if stored
        if (this.zipCode) {
            zipCodeInput.value = this.zipCode;
        }
    }
    
    loadStoredData() {
        // Automatically fetch weather if zip code is cached
        if (this.zipCode && this.zipCode.length === 5) {
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                this.getWeather();
            }, 100);
        }
    }
    
    async getWeather() {
        const zipCodeInput = document.getElementById('zipCode');
        const zipCode = zipCodeInput.value.trim();
        const weatherDisplay = document.getElementById('weatherDisplay');
        
        if (!zipCode || zipCode.length !== 5) {
            weatherDisplay.innerHTML = '<p class="weather-error">Please enter a valid 5-digit zip code</p>';
            return;
        }
        
        this.zipCode = zipCode;
        localStorage.setItem('lastZipCode', zipCode);
        
        weatherDisplay.innerHTML = '<p class="weather-placeholder">Loading weather data...</p>';
        
        try {
            // First, get coordinates from zip code using a geocoding service
            const coords = await this.getCoordinatesFromZip(zipCode);
            
            if (!coords) {
                throw new Error('Could not find location for zip code');
            }
            
            // Get weather data
            const weatherData = await this.fetchWeatherData(coords.lat, coords.lon);
            this.displayWeather(weatherData, coords.location);
        } catch (error) {
            console.error('Weather fetch error:', error);
            weatherDisplay.innerHTML = `<p class="weather-error">Error: ${error.message}. Please check your zip code.</p>`;
        }
    }
    
    async getCoordinatesFromZip(zipCode) {
        // Use a free geocoding service (Nominatim from OpenStreetMap)
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${zipCode}&country=US&format=json&limit=1`, { cache: 'no-store' });
            const data = await response.json();
            
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon),
                    location: data[0].display_name.split(',')[0] + ', ' + data[0].display_name.split(',')[1]?.trim()
                };
            }
            return null;
        } catch (error) {
            console.error('Geocoding error:', error);
            return null;
        }
    }
    
    async fetchWeatherData(lat, lon) {
        // Check if API key is configured
        console.log('WeatherService checking API key:', window.WEATHER_API_KEY ? 'Present' : 'Missing');
        if (!window.WEATHER_API_KEY || window.WEATHER_API_KEY === 'YOUR_API_KEY_HERE' || (window.WEATHER_API_KEY && window.WEATHER_API_KEY.trim() === '')) {
            throw new Error('OpenWeatherMap API key not configured. Please add your API key to weather-config.js and refresh the page (hard refresh: Ctrl+F5 or Cmd+Shift+R).');
        }
        
        // Fetch current weather and 5-day forecast from OpenWeatherMap
        // Use cache: 'no-store' to ensure fresh data on mobile
        const fetchOptions = { cache: 'no-store' };
        const [currentResponse, forecastResponse] = await Promise.all([
            fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${window.WEATHER_API_KEY}&units=imperial`, fetchOptions),
            fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${window.WEATHER_API_KEY}&units=imperial`, fetchOptions)
        ]);
        
        if (!currentResponse.ok || !forecastResponse.ok) {
            const errorData = await currentResponse.json().catch(() => ({ message: 'API request failed' }));
            if (currentResponse.status === 401 || forecastResponse.status === 401) {
                throw new Error('Invalid API key. Please verify your OpenWeatherMap API key is correct and activated. New keys may take up to 2 hours to activate. Check your key at https://home.openweathermap.org/api_keys');
            }
            throw new Error(errorData.message || `Failed to fetch weather data (Status: ${currentResponse.status})`);
        }
        
        const currentData = await currentResponse.json();
        const forecastData = await forecastResponse.json();
        
        // Transform OpenWeatherMap data to match our display format
        return this.transformOpenWeatherMapData(currentData, forecastData);
    }
    
    transformOpenWeatherMapData(currentData, forecastData) {
        console.log('Transforming OpenWeatherMap data...');
        // Transform OpenWeatherMap format to match our display format
        const current = {
            main: {
                temp: Math.round(currentData.main.temp),
                humidity: Math.round(currentData.main.humidity),
                pressure: Math.round(currentData.main.pressure * 0.02953) // Convert hPa to inHg (approximate)
            },
            weather: currentData.weather || [{ description: 'Unknown' }],
            wind: {
                speed: Math.round(currentData.wind.speed),
                deg: currentData.wind.deg || 0
            },
            sys: {
                sunrise: currentData.sys.sunrise * 1000, // Convert to milliseconds
                sunset: currentData.sys.sunset * 1000
            }
        };
        
        // Process forecast list (3-hour intervals for 5 days)
        const forecastList = forecastData.list || [];
        const now = new Date();
        const targetHours = [6, 9, 12, 15, 18];
        
        // Group forecast by day and extract hourly data
        const dailyForecasts = {};
        const allHourlyData = [];
        
        forecastList.forEach(item => {
            const itemDate = new Date(item.dt * 1000);
            const dayKey = itemDate.toISOString().split('T')[0];
            const hour = itemDate.getHours();
            
            // Collect hourly data for today's forecast (6am, 9am, 12pm, 3pm, 6pm)
            if (itemDate >= now && targetHours.includes(hour)) {
                allHourlyData.push({
                    time: itemDate.toISOString(),
                    temp: Math.round(item.main.temp),
                    weather_code: item.weather[0].id,
                    wind_speed: Math.round(item.wind.speed),
                    wind_direction: item.wind.deg || 0,
                    pressure: Math.round(item.main.pressure * 0.02953),
                    precipitation_probability: item.pop !== undefined ? Math.round(item.pop * 100) : null,
                    hour: hour
                });
            }
            
            // Group by day for daily forecast
            if (!dailyForecasts[dayKey]) {
                dailyForecasts[dayKey] = {
                    date: dayKey,
                    temps: [],
                    pressures: [],
                    windDirections: [],
                    precipProbs: [],
                    weatherCodes: [],
                    sunrise: null,
                    sunset: null
                };
            }
            
            dailyForecasts[dayKey].temps.push(item.main.temp);
            dailyForecasts[dayKey].pressures.push(item.main.pressure * 0.02953);
            dailyForecasts[dayKey].windDirections.push(item.wind.deg || 0);
            if (item.pop !== undefined) {
                dailyForecasts[dayKey].precipProbs.push(item.pop * 100);
            }
            dailyForecasts[dayKey].weatherCodes.push(item.weather[0].id);
        });
        
        // Sort hourly data by time and take first 5 unique hours
        allHourlyData.sort((a, b) => new Date(a.time) - new Date(b.time));
        const seenHours = new Set();
        const uniqueHourlyData = [];
        for (const item of allHourlyData) {
            if (!seenHours.has(item.hour) && uniqueHourlyData.length < 5) {
                seenHours.add(item.hour);
                uniqueHourlyData.push({
                    time: item.time,
                    temp: item.temp,
                    weather_code: item.weather_code,
                    wind_speed: item.wind_speed,
                    wind_direction: item.wind_direction,
                    pressure: item.pressure,
                    precipitation_probability: item.precipitation_probability
                });
            }
        }
        
        // Sort by hour to ensure correct order (6am, 9am, 12pm, 3pm, 6pm)
        uniqueHourlyData.sort((a, b) => {
            const hourA = new Date(a.time).getHours();
            const hourB = new Date(b.time).getHours();
            return hourA - hourB;
        });
        
        // Create daily forecast list (next 5 days, excluding today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const forecastDays = Object.keys(dailyForecasts)
            .sort()
            .filter(dayKey => {
                const dayDate = new Date(dayKey + 'T00:00:00');
                return dayDate.getTime() > today.getTime();
            })
            .slice(0, 5)
            .map(dayKey => {
                const day = dailyForecasts[dayKey];
                const dayDate = new Date(dayKey + 'T00:00:00');
                
                // Calculate temperature range
                const minTemp = Math.round(Math.min(...day.temps));
                const maxTemp = Math.round(Math.max(...day.temps));
                const tempRange = minTemp === maxTemp ? `${maxTemp}°F` : `${minTemp}-${maxTemp}°F`;
                
                // Calculate pressure range
                const pressures = day.pressures.map(p => {
                    const pInHg = Math.round(p);
                    if (pInHg > 30.2) return 'High';
                    if (pInHg < 29.7) return 'Low';
                    return 'Mid';
                });
                const uniquePressures = pressures.filter((p, i) => i === 0 || p !== pressures[i - 1]);
                const pressureRange = uniquePressures.length === 1 ? uniquePressures[0] : uniquePressures.join('-');
                
                // Calculate wind direction
                const windDirs = day.windDirections.map(d => this.getWindDirection(d));
                const startDir = windDirs[0];
                const allSame = windDirs.every(d => d === startDir);
                const windDisplay = allSame ? startDir : `${startDir}--${windDirs[windDirs.length - 1]}`;
                
                // Get max precipitation probability
                const maxPrecipProb = day.precipProbs.length > 0 ? Math.round(Math.max(...day.precipProbs)) : null;
                
                // Get most common weather code for the day
                const weatherCodeCounts = {};
                day.weatherCodes.forEach(code => {
                    weatherCodeCounts[code] = (weatherCodeCounts[code] || 0) + 1;
                });
                const mostCommonCode = Object.keys(weatherCodeCounts).reduce((a, b) => 
                    weatherCodeCounts[a] > weatherCodeCounts[b] ? a : b
                );
                
                return {
                    dt_txt: dayKey,
                    main: {
                        temp: tempRange,
                        temp_min: minTemp,
                        temp_max: maxTemp,
                        pressure: pressureRange
                    },
                    weather: [{ 
                        description: this.getWeatherDescription(parseInt(mostCommonCode)),
                        id: parseInt(mostCommonCode)
                    }],
                    sunrise: null, // OpenWeatherMap forecast doesn't include daily sunrise/sunset
                    sunset: null,
                    wind_direction: windDisplay,
                    precipitation_probability: maxPrecipProb
                };
            });
        
        return {
            current: {
                main: current.main,
                weather: current.weather,
                wind: current.wind
            },
            forecast: {
                list: forecastDays
            },
            hourly: uniqueHourlyData,
            sunrise: new Date(current.sys.sunrise).toISOString(),
            sunset: new Date(current.sys.sunset).toISOString(),
            weatherCodes: {} // Not needed for OpenWeatherMap
        };
    }
    
    getWeatherDescription(weatherId) {
        // Map OpenWeatherMap weather IDs to descriptions
        if (weatherId >= 200 && weatherId < 300) return 'Thunderstorm';
        if (weatherId >= 300 && weatherId < 400) return 'Drizzle';
        if (weatherId >= 500 && weatherId < 600) return 'Rain';
        if (weatherId >= 600 && weatherId < 700) return 'Snow';
        if (weatherId >= 700 && weatherId < 800) return 'Mist';
        if (weatherId === 800) return 'Clear sky';
        if (weatherId === 801) return 'Few clouds';
        if (weatherId === 802) return 'Scattered clouds';
        if (weatherId === 803) return 'Broken clouds';
        if (weatherId === 804) return 'Overcast clouds';
        return 'Unknown';
    }
    
    formatDateWithMonth(date) {
        // Format date as "Thursday December 4th"
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        const dayName = days[date.getDay()];
        const monthName = months[date.getMonth()];
        const day = date.getDate();
        
        // Add ordinal suffix
        let suffix = 'th';
        if (day === 1 || day === 21 || day === 31) {
            suffix = 'st';
        } else if (day === 2 || day === 22) {
            suffix = 'nd';
        } else if (day === 3 || day === 23) {
            suffix = 'rd';
        }
        
        return `${dayName} ${monthName} ${day}${suffix}`;
    }
    
    transformOpenMeteoData(data) {
        const current = data.current;
        const hourly = data.hourly;
        const daily = data.daily;
        
        // Map weather codes to descriptions
        const weatherCodes = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Foggy',
            48: 'Depositing rime fog',
            51: 'Light drizzle',
            53: 'Moderate drizzle',
            55: 'Dense drizzle',
            61: 'Slight rain',
            63: 'Moderate rain',
            65: 'Heavy rain',
            71: 'Slight snow',
            73: 'Moderate snow',
            75: 'Heavy snow',
            80: 'Slight rain showers',
            81: 'Moderate rain showers',
            82: 'Violent rain showers',
            85: 'Slight snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm with slight hail',
            99: 'Thunderstorm with heavy hail'
        };
        
        const currentWeather = {
            main: { 
                temp: Math.round(current.temperature_2m),
                humidity: Math.round(current.relative_humidity_2m),
                pressure: current.surface_pressure ? Math.round(current.surface_pressure) : null
            },
            weather: [{ description: weatherCodes[current.weather_code] || 'Unknown', main: 'Clear' }],
            wind: { speed: Math.round(current.wind_speed_10m), deg: current.wind_direction_10m }
        };
        
        // Get hourly data for specific times: 6am, 9am, 12pm, 3pm, 6pm
        const now = new Date();
        const targetHours = [6, 9, 12, 15, 18]; // 6am, 9am, 12pm, 3pm, 6pm
        const hourlyData = [];
        if (hourly && hourly.time) {
            // Collect all matching hours from today and tomorrow
            const allMatchingHours = [];
            
            for (let i = 0; i < hourly.time.length; i++) {
                const hourTime = new Date(hourly.time[i]);
                const hour = hourTime.getHours();
                
                // Only include if it's in the future and matches target hours
                if (hourTime >= now && targetHours.includes(hour)) {
                    allMatchingHours.push({
                        time: hourly.time[i],
                        temp: Math.round(hourly.temperature_2m[i]),
                        weather_code: hourly.weather_code[i],
                        wind_speed: Math.round(hourly.wind_speed_10m[i]),
                        wind_direction: hourly.wind_direction_10m[i],
                        pressure: hourly.surface_pressure ? Math.round(hourly.surface_pressure[i]) : null,
                        precipitation_probability: hourly.precipitation_probability && hourly.precipitation_probability[i] !== undefined ? Math.round(hourly.precipitation_probability[i]) : null,
                        hour: hour // Store hour for sorting
                    });
                }
            }
            
            // Sort by time to ensure correct chronological order
            allMatchingHours.sort((a, b) => new Date(a.time) - new Date(b.time));
            
            // Take first 5, ensuring we have unique hours in order
            const seenHours = new Set();
            for (const item of allMatchingHours) {
                if (hourlyData.length >= 5) break;
                if (!seenHours.has(item.hour)) {
                    seenHours.add(item.hour);
                    hourlyData.push({
                        time: item.time,
                        temp: item.temp,
                        weather_code: item.weather_code,
                        wind_speed: item.wind_speed,
                        wind_direction: item.wind_direction,
                        pressure: item.pressure,
                        precipitation_probability: item.precipitation_probability
                    });
                }
            }
            
            // Final sort to ensure 6am, 9am, 12pm, 3pm, 6pm order
            hourlyData.sort((a, b) => {
                const hourA = new Date(a.time).getHours();
                const hourB = new Date(b.time).getHours();
                return hourA - hourB;
            });
        }
        
        // Get today's sunrise/sunset
        const todaySunrise = daily.sunrise && daily.sunrise[0] ? daily.sunrise[0] : null;
        const todaySunset = daily.sunset && daily.sunset[0] ? daily.sunset[0] : null;
        
        // Process forecast days with hourly wind direction data
        // Get 6 days: today + next 5 days
        const forecast = {
            list: daily.time.slice(0, 6).map((time, index) => {
                const dayDate = new Date(time);
                dayDate.setHours(0, 0, 0, 0);
                const nextDay = new Date(dayDate);
                nextDay.setDate(nextDay.getDate() + 1);
                
                // Get hourly data for 6am-6pm range for this day
                const dayStart = new Date(dayDate);
                dayStart.setHours(6, 0, 0, 0);
                const dayEnd = new Date(dayDate);
                dayEnd.setHours(18, 59, 59, 999);
                
                const dayTemps = [];
                const dayPressures = [];
                const dayWindDirections = [];
                const dayPrecipProb = [];
                
                if (hourly && hourly.time) {
                    for (let i = 0; i < hourly.time.length; i++) {
                        const hourTime = new Date(hourly.time[i]);
                        if (hourTime >= dayStart && hourTime <= dayEnd) {
                            const hour = hourTime.getHours();
                            // Only include 6am, 9am, 12pm, 3pm, 6pm
                            if ([6, 9, 12, 15, 18].includes(hour)) {
                                if (hourly.temperature_2m && hourly.temperature_2m[i] !== undefined) {
                                    dayTemps.push(Math.round(hourly.temperature_2m[i]));
                                }
                                if (hourly.surface_pressure && hourly.surface_pressure[i] !== undefined) {
                                    dayPressures.push(Math.round(hourly.surface_pressure[i]));
                                }
                                if (hourly.wind_direction_10m && hourly.wind_direction_10m[i] !== undefined) {
                                    dayWindDirections.push(hourly.wind_direction_10m[i]);
                                }
                                if (hourly.precipitation_probability && hourly.precipitation_probability[i] !== undefined) {
                                    dayPrecipProb.push(hourly.precipitation_probability[i]);
                                }
                            }
                        }
                    }
                }
                
                // Get max precipitation probability for the day (from daily data if available, otherwise from hourly)
                let maxPrecipProb = null;
                if (daily.precipitation_probability_max && daily.precipitation_probability_max[index] !== undefined) {
                    maxPrecipProb = Math.round(daily.precipitation_probability_max[index]);
                } else if (dayPrecipProb.length > 0) {
                    maxPrecipProb = Math.round(Math.max(...dayPrecipProb));
                }
                
                // Calculate temperature range (6am-6pm)
                let tempRange = 'N/A';
                if (dayTemps.length > 0) {
                    const minTemp = Math.min(...dayTemps);
                    const maxTemp = Math.max(...dayTemps);
                    if (minTemp === maxTemp) {
                        tempRange = `${maxTemp}°F`;
                    } else {
                        tempRange = `${minTemp}-${maxTemp}°F`;
                    }
                }
                
                // Calculate pressure range/changes (6am-6pm)
                let pressureRange = 'N/A';
                if (dayPressures.length > 0) {
                    const pressureLabels = dayPressures.map(p => {
                        if (p > 1020) return 'High';
                        if (p < 1006) return 'Low';
                        return 'Mid';
                    });
                    
                    // Remove consecutive duplicates
                    const uniqueLabels = [];
                    for (let i = 0; i < pressureLabels.length; i++) {
                        if (i === 0 || pressureLabels[i] !== pressureLabels[i - 1]) {
                            uniqueLabels.push(pressureLabels[i]);
                        }
                    }
                    
                    if (uniqueLabels.length === 1) {
                        pressureRange = uniqueLabels[0];
                    } else {
                        pressureRange = uniqueLabels.join('-');
                    }
                }
                
                // Calculate wind direction display
                let windDisplay = 'N/A';
                if (dayWindDirections.length > 0) {
                    const startDir = this.getWindDirection(dayWindDirections[0]);
                    const endDir = this.getWindDirection(dayWindDirections[dayWindDirections.length - 1]);
                    
                    // Check if all directions are the same
                    const allSame = dayWindDirections.every(dir => {
                        const dirStr = this.getWindDirection(dir);
                        return dirStr === startDir;
                    });
                    
                    if (allSame) {
                        windDisplay = startDir;
                    } else {
                        windDisplay = `${startDir}--${endDir}`;
                    }
                }
                
                return {
                    dt_txt: time,
                    main: { 
                        temp: tempRange, // Now contains range string
                        temp_min: dayTemps.length > 0 ? Math.min(...dayTemps) : null,
                        temp_max: dayTemps.length > 0 ? Math.max(...dayTemps) : null,
                        pressure: pressureRange // Now contains range string like "High-Mid-Low"
                    },
                    weather: [{ description: weatherCodes[daily.weather_code[index]] || 'Unknown' }],
                    sunrise: daily.sunrise && daily.sunrise[index] ? daily.sunrise[index] : null,
                    sunset: daily.sunset && daily.sunset[index] ? daily.sunset[index] : null,
                    wind_direction: windDisplay,
                    precipitation_probability: maxPrecipProb
                };
            })
        };
        
        return { 
            current: currentWeather, 
            forecast,
            hourly: hourlyData,
            sunrise: todaySunrise,
            sunset: todaySunset,
            weatherCodes,
            hourlyRaw: hourly // Keep raw hourly data for processing
        };
    }
    
    displayWeather(data, location) {
        const weatherDisplay = document.getElementById('weatherDisplay');
        const current = data.current;
        const forecast = data.forecast;
        const hourly = data.hourly || [];
        const sunrise = data.sunrise;
        const sunset = data.sunset;
        const weatherCodes = data.weatherCodes;
        
        // Get wind direction
        const windDir = this.getWindDirection(current.wind.deg);
        
        // Format sunrise/sunset times
        const formatTime = (timeString) => {
            if (!timeString) return 'N/A';
            const date = new Date(timeString);
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        };
        
        // Format pressure: convert hPa to inHg and add High/Low/Mid indicator
        const formatPressure = (pressureHpa) => {
            if (!pressureHpa) return 'N/A';
            const pressureInHg = (pressureHpa * 0.02953).toFixed(2);
            let pressureLabel = '';
            if (pressureHpa > 1020) {
                pressureLabel = ' (High)';
            } else if (pressureHpa < 1006) {
                pressureLabel = ' (Low)';
            } else {
                pressureLabel = ' (Mid)';
            }
            return `${pressureInHg}" ${pressureLabel}`;
        };
        
        // Get pressure label only (High/Mid/Low) for hourly forecast
        const getPressureLabel = (pressureHpa) => {
            if (!pressureHpa) return 'N/A';
            if (pressureHpa > 1020) {
                return 'High';
            } else if (pressureHpa < 1006) {
                return 'Low';
            } else {
                return 'Mid';
            }
        };
        
        let html = `
            <div class="weather-current">
                <div class="weather-location">${location || 'Current Location'}</div>
                <div class="weather-temp">${Math.round(current.main.temp)}°F</div>
                <div class="weather-description">${current.weather[0].description}</div>
                
                <div class="weather-details">
                    <div class="weather-detail-item">
                        <div class="weather-detail-label">Wind Direction</div>
                        <div class="weather-detail-value">${windDir}</div>
                    </div>
                    <div class="weather-detail-item">
                        <div class="weather-detail-label">Wind Speed</div>
                        <div class="weather-detail-value">${Math.round(current.wind.speed)} mph</div>
                    </div>
                    <div class="weather-detail-item">
                        <div class="weather-detail-label">Humidity</div>
                        <div class="weather-detail-value">${current.main.humidity}%</div>
                    </div>
                    <div class="weather-detail-item">
                        <div class="weather-detail-label">Sunrise</div>
                        <div class="weather-detail-value">${formatTime(sunrise)}</div>
                    </div>
                    <div class="weather-detail-item">
                        <div class="weather-detail-label">Sunset</div>
                        <div class="weather-detail-value">${formatTime(sunset)}</div>
                    </div>
                    ${current.main.pressure ? `
                    <div class="weather-detail-item">
                        <div class="weather-detail-label">Pressure</div>
                        <div class="weather-detail-value">${formatPressure(current.main.pressure)}</div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Add hourly forecast section
        if (hourly.length > 0) {
            html += `
                <div class="weather-hourly">
                    <h3>Today's Forecast</h3>
                    <div class="hourly-items">
            `;
            
            hourly.forEach((hour) => {
                const hourDate = new Date(hour.time);
                const hourLabel = hourDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
                const hourWindDir = this.getWindDirection(hour.wind_direction);
                // Get weather description - handle both OpenWeatherMap and Open-Meteo formats
                let weatherDesc = 'Unknown';
                if (hour.weather_code !== undefined) {
                    if (weatherCodes[hour.weather_code]) {
                        weatherDesc = weatherCodes[hour.weather_code];
                    } else {
                        weatherDesc = this.getWeatherDescription(hour.weather_code);
                    }
                }
                
                html += `
                    <div class="hourly-item">
                        <div class="hourly-time">${hourLabel}</div>
                        <div class="hourly-temp">${hour.temp}°F</div>
                        <div class="hourly-desc">${weatherDesc}</div>
                        <div class="hourly-wind">${hourWindDir} ${hour.wind_speed} mph</div>
                        ${hour.pressure ? `<div class="hourly-pressure">Pressure: ${getPressureLabel(hour.pressure)}</div>` : ''}
                        ${hour.precipitation_probability !== null ? `<div class="hourly-precip">Precipitation: ${hour.precipitation_probability}%</div>` : ''}
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        if (forecast && forecast.list && forecast.list.length > 0) {
            html += `
                <div class="weather-forecast">
                    <h3>5-Day Forecast</h3>
                    <div class="forecast-items">
            `;
            
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Filter out today and show only next 5 days
            const forecastDays = forecast.list.filter((item) => {
                const dateStr = item.dt_txt;
                const itemDate = new Date(dateStr + 'T00:00:00');
                itemDate.setHours(0, 0, 0, 0);
                return itemDate.getTime() > today.getTime();
            }).slice(0, 5);
            
            forecastDays.forEach((item) => {
                // Parse date string in a timezone-safe way
                const dateStr = item.dt_txt;
                // Handle ISO date strings (YYYY-MM-DD format from Open-Meteo)
                const date = new Date(dateStr + 'T00:00:00');
                const dayName = this.formatDateWithMonth(date);
                
                html += `
                    <div class="forecast-item">
                        <div class="forecast-day">${dayName}</div>
                        <div class="forecast-temp">${item.main.temp}</div>
                        <div class="forecast-desc">${item.weather[0].description}</div>
                        <div class="forecast-wind">Wind: ${item.wind_direction || 'N/A'}</div>
                        ${item.main.pressure ? `<div class="forecast-pressure">Pressure: ${item.main.pressure}</div>` : ''}
                        ${item.precipitation_probability !== null ? `<div class="forecast-precip">Precipitation: ${item.precipitation_probability}%</div>` : ''}
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        weatherDisplay.innerHTML = html;
    }
    
    getWindDirection(degrees) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(degrees / 22.5) % 16;
        return directions[index];
    }
}

// Moon Phase and Deer Movement Prediction
class MoonService {
    constructor() {
        this.zipCode = localStorage.getItem('moonZipCode') || '';
        this.setupEventListeners();
        this.loadStoredData();
    }
    
    setupEventListeners() {
        const getMoonDataBtn = document.getElementById('getMoonDataBtn');
        const moonZipCodeInput = document.getElementById('moonZipCode');
        
        getMoonDataBtn.addEventListener('click', () => this.getMoonData());
        moonZipCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.getMoonData();
            }
        });
        
        // Load zip code if stored
        if (this.zipCode) {
            moonZipCodeInput.value = this.zipCode;
        }
    }
    
    loadStoredData() {
        // Automatically fetch movement data if zip code is cached
        if (this.zipCode && this.zipCode.length === 5) {
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                this.getMoonData();
            }, 100);
        }
    }
    
    async getMoonData() {
        const moonZipCodeInput = document.getElementById('moonZipCode');
        const zipCode = moonZipCodeInput.value.trim();
        const moonDisplay = document.getElementById('moonDisplay');
        
        if (!zipCode || zipCode.length !== 5) {
            moonDisplay.innerHTML = '<p class="moon-placeholder" style="color: var(--primary-color);">Please enter a valid 5-digit zip code</p>';
            return;
        }
        
        this.zipCode = zipCode;
        localStorage.setItem('moonZipCode', zipCode);
        
        moonDisplay.innerHTML = '<p class="moon-placeholder">Loading deer movement forecast...</p>';
        
        try {
            // Get coordinates from zip code
            const coords = await this.getCoordinatesFromZip(zipCode);
            
            if (!coords) {
                throw new Error('Could not find location for zip code');
            }
            
            // Get weather data (we'll reuse the weather API)
            const weatherData = await this.fetchWeatherData(coords.lat, coords.lon);
            
            // Calculate and display deer movement predictions
            this.displayMoonData(weatherData, coords.location);
        } catch (error) {
            console.error('Moon data fetch error:', error);
            moonDisplay.innerHTML = `<p class="moon-placeholder" style="color: var(--primary-color);">Error: ${error.message}. Please check your zip code.</p>`;
        }
    }
    
    async getCoordinatesFromZip(zipCode) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${zipCode}&country=US&format=json&limit=1`, { cache: 'no-store' });
            const data = await response.json();
            
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon),
                    location: data[0].display_name.split(',')[0] + ', ' + data[0].display_name.split(',')[1]?.trim()
                };
            }
            return null;
        } catch (error) {
            console.error('Geocoding error:', error);
            return null;
        }
    }
    
    async fetchWeatherData(lat, lon) {
        // Check if API key is configured
        console.log('MoonService checking API key:', window.WEATHER_API_KEY ? 'Present' : 'Missing');
        if (!window.WEATHER_API_KEY || window.WEATHER_API_KEY === 'YOUR_API_KEY_HERE' || window.WEATHER_API_KEY.trim() === '') {
            throw new Error('OpenWeatherMap API key not configured. Please add your API key to weather-config.js and refresh the page (hard refresh: Ctrl+F5).');
        }
        
        // Fetch current weather and 5-day forecast from OpenWeatherMap
        // Use cache: 'no-store' to ensure fresh data on mobile
        const fetchOptions = { cache: 'no-store' };
        const [currentResponse, forecastResponse] = await Promise.all([
            fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${window.WEATHER_API_KEY}&units=imperial`, fetchOptions),
            fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${window.WEATHER_API_KEY}&units=imperial`, fetchOptions)
        ]);
        
        if (!currentResponse.ok || !forecastResponse.ok) {
            const errorData = await currentResponse.json().catch(() => ({ message: 'API request failed' }));
            if (currentResponse.status === 401 || forecastResponse.status === 401) {
                throw new Error('Invalid API key. Please verify your OpenWeatherMap API key is correct and activated. New keys may take up to 2 hours to activate. Check your key at https://home.openweathermap.org/api_keys');
            }
            throw new Error(errorData.message || `Failed to fetch weather data (Status: ${currentResponse.status})`);
        }
        
        const currentData = await currentResponse.json();
        const forecastData = await forecastResponse.json();
        
        // Return data in format expected by displayMoonData
        // Transform to match Open-Meteo format for compatibility
        const daily = {
            time: [],
            temperature_2m_max: [],
            temperature_2m_min: [],
            weather_code: [],
            sunrise: [],
            sunset: []
        };
        
        // Group forecast by day
        const dailyData = {};
        forecastData.list.forEach(item => {
            const itemDate = new Date(item.dt * 1000);
            const dayKey = itemDate.toISOString().split('T')[0];
            
            if (!dailyData[dayKey]) {
                dailyData[dayKey] = {
                    temps: [],
                    weatherCodes: []
                };
            }
            
            dailyData[dayKey].temps.push(item.main.temp);
            dailyData[dayKey].weatherCodes.push(item.weather[0].id);
        });
        
        // Get base sunrise/sunset from current weather
        const baseSunrise = new Date(currentData.sys.sunrise * 1000);
        const baseSunset = new Date(currentData.sys.sunset * 1000);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Convert to daily format
        Object.keys(dailyData).sort().forEach((dayKey, index) => {
            const day = dailyData[dayKey];
            const dayDate = new Date(dayKey + 'T00:00:00');
            const daysFromToday = Math.round((dayDate - today) / (1000 * 60 * 60 * 24));
            
            daily.time.push(dayKey);
            daily.temperature_2m_max.push(Math.max(...day.temps));
            daily.temperature_2m_min.push(Math.min(...day.temps));
            // Get most common weather code
            const codeCounts = {};
            day.weatherCodes.forEach(code => {
                codeCounts[code] = (codeCounts[code] || 0) + 1;
            });
            const mostCommonCode = Object.keys(codeCounts).reduce((a, b) => 
                codeCounts[a] > codeCounts[b] ? a : b
            );
            daily.weather_code.push(parseInt(mostCommonCode));
            
            // Approximate sunrise/sunset for each day (adjust by ~1 minute per day)
            // In reality, this varies by location and season, but this is a reasonable approximation
            const adjustedSunrise = new Date(baseSunrise);
            adjustedSunrise.setDate(adjustedSunrise.getDate() + daysFromToday);
            const adjustedSunset = new Date(baseSunset);
            adjustedSunset.setDate(adjustedSunset.getDate() + daysFromToday);
            
            daily.sunrise.push(adjustedSunrise.toISOString());
            daily.sunset.push(adjustedSunset.toISOString());
        });
        
        // Process hourly data
        const hourly = {
            time: [],
            temperature_2m: [],
            weather_code: [],
            wind_speed_10m: [],
            wind_direction_10m: []
        };
        
        forecastData.list.forEach(item => {
            const itemDate = new Date(item.dt * 1000);
            hourly.time.push(itemDate.toISOString());
            hourly.temperature_2m.push(item.main.temp);
            hourly.weather_code.push(item.weather[0].id);
            hourly.wind_speed_10m.push(item.wind.speed);
            hourly.wind_direction_10m.push(item.wind.deg || 0);
        });
        
        return {
            daily: daily,
            hourly: hourly
        };
    }
    
    calculateMoonPhase(date) {
        // Calculate days since last new moon (Jan 6, 2000)
        const knownNewMoon = new Date('2000-01-06T18:14:00Z');
        const daysSince = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
        const lunarCycle = 29.53058867;
        const phase = (daysSince % lunarCycle) / lunarCycle;
        
        if (phase < 0.03 || phase > 0.97) return 'New Moon';
        if (phase < 0.22) return 'Waxing Crescent';
        if (phase < 0.28) return 'First Quarter';
        if (phase < 0.47) return 'Waxing Gibbous';
        if (phase < 0.53) return 'Full Moon';
        if (phase < 0.72) return 'Waning Gibbous';
        if (phase < 0.78) return 'Last Quarter';
        return 'Waning Crescent';
    }
    
    getMoonIconSVG(moonPhase) {
        const size = 24;
        const center = size / 2;
        const radius = size / 2 - 2;
        
        // Create SVG based on moon phase
        let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display: inline-block; vertical-align: middle; margin-right: 6px;">`;
        
        switch(moonPhase) {
            case 'New Moon':
                // Dark circle (new moon)
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#333" stroke="#666" stroke-width="1"/>`;
                break;
                
            case 'Waxing Crescent':
                // Right side lit - small crescent on right
                // Draw dark background, then lit crescent using path with evenodd fill rule
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#333" stroke="#666" stroke-width="1"/>`;
                const crescentX = center - radius * 0.5;
                const shadowRadius = radius * 0.9;
                svg += `<path d="M ${center} ${center - radius} A ${radius} ${radius} 0 0 1 ${center} ${center + radius} A ${radius} ${radius} 0 0 1 ${center} ${center - radius} M ${crescentX} ${center} A ${shadowRadius} ${shadowRadius} 0 1 1 ${crescentX} ${center - 0.1} Z" fill="#ffd700" fill-rule="evenodd"/>`;
                break;
                
            case 'First Quarter':
                // Right half lit
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#333" stroke="#666" stroke-width="1"/>`;
                svg += `<path d="M ${center} ${center - radius} A ${radius} ${radius} 0 0 1 ${center} ${center + radius} L ${center} ${center} Z" fill="#ffd700"/>`;
                break;
                
            case 'Waxing Gibbous':
                // Mostly lit, small dark crescent on left
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#ffd700" stroke="#666" stroke-width="1"/>`;
                const gibbousX = center + radius * 0.5;
                const gibbousShadowRadius = radius * 0.9;
                svg += `<path d="M ${center} ${center - radius} A ${radius} ${radius} 0 0 0 ${center} ${center + radius} A ${radius} ${radius} 0 0 0 ${center} ${center - radius} M ${gibbousX} ${center} A ${gibbousShadowRadius} ${gibbousShadowRadius} 0 1 0 ${gibbousX} ${center - 0.1} Z" fill="#333" fill-rule="evenodd"/>`;
                break;
                
            case 'Full Moon':
                // Fully lit circle
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#ffd700" stroke="#666" stroke-width="1"/>`;
                break;
                
            case 'Waning Gibbous':
                // Mostly lit, small dark crescent on right
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#ffd700" stroke="#666" stroke-width="1"/>`;
                const waningGibbousX = center - radius * 0.5;
                const waningGibbousShadowRadius = radius * 0.9;
                svg += `<path d="M ${center} ${center - radius} A ${radius} ${radius} 0 0 1 ${center} ${center + radius} A ${radius} ${radius} 0 0 1 ${center} ${center - radius} M ${waningGibbousX} ${center} A ${waningGibbousShadowRadius} ${waningGibbousShadowRadius} 0 1 0 ${waningGibbousX} ${center - 0.1} Z" fill="#333" fill-rule="evenodd"/>`;
                break;
                
            case 'Last Quarter':
                // Left half lit
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#333" stroke="#666" stroke-width="1"/>`;
                svg += `<path d="M ${center} ${center - radius} A ${radius} ${radius} 0 0 0 ${center} ${center + radius} L ${center} ${center} Z" fill="#ffd700"/>`;
                break;
                
            case 'Waning Crescent':
                // Left side lit - small crescent on left
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#333" stroke="#666" stroke-width="1"/>`;
                const waningCrescentX = center + radius * 0.5;
                const waningCrescentShadowRadius = radius * 0.9;
                svg += `<path d="M ${center} ${center - radius} A ${radius} ${radius} 0 0 0 ${center} ${center + radius} A ${radius} ${radius} 0 0 0 ${center} ${center - radius} M ${waningCrescentX} ${center} A ${waningCrescentShadowRadius} ${waningCrescentShadowRadius} 0 1 0 ${waningCrescentX} ${center - 0.1} Z" fill="#ffd700" fill-rule="evenodd"/>`;
                break;
                
            default:
                // Default to full moon
                svg += `<circle cx="${center}" cy="${center}" r="${radius}" fill="#ffd700" stroke="#666" stroke-width="1"/>`;
        }
        
        svg += `</svg>`;
        return svg;
    }
    
    formatDateWithMonth(date) {
        // Format date as "Thursday December 4th"
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        const dayName = days[date.getDay()];
        const monthName = months[date.getMonth()];
        const day = date.getDate();
        
        // Add ordinal suffix
        let suffix = 'th';
        if (day === 1 || day === 21 || day === 31) {
            suffix = 'st';
        } else if (day === 2 || day === 22) {
            suffix = 'nd';
        } else if (day === 3 || day === 23) {
            suffix = 'rd';
        }
        
        return `${dayName} ${monthName} ${day}${suffix}`;
    }
    
    calculateDeerActivityScore(temp, windSpeed, moonPhase, hour, sunrise, sunset) {
        let score = 0; // Start from 0 for more disparity
        
        // Temperature factor (optimal: 40-60°F) - More points for optimal conditions
        if (temp >= 40 && temp <= 60) {
            score += 35; // Best conditions
        } else if (temp >= 35 && temp < 40) {
            score += 25;
        } else if (temp > 60 && temp <= 65) {
            score += 25;
        } else if (temp >= 30 && temp < 35) {
            score += 15;
        } else if (temp > 65 && temp <= 70) {
            score += 15;
        } else if (temp >= 25 && temp < 30) {
            score += 8;
        } else if (temp > 70 && temp <= 75) {
            score += 8;
        } else if (temp >= 20 && temp < 25) {
            score += 3;
        } else if (temp > 75 && temp <= 80) {
            score += 3;
        } else {
            score -= 5; // Too hot or too cold
        }
        
        // Wind speed factor (calm is best) - More dramatic differences
        if (windSpeed < 3) {
            score += 30; // Very calm - excellent
        } else if (windSpeed < 5) {
            score += 25;
        } else if (windSpeed < 8) {
            score += 18;
        } else if (windSpeed < 10) {
            score += 12;
        } else if (windSpeed < 12) {
            score += 6;
        } else if (windSpeed < 15) {
            score += 2;
        } else if (windSpeed < 20) {
            score -= 5; // Getting too windy
        } else {
            score -= 15; // Very windy - poor conditions
        }
        
        // Moon phase factor - More variation
        if (moonPhase === 'New Moon' || moonPhase === 'Full Moon') {
            score += 25; // Best moon phases
        } else if (moonPhase === 'Waxing Gibbous' || moonPhase === 'Waning Gibbous') {
            score += 18;
        } else if (moonPhase === 'First Quarter' || moonPhase === 'Last Quarter') {
            score += 10;
        } else if (moonPhase === 'Waxing Crescent' || moonPhase === 'Waning Crescent') {
            score += 5;
        }
        
        // Time of day factor (dawn and dusk are best) - More emphasis
        const sunriseHour = new Date(sunrise).getHours();
        const sunsetHour = new Date(sunset).getHours();
        
        // Check if within 2 hours of sunrise or sunset
        const hoursFromSunrise = Math.abs(hour - sunriseHour);
        const hoursFromSunset = Math.abs(hour - sunsetHour);
        
        if (hoursFromSunrise <= 1 || hoursFromSunset <= 1) {
            score += 30; // Peak times - very close to sunrise/sunset
        } else if (hoursFromSunrise <= 2 || hoursFromSunset <= 2) {
            score += 25;
        } else if (hoursFromSunrise <= 3 || hoursFromSunset <= 3) {
            score += 15;
        } else if (hour >= 6 && hour <= 10) {
            score += 8; // Morning hours
        } else if (hour >= 16 && hour <= 20) {
            score += 8; // Evening hours
        } else if (hour >= 10 && hour <= 16) {
            score += 2; // Midday - less activity
        } else {
            score -= 5; // Night hours - minimal activity
        }
        
        // Normalize score to 0-100, but allow for more spread
        return Math.max(0, Math.min(100, score));
    }
    
    displayMoonData(weatherData, location) {
        const moonDisplay = document.getElementById('moonDisplay');
        const daily = weatherData.daily;
        const hourly = weatherData.hourly;
        
        let html = `
            <div style="text-align: center; margin-bottom: 20px;">
                <h3 style="color: var(--text-primary); margin-bottom: 5px;">${location || 'Current Location'}</h3>
                <p style="color: var(--text-secondary); font-size: 14px;">Deer Movement Forecast</p>
            </div>
        `;
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Process next 5 days (excluding today)
        let daysShown = 0;
        const maxDays = Math.min(7, daily.time.length); // Check up to 7 days to find 5 future days
        for (let i = 0; i < maxDays && daysShown < 5; i++) {
            // Parse date string in a timezone-safe way
            const dateStr = daily.time[i];
            // Handle ISO date strings (YYYY-MM-DD format from Open-Meteo)
            const dayDate = new Date(dateStr + 'T00:00:00');
            dayDate.setHours(0, 0, 0, 0);
            
            // Skip today - only show future days
            if (dayDate.getTime() <= today.getTime()) {
                continue;
            }
            
            daysShown++;
            
            const dayName = this.formatDateWithMonth(dayDate);
            const moonPhase = this.calculateMoonPhase(dayDate);
            const sunrise = daily.sunrise[i];
            const sunset = daily.sunset[i];
            const maxTemp = daily.temperature_2m_max[i];
            const minTemp = daily.temperature_2m_min[i];
            const avgTemp = (maxTemp + minTemp) / 2;
            
            // Get hourly data for this day - group into time ranges
            const dayStart = new Date(dayDate);
            const dayEnd = new Date(dayDate);
            dayEnd.setDate(dayEnd.getDate() + 1);
            
            // Define time ranges: [startHour, endHour, label]
            // Show all 7 time ranges with individual scores
            const timeRanges = [
                [6, 8, '6am-8am'],
                [8, 10, '8am-10am'],
                [10, 12, '10am-12pm'],
                [12, 14, '12pm-2pm'],
                [14, 16, '2pm-4pm'],
                [16, 18, '4pm-6pm'],
                [18, 20, '6pm-8pm']
            ];
            
            const dayTimeRanges = [];
            
            // Get all hourly data for this day to calculate averages
            const dayHourlyData = [];
            if (hourly && hourly.time) {
                for (let j = 0; j < hourly.time.length; j++) {
                    const hourTime = new Date(hourly.time[j]);
                    if (hourTime >= dayStart && hourTime < dayEnd) {
                        dayHourlyData.push({
                            hour: hourTime.getHours(),
                            temp: hourly.temperature_2m[j],
                            wind: hourly.wind_speed_10m[j],
                            time: hourTime
                        });
                    }
                }
            }
            
            // Calculate average wind for the day (for use when hourly data is missing)
            const avgDayWind = dayHourlyData.length > 0 
                ? dayHourlyData.reduce((sum, d) => sum + d.wind, 0) / dayHourlyData.length 
                : 5; // Default to 5 mph if no data
            
            timeRanges.forEach(([startHour, endHour, label]) => {
                const rangeScores = [];
                const rangeTemps = [];
                const rangeWinds = [];
                
                // Find hourly data for this time range
                dayHourlyData.forEach(data => {
                    if (data.hour >= startHour && data.hour < endHour) {
                        const score = this.calculateDeerActivityScore(
                            data.temp,
                            data.wind,
                            moonPhase,
                            data.hour,
                            sunrise,
                            sunset
                        );
                        rangeScores.push(score);
                        rangeTemps.push(data.temp);
                        rangeWinds.push(data.wind);
                    }
                });
                
                // If no hourly data for this range, use daily average with midpoint hour
                if (rangeScores.length === 0) {
                    const midpointHour = Math.floor((startHour + endHour) / 2);
                    const estimatedTemp = avgTemp; // Use daily average temp
                    const estimatedScore = this.calculateDeerActivityScore(
                        estimatedTemp,
                        avgDayWind,
                        moonPhase,
                        midpointHour,
                        sunrise,
                        sunset
                    );
                    
                    dayTimeRanges.push({
                        label: label,
                        startHour: startHour,
                        score: estimatedScore,
                        temp: estimatedTemp,
                        wind: avgDayWind
                    });
                } else {
                    // Calculate average for this time range
                    const avgScore = rangeScores.reduce((a, b) => a + b, 0) / rangeScores.length;
                    const avgTemp = rangeTemps.reduce((a, b) => a + b, 0) / rangeTemps.length;
                    const avgWind = rangeWinds.reduce((a, b) => a + b, 0) / rangeWinds.length;
                    
                    dayTimeRanges.push({
                        label: label,
                        startHour: startHour,
                        score: avgScore,
                        temp: avgTemp,
                        wind: avgWind
                    });
                }
            });
            
            // Sort by start hour to maintain order
            dayTimeRanges.sort((a, b) => a.startHour - b.startHour);
            
            html += `
                <div class="moon-day-section">
                    <div class="moon-day-header">
                        <div class="moon-day-name">${dayName}</div>
                        <div class="moon-phase">${this.getMoonIconSVG(moonPhase)}${moonPhase}</div>
                    </div>
                    
                    <div class="moon-conditions">
                        <div class="moon-condition-item">
                            <div class="moon-condition-label">High Temp</div>
                            <div class="moon-condition-value">${Math.round(maxTemp)}°F</div>
                        </div>
                        <div class="moon-condition-item">
                            <div class="moon-condition-label">Low Temp</div>
                            <div class="moon-condition-value">${Math.round(minTemp)}°F</div>
                        </div>
                        <div class="moon-condition-item">
                            <div class="moon-condition-label">Sunrise</div>
                            <div class="moon-condition-value">${new Date(sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                        </div>
                        <div class="moon-condition-item">
                            <div class="moon-condition-label">Sunset</div>
                            <div class="moon-condition-value">${new Date(sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                        </div>
                    </div>
                    
                    <div class="moon-best-times">
                        <h4>Activity Scores</h4>
                        <div class="moon-times-grid">
            `;
            
            dayTimeRanges.forEach((rangeData) => {
                html += `
                    <div class="moon-time-item">
                        <div class="moon-time-label">${rangeData.label}</div>
                        <div class="moon-activity-score">${Math.round(rangeData.score)}</div>
                        <div class="moon-activity-bar">
                            <div class="moon-activity-fill" style="width: ${rangeData.score}%;"></div>
                        </div>
                    </div>
                `;
            });
            
            html += `
                        </div>
                    </div>
                </div>
            `;
        }
        
        moonDisplay.innerHTML = html;
    }
}

// Map Tracking Service
class MapTrackingService {
    constructor() {
        this.map = null;
        this.trackingPath = [];
        this.pathPolyline = null;
        this.currentMarker = null;
        this.isTracking = false;
        this.watchId = null;
        this.totalDistance = 0;
        this.lastPosition = null;
        this.customMarkers = []; // Array to store custom markers placed by user
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        const clearBtn = document.getElementById('clearPathBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearPath());
        }
        const addMarkerBtn = document.getElementById('addMarkerBtn');
        if (addMarkerBtn) {
            addMarkerBtn.addEventListener('click', () => this.addMarker());
        }
    }
    
    initMap() {
        if (this.map) return; // Map already initialized
        
        // Initialize map with satellite view using free Esri World Imagery with Labels
        this.map = L.map('map', {
            zoomControl: true,
            attributionControl: true
        });
        
        // Use Esri World Imagery (satellite tiles)
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and IGP',
            maxZoom: 19
        }).addTo(this.map);
        
        // Add labels overlay for city names and place names
        const labelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Esri',
            maxZoom: 19
        }).addTo(this.map);
        
        // Set a default view first (Quitman, TX 75783)
        this.map.setView([32.7962, -95.4516], 13);
        
        // Set initial status message
        const mapStatus = document.getElementById('mapStatus');
        if (mapStatus) {
            mapStatus.textContent = 'Map ready. Location will update when tracking starts.';
        }
        
        // Optionally try to get current location, but don't show errors if it fails
        // This is just a convenience - tracking will work fine without it
        if (navigator.geolocation) {
            // Try with very quick timeout and accept any cached location
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    this.map.setView([lat, lon], 18);
                    this.addCurrentPositionMarker(lat, lon);
                    const mapStatus = document.getElementById('mapStatus');
                    if (mapStatus) {
                        mapStatus.textContent = 'Location found - Ready to track';
                    }
                },
                (error) => {
                    // Silently ignore - this is expected in many cases
                    // Map will work fine and update when tracking starts
                },
                {
                    enableHighAccuracy: false,
                    timeout: 3000, // Very short timeout - 3 seconds
                    maximumAge: Infinity // Accept any cached location, no matter how old
                }
            );
        }
    }
    
    addCurrentPositionMarker(lat, lon) {
        // Remove existing marker if present
        if (this.currentMarker) {
            this.map.removeLayer(this.currentMarker);
        }
        
        // Create a custom icon for current position
        const positionIcon = L.divIcon({
            className: 'current-position-marker',
            html: '<div style="width: 24px; height: 24px; background: #0066ff; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 15px rgba(0,102,255,0.8), 0 0 0 4px rgba(0,102,255,0.3);"></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        
        this.currentMarker = L.marker([lat, lon], {
            icon: positionIcon
        }).addTo(this.map);
    }
    
    startTracking() {
        if (!navigator.geolocation) {
            const mapStatus = document.getElementById('mapStatus');
            if (mapStatus) {
                mapStatus.textContent = 'Geolocation not supported by your browser';
            }
            return;
        }
        
        // Initialize map if not already done
        this.initMap();
        
        // Reset tracking path when camera starts - always start fresh
        this.trackingPath = [];
        this.totalDistance = 0;
        this.lastPosition = null;
        
        // Remove existing polyline if it exists
        if (this.pathPolyline) {
            this.map.removeLayer(this.pathPolyline);
            this.pathPolyline = null;
        }
        
        // Reset distance display
        const mapDistance = document.getElementById('mapDistance');
        if (mapDistance) {
            mapDistance.textContent = 'Distance: 0 ft';
        }
        
        // Create fresh path polyline for new tracking session
        this.pathPolyline = L.polyline([], {
            color: '#ff0000',
            weight: 5,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round'
        }).addTo(this.map);
        // Bring polyline to front so it's always visible
        this.pathPolyline.bringToFront();
        
        this.isTracking = true;
        const mapStatus = document.getElementById('mapStatus');
        if (mapStatus) {
            mapStatus.textContent = 'Requesting location permission...';
        }
        
        // Watch position updates with high accuracy and frequent updates
        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                const mapStatus = document.getElementById('mapStatus');
                if (mapStatus) {
                    mapStatus.textContent = 'Tracking movement...';
                }
                this.updatePosition(position);
            },
            (error) => {
                // Handle errors gracefully
                let message = 'Location unavailable. ';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Please allow location access in browser settings to track movement.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Location services unavailable. Please check your device location settings.';
                        break;
                    case error.TIMEOUT:
                        message = 'Location request timed out. Please try again.';
                        break;
                    default:
                        message = 'Unable to get location. Please check your device settings.';
                }
                const mapStatus = document.getElementById('mapStatus');
                if (mapStatus) {
                    mapStatus.textContent = message;
                }
            },
            {
                enableHighAccuracy: true, // Use GPS for high accuracy
                maximumAge: 0, // Only accept fresh location data (no cached positions)
                timeout: 5000 // 5 second timeout for faster response
            }
        );
    }
    
    updatePosition(position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        
        // Ensure coordinates are valid numbers
        if (isNaN(lat) || isNaN(lon)) {
            console.warn('Invalid coordinates received:', lat, lon);
            return;
        }
        
        // Create proper LatLng object to ensure correct coordinate handling
        const latLng = L.latLng(lat, lon);
        
        // Calculate distance from last point
        let distance = 0;
        let pathUpdated = false;
        const minDistanceForUpdate = 2; // Minimum distance in meters to add new point (reduces noise)
        
        if (this.lastPosition) {
            distance = this.calculateDistance(
                this.lastPosition.lat,
                this.lastPosition.lon,
                latLng.lat,
                latLng.lng
            );
            
            // Only add point to path if moved significant distance (reduces GPS jitter)
            if (distance >= minDistanceForUpdate) {
                this.trackingPath.push([latLng.lat, latLng.lng]);
                this.totalDistance += distance;
                document.getElementById('mapDistance').textContent = 
                    `Distance: ${this.formatDistance(this.totalDistance)}`;
                pathUpdated = true;
            }
        } else {
            // First position - always add it
            this.trackingPath.push([latLng.lat, latLng.lng]);
            pathUpdated = true;
        }
        
        // Always update last position for distance calculation, even if we didn't add to path
        this.lastPosition = { lat: latLng.lat, lon: latLng.lng };
        
        // Update or create current position marker (always update for smooth tracking)
        if (this.currentMarker) {
            this.currentMarker.setLatLng(latLng);
        } else {
            this.addCurrentPositionMarker(latLng.lat, latLng.lng);
        }
        
        // Update path polyline only if path was updated (more efficient)
        if (pathUpdated) {
            if (this.pathPolyline) {
                // Convert tracking path to proper LatLng array format
                const pathLatLngs = this.trackingPath.map(point => L.latLng(point[0], point[1]));
                this.pathPolyline.setLatLngs(pathLatLngs);
                // Ensure polyline stays on top
                this.pathPolyline.bringToFront();
            } else if (this.trackingPath.length > 0) {
                // Create polyline if it doesn't exist and we have points
                const pathLatLngs = this.trackingPath.map(point => L.latLng(point[0], point[1]));
                this.pathPolyline = L.polyline(pathLatLngs, {
                    color: '#ff0000',
                    weight: 5,
                    opacity: 0.9,
                    lineJoin: 'round',
                    lineCap: 'round'
                }).addTo(this.map);
                this.pathPolyline.bringToFront();
            }
        }
        
        // Center map on current position
        this.map.setView(latLng, 18);
        
        // Add accuracy circle
        if (this.accuracyCircle) {
            this.map.removeLayer(this.accuracyCircle);
        }
        this.accuracyCircle = L.circle([lat, lon], {
            radius: accuracy,
            color: '#ff0000',
            fillColor: '#ff0000',
            fillOpacity: 0.1,
            weight: 1
        }).addTo(this.map);
    }
    
    stopTracking() {
        this.isTracking = false;
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        
        const mapStatus = document.getElementById('mapStatus');
        if (mapStatus) {
            mapStatus.textContent = 'Tracking stopped';
        }
    }
    
    addMarker() {
        if (!this.map) {
            // Initialize map if not already done
            this.initMap();
        }
        
        // Get current position if available
        if (this.currentMarker) {
            const position = this.currentMarker.getLatLng();
            this.placeMarkerAtPosition(position.lat, position.lng);
        } else if (this.trackingPath.length > 0) {
            // Use last position in tracking path
            const lastPoint = this.trackingPath[this.trackingPath.length - 1];
            this.placeMarkerAtPosition(lastPoint[0], lastPoint[1]);
        } else {
            // Get map center as fallback
            const center = this.map.getCenter();
            this.placeMarkerAtPosition(center.lat, center.lng);
        }
    }
    
    placeMarkerAtPosition(lat, lng) {
        // Create a custom marker icon (different from current position marker)
        const markerIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="width: 20px; height: 20px; background: #ff6600; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(255,102,0,0.8), 0 0 0 3px rgba(255,102,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        
        const marker = L.marker([lat, lng], {
            icon: markerIcon
        }).addTo(this.map);
        
        // Store marker
        this.customMarkers.push(marker);
        
        // Add popup with timestamp
        const timestamp = new Date().toLocaleTimeString();
        marker.bindPopup(`Marker placed at ${timestamp}`);
    }
    
    clearPath() {
        this.trackingPath = [];
        this.totalDistance = 0;
        this.lastPosition = null;
        
        if (this.pathPolyline) {
            this.map.removeLayer(this.pathPolyline);
            this.pathPolyline = null;
        }
        
        if (this.currentMarker) {
            this.map.removeLayer(this.currentMarker);
            this.currentMarker = null;
        }
        
        if (this.accuracyCircle) {
            this.map.removeLayer(this.accuracyCircle);
            this.accuracyCircle = null;
        }
        
        // Remove all custom markers
        this.customMarkers.forEach(marker => {
            if (this.map) {
                this.map.removeLayer(marker);
            }
        });
        this.customMarkers = [];
        
        document.getElementById('mapDistance').textContent = 'Distance: 0 ft';
        document.getElementById('mapStatus').textContent = 'Path cleared';
    }
    
    handleGeolocationError(error) {
        let message = 'Geolocation error: ';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message += 'Permission denied. Please allow location access.';
                break;
            case error.POSITION_UNAVAILABLE:
                message += 'Position unavailable.';
                break;
            case error.TIMEOUT:
                message += 'Request timeout.';
                break;
            default:
                message += 'Unknown error.';
                break;
        }
        document.getElementById('mapStatus').textContent = message;
    }
    
    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula to calculate distance between two points
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in meters
    }
    
    formatDistance(meters) {
        if (meters < 1000) {
            return Math.round(meters * 3.28084) + ' ft'; // Convert to feet
        } else {
            return (meters / 1609.34).toFixed(2) + ' mi'; // Convert to miles
        }
    }
}

// Stands Management Service
// Firebase Sharing Service
class LocationSharingService {
    constructor() {
        // Initialize Firebase (user needs to add their config)
        if (typeof firebase !== 'undefined') {
            // Firebase config - user needs to replace with their own
            const firebaseConfig = {
                apiKey: "YOUR_API_KEY",
                authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
                databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
                projectId: "YOUR_PROJECT_ID",
                storageBucket: "YOUR_PROJECT_ID.appspot.com",
                messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
                appId: "YOUR_APP_ID"
            };
            
            // Check if Firebase config has placeholder values
            const hasPlaceholders = 
                firebaseConfig.apiKey === "YOUR_API_KEY" ||
                firebaseConfig.projectId === "YOUR_PROJECT_ID" ||
                firebaseConfig.appId === "YOUR_APP_ID";
            
            if (hasPlaceholders) {
                // Don't initialize Firebase if config has placeholders
                console.log('Firebase not configured. Location sharing features will not work. To enable sharing, update the Firebase configuration in script.js');
                this.database = null;
            } else {
                // Only initialize if config is properly set
                try {
                    if (!firebase.apps.length) {
                        firebase.initializeApp(firebaseConfig);
                    }
                    // Authenticate with anonymous auth (required for Firebase security rules)
                    const auth = firebase.auth();
                    auth.signInAnonymously().catch(authError => {
                        console.warn('Firebase auth failed:', authError);
                    });
                    this.database = firebase.database();
                } catch (error) {
                    console.warn('Firebase initialization failed:', error);
                    this.database = null;
                }
            }
        } else {
            console.warn('Firebase not loaded. Sharing features will not work.');
            this.database = null;
        }
    }
    
    // Generate a 6-digit code
    generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
    
    // Share a location to Firebase
    async shareLocation(locationData, code) {
        if (!this.database) {
            throw new Error('Firebase not initialized');
        }
        
        try {
            await this.database.ref(`sharedLocations/${code}`).set({
                ...locationData,
                sharedAt: Date.now()
            });
            return true;
        } catch (error) {
            console.error('Error sharing location:', error);
            throw error;
        }
    }
    
    // Get a shared location from Firebase
    async getSharedLocation(code) {
        if (!this.database) {
            throw new Error('Firebase not initialized');
        }
        
        try {
            const snapshot = await this.database.ref(`sharedLocations/${code}`).once('value');
            const data = snapshot.val();
            if (data) {
                // Remove metadata
                delete data.sharedAt;
                delete data.updatedAt;
                return data;
            }
            return null;
        } catch (error) {
            console.error('Error getting shared location:', error);
            throw error;
        }
    }
    
    // Update a shared location (if code already exists)
    async updateSharedLocation(code, locationData) {
        if (!this.database) {
            throw new Error('Firebase not initialized');
        }
        
        try {
            await this.database.ref(`sharedLocations/${code}`).update({
                ...locationData,
                updatedAt: Date.now()
            });
            return true;
        } catch (error) {
            console.error('Error updating shared location:', error);
            throw error;
        }
    }
}

class StandsService {
    constructor() {
        this.locations = this.loadLocations();
        this.currentLocationId = null;
        this.editingStandId = null;
        this.viewingImageIndex = null;
        this.viewingStandId = null;
        this.standMapPicker = null;
        this.standMapMarker = null; // Marker for the stand being edited
        this.standMarkers = []; // Array to hold all markers on the map
        this.tempMarkers = []; // Temporary markers placed during editing session
        this.standCoordinates = null;
        this.standMapView = null; // Store zoom and center for saved location
        this.selectedIconType = 'stand'; // Default icon type
        this.mapClickPosition = null; // Store click position for popup
        this.locationMap = null; // Map for location view modal
        this.isDrawingProperty = false; // Property line drawing mode
        this.currentPropertyLine = null; // Current polyline being drawn
        this.propertyLinePoints = []; // Points for current property line
        this.propertyLines = []; // All property line polylines on map
        this.currentLocationIndex = null; // Current location being viewed on map
        this.standMapPropertyLines = []; // Property lines displayed on stand edit map
        
        // Initialize sharing service
        this.sharingService = new LocationSharingService();
        
        this.setupEventListeners();
        this.renderLocations();
    }
    
    loadLocations() {
        const saved = localStorage.getItem('huntingStands');
        return saved ? JSON.parse(saved) : [];
    }
    
    saveLocations() {
        try {
            const data = JSON.stringify(this.locations);
            // Check if data is too large (localStorage limit is typically 5-10MB)
            if (data.length > 4 * 1024 * 1024) { // 4MB threshold
                console.warn('Data size is large:', (data.length / 1024 / 1024).toFixed(2), 'MB');
                // Try to save anyway, but warn user if it fails
            }
            localStorage.setItem('huntingStands', data);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                alert('Storage limit exceeded. Please remove some images from your stands to free up space.');
                console.error('localStorage quota exceeded. Consider removing images or using IndexedDB.');
            } else {
                console.error('Error saving locations:', error);
                alert('Error saving data. Please try again.');
            }
            throw error;
        }
    }
    
    setupEventListeners() {
        // Location buttons
        document.getElementById('addLocationBtn').addEventListener('click', () => this.openLocationModal());
        document.getElementById('saveLocationBtn').addEventListener('click', () => this.saveLocation());
        document.getElementById('cancelLocationBtn').addEventListener('click', () => this.closeLocationModal());
        document.getElementById('closeLocationModal').addEventListener('click', () => this.closeLocationModal());
        document.getElementById('importLocationBtn').addEventListener('click', () => this.importLocationFromCode());
        document.getElementById('closeLocationMapModal').addEventListener('click', () => this.closeLocationMapModal());
        document.getElementById('toggleDrawPropertyBtn').addEventListener('click', () => this.togglePropertyDrawing());
        document.getElementById('clearPropertyLinesBtn').addEventListener('click', () => this.clearPropertyLines());
        document.getElementById('undoPropertyLineBtn').addEventListener('click', () => this.undoLastPropertyLine());
        
        // Stand buttons
        document.getElementById('addStandBtn').addEventListener('click', () => this.openStandModal());
        document.getElementById('saveStandBtn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.saveStand();
        });
        document.getElementById('cancelStandBtn').addEventListener('click', () => this.closeStandModal());
        document.getElementById('closeStandModal').addEventListener('click', () => this.closeStandModal());
        document.getElementById('backToLocationsBtn').addEventListener('click', () => this.backToLocations());
        document.getElementById('deleteStandBtn').addEventListener('click', () => this.deleteStandFromModal());
        
        // Icon type selection buttons (use event delegation since popup may not exist yet)
        document.addEventListener('click', (e) => {
            if (e.target.closest('.icon-type-btn')) {
                e.stopPropagation(); // Prevent event bubbling
                const btn = e.target.closest('.icon-type-btn');
                const iconType = btn.dataset.iconType;
                this.selectIconType(iconType);
                return; // Don't process other click handlers
            }
            
            // Close popup when clicking outside (but not on the button itself)
            const popup = document.getElementById('iconTypePopup');
            if (popup && !popup.classList.contains('hidden')) {
                if (!popup.contains(e.target) && !e.target.closest('#standMapPicker')) {
                    this.closeIconTypePopup();
                }
            }
        });
        
        // Image upload
        document.getElementById('addImageBtn').addEventListener('click', () => {
            document.getElementById('standImageUpload').click();
        });
        document.getElementById('standImageUpload').addEventListener('change', (e) => this.handleImageUpload(e));
        
        // Image viewer
        document.getElementById('closeImageViewer').addEventListener('click', () => this.closeImageViewer());
        document.getElementById('deleteImageBtn').addEventListener('click', () => this.deleteCurrentImage());
        document.getElementById('prevImageBtn').addEventListener('click', () => this.showPrevImage());
        document.getElementById('nextImageBtn').addEventListener('click', () => this.showNextImage());
    }
    
    renderLocations() {
        const container = document.getElementById('locationsList');
        if (this.locations.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No locations yet. Click "Add Location" to get started.</p>';
            return;
        }
        
        container.innerHTML = this.locations.map((location, index) => {
            // Generate or get existing share code
            if (!location.shareCode) {
                location.shareCode = this.sharingService.generateCode();
                this.saveLocations();
            }
            
            return `
            <div class="location-card" data-location-id="${index}">
                <div class="card-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div>
                            <h3>${this.escapeHtml(location.name)}</h3>
                            <p style="font-family: monospace; font-size: 14px; color: var(--primary-color); letter-spacing: 1px; margin: 2px 0 0 0;">${location.shareCode}</p>
                        </div>
                        <button class="location-map-btn" data-location-index="${index}" onclick="event.stopPropagation(); standsService.viewLocationMap(${index})" title="View Map">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 3H21V21H3V3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M3 9H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M9 3V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                                <circle cx="17" cy="17" r="1.5" fill="currentColor"/>
                            </svg>
                        </button>
                    </div>
                    <button class="icon-btn icon-btn-secondary location-menu-btn" data-location-index="${index}" onclick="event.stopPropagation(); standsService.toggleLocationMenu(${index})" title="Options">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11.333 2.667L13.333 4.667L4.667 13.333H2.667V11.333L11.333 2.667Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M9.333 4.667L11.333 6.667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
                <p style="color: var(--text-secondary); font-size: 14px;">${location.stands.length} stand${location.stands.length !== 1 ? 's' : ''}</p>
                <div class="location-menu hidden" data-location-menu="${index}">
                    <button class="menu-item" onclick="event.stopPropagation(); standsService.renameLocation(${index})">Rename</button>
                    <button class="menu-item menu-item-danger" onclick="event.stopPropagation(); standsService.deleteLocation(${index})">Delete</button>
                </div>
            </div>
        `;
        }).join('');
        
        // Add click listeners
        container.querySelectorAll('.location-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('button') && !e.target.closest('.location-menu')) {
                    const locationId = parseInt(card.dataset.locationId);
                    this.viewLocation(locationId);
                }
            });
        });
        
        // Close menus when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.location-menu-btn') && !e.target.closest('.location-menu')) {
                document.querySelectorAll('.location-menu').forEach(menu => {
                    menu.classList.add('hidden');
                });
            }
        });
    }
    
    viewLocation(locationId) {
        this.currentLocationId = locationId;
        const locationsSection = document.querySelector('.locations-section');
        const standsSection = document.getElementById('standsSection');
        
        // Hide locations section and show stands section
        locationsSection.style.display = 'none';
        standsSection.classList.remove('hidden');
        standsSection.style.display = 'block';
        document.getElementById('standsLocationName').textContent = this.locations[locationId].name;
        this.renderStands();
    }
    
    backToLocations() {
        this.currentLocationId = null;
        const locationsSection = document.querySelector('.locations-section');
        const standsSection = document.getElementById('standsSection');
        
        // Show locations section and hide stands section
        locationsSection.style.display = 'block';
        standsSection.classList.add('hidden');
        standsSection.style.display = 'none';
    }
    
    renderStands() {
        const location = this.locations[this.currentLocationId];
        const container = document.getElementById('standsList');
        
        if (location.stands.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No stands yet. Click "Add Stand" to create one.</p>';
            return;
        }
        
        container.innerHTML = location.stands.map((stand, index) => `
            <div class="stand-card" data-stand-id="${index}">
                <div class="stand-card-header">
                    <h3>${this.escapeHtml(stand.name)}</h3>
                    ${stand.images && stand.images.length > 0 ? `
                        <button class="stand-gallery-btn" onclick="event.stopPropagation(); standsService.viewStandGallery(${index})" title="View Gallery">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 16L8.586 11.414C9.367 10.633 10.633 10.633 11.414 11.414L16 16M14 14L15.586 12.414C16.367 11.633 17.633 11.633 18.414 12.414L20 14M14 8H14.01M6 20H18C19.105 20 20 19.105 20 18V6C20 4.895 19.105 4 18 4H6C4.895 4 4 4.895 4 6V18C4 19.105 4.895 20 6 20Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
                <div class="stand-info">
                    ${stand.wind && stand.wind.length > 0 ? `<div class="stand-info-item">🌬️ Wind: ${Array.isArray(stand.wind) ? stand.wind.join(', ') : stand.wind}</div>` : ''}
                    ${stand.time && stand.time.length > 0 ? `<div class="stand-info-item">⏰ Time: ${Array.isArray(stand.time) ? stand.time.map(t => t === 'morning' ? 'Morning' : 'Evening').join(', ') : (stand.time === 'morning' ? 'Morning' : 'Evening')}</div>` : ''}
                </div>
            </div>
        `).join('');
        
        // Add click listeners to open edit modal
        container.querySelectorAll('.stand-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const standId = parseInt(card.dataset.standId);
                this.editStand(standId);
            });
        });
    }
    
    openLocationModal(editIndex = null) {
        document.getElementById('locationModalTitle').textContent = editIndex !== null ? 'Rename Location' : 'Add Location';
        document.getElementById('locationName').value = editIndex !== null ? this.locations[editIndex].name : '';
        document.getElementById('locationCodeInput').value = '';
        document.getElementById('locationModal').dataset.editIndex = editIndex !== null ? editIndex : '';
        
        // Hide import section when renaming
        const importSection = document.querySelector('#locationModal .form-group:last-of-type');
        if (importSection && importSection.querySelector('#locationCodeInput')) {
            importSection.style.display = editIndex !== null ? 'none' : 'block';
        }
        
        document.getElementById('locationModal').classList.remove('hidden');
    }
    
    closeLocationModal() {
        document.getElementById('locationModal').classList.add('hidden');
        document.getElementById('locationName').value = '';
    }
    
    viewLocationMap(locationIndex) {
        if (locationIndex < 0 || locationIndex >= this.locations.length) return;
        
        this.currentLocationIndex = locationIndex;
        const location = this.locations[locationIndex];
        const modal = document.getElementById('locationMapModal');
        const title = document.getElementById('locationMapTitle');
        
        title.textContent = `${location.name} - Map View`;
        modal.classList.remove('hidden');
        
        // Reset drawing state
        this.isDrawingProperty = false;
        this.propertyLinePoints = [];
        this.propertyLines = [];
        this.updatePropertyDrawingUI();
        
        // Clear any existing map
        if (this.locationMap) {
            this.locationMap.remove();
            this.locationMap = null;
        }
        
        // Initialize map with satellite view
        this.locationMap = L.map('locationMap', {
            zoomControl: true
        });
        
        // Set cursor to pointer by default, grab when dragging
        const mapContainerElement = this.locationMap.getContainer();
        mapContainerElement.style.cursor = 'pointer';
        
        this.locationMap.on('mousedown', () => {
            mapContainerElement.style.cursor = 'grabbing';
        });
        
        this.locationMap.on('mouseup', () => {
            mapContainerElement.style.cursor = 'pointer';
        });
        
        this.locationMap.on('mouseleave', () => {
            mapContainerElement.style.cursor = 'pointer';
        });
        
        // Create base layers - use two-layer approach for satellite with labels
        const satelliteImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Esri',
            maxZoom: 19
        });
        
        const satelliteLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Esri',
            maxZoom: 19
        });
        
        // Create a layer group for satellite (imagery + labels)
        const satelliteLayer = L.layerGroup([satelliteImagery, satelliteLabels]);
        
        // Create topographic layer (non-satellite version) with higher maxZoom to allow switching at any zoom level
        // We'll enforce the actual maxZoom after switching
        const topoLayer = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'USGS',
            maxZoom: 19  // Set to match satellite so Leaflet allows switching
        });
        
        // Store the actual maxZoom for topographic
        topoLayer._actualMaxZoom = 16;
        
        // Add default layer (satellite with labels)
        satelliteLayer.addTo(this.locationMap);
        
        // Add layer control with zoom adjustment
        const baseMaps = {
            "Satellite": satelliteLayer,
            "Topographic": topoLayer
        };
        const layerControl = L.control.layers(baseMaps).addTo(this.locationMap);
        
        // Adjust zoom when switching to topographic layer
        this.locationMap.on('baselayerchange', (e) => {
            if (e.layer === topoLayer) {
                const currentZoom = this.locationMap.getZoom();
                const actualMaxZoom = topoLayer._actualMaxZoom || 16;
                if (currentZoom > actualMaxZoom) {
                    this.locationMap.setZoom(actualMaxZoom);
                }
                // Also prevent zooming beyond the actual maxZoom
                this.locationMap.setMaxZoom(actualMaxZoom);
            } else if (e.layer === satelliteLayer) {
                // Restore satellite maxZoom
                this.locationMap.setMaxZoom(19);
            }
        });
        
        // Also handle zoom events to prevent zooming beyond topographic maxZoom
        this.locationMap.on('zoom', () => {
            if (this.locationMap.hasLayer(topoLayer)) {
                const currentZoom = this.locationMap.getZoom();
                const actualMaxZoom = topoLayer._actualMaxZoom || 16;
                if (currentZoom > actualMaxZoom) {
                    this.locationMap.setZoom(actualMaxZoom);
                }
            }
        });
        
        // Load and display existing property lines
        if (location.propertyLines && Array.isArray(location.propertyLines)) {
            location.propertyLines.forEach(line => {
                if (line && line.length >= 2) {
                    const polyline = L.polyline(line, {
                        color: '#ff0000',
                        weight: 3,
                        opacity: 0.8
                    }).addTo(this.locationMap);
                    this.propertyLines.push(polyline);
                }
            });
        }
        
        // Collect all icons from all stands in this location
        const allIcons = [];
        let bounds = null;
        
        location.stands.forEach((stand, standIndex) => {
            if (stand.icons && Array.isArray(stand.icons)) {
                // New format: stand has icons array
                stand.icons.forEach(icon => {
                    if (icon.lat && icon.lng) {
                        allIcons.push({
                            lat: icon.lat,
                            lng: icon.lng,
                            iconType: icon.iconType || 'stand',
                            standName: stand.name,
                            standIndex: standIndex
                        });
                    }
                });
            } else if (stand.lat && stand.lng) {
                // Old format: single icon
                allIcons.push({
                    lat: stand.lat,
                    lng: stand.lng,
                    iconType: stand.iconType || 'stand',
                    standName: stand.name,
                    standIndex: standIndex
                });
            }
        });
        
        // Add markers for all icons
        if (allIcons.length > 0) {
            allIcons.forEach(iconData => {
                const iconDataForType = this.getIconForType(iconData.iconType);
                const marker = L.marker([iconData.lat, iconData.lng], {
                    icon: L.divIcon({
                        className: 'stand-location-marker',
                        html: iconDataForType.html,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    })
                }).addTo(this.locationMap);
                
                // Add popup with clickable stand name
                const locIndex = locationIndex;
                const stIndex = iconData.standIndex;
                const popupContent = `<strong><a href="#" class="stand-name-link" data-location-index="${locIndex}" data-stand-index="${stIndex}" style="color: var(--accent-color); text-decoration: underline; cursor: pointer;" onclick="event.preventDefault(); standsService.openStandFromMap(${locIndex}, ${stIndex}); return false;">${this.escapeHtml(iconData.standName)}</a></strong><br>${iconData.iconType.charAt(0).toUpperCase() + iconData.iconType.slice(1)}`;
                marker.bindPopup(popupContent);
                
                // Update bounds
                if (!bounds) {
                    bounds = L.latLngBounds([iconData.lat, iconData.lng], [iconData.lat, iconData.lng]);
                } else {
                    bounds.extend([iconData.lat, iconData.lng]);
                }
            });
            
            // If location has a saved map view, use it (prioritize saved view)
            if (location.mapView && location.mapView.center && location.mapView.zoom) {
                setTimeout(() => {
                    this.locationMap.setView([location.mapView.center[0], location.mapView.center[1]], location.mapView.zoom);
                }, 200); // Small delay to ensure map is ready
            } else if (bounds.isValid()) {
                // No saved view - fit bounds to show all markers
                this.locationMap.fitBounds(bounds, { padding: [50, 50] });
            }
        } else {
            // No icons - check if location has a saved map view
            if (location.mapView && location.mapView.center && location.mapView.zoom) {
                setTimeout(() => {
                    this.locationMap.setView([location.mapView.center[0], location.mapView.center[1]], location.mapView.zoom);
                }, 200);
            } else {
                // No icons and no saved view - set default view (Quitman, TX 75783)
                this.locationMap.setView([32.7962, -95.4516], 13);
            }
        }
        
        // Set up map click handler for property line drawing
        this.locationMap.on('click', (e) => {
            if (this.isDrawingProperty) {
                this.addPropertyLinePoint(e.latlng);
            }
        });
        
        // Invalidate size after modal is shown
        setTimeout(() => {
            this.locationMap.invalidateSize();
        }, 100);
    }
    
    togglePropertyDrawing() {
        this.isDrawingProperty = !this.isDrawingProperty;
        
        if (this.isDrawingProperty) {
            // Start new line
            this.propertyLinePoints = [];
            this.currentPropertyLine = null;
        } else {
            // Finish current line
            if (this.propertyLinePoints.length >= 2) {
                this.finishPropertyLine();
            }
        }
        
        this.updatePropertyDrawingUI();
    }
    
    updatePropertyDrawingUI() {
        const btn = document.getElementById('toggleDrawPropertyBtn');
        const status = document.getElementById('drawPropertyStatus');
        const clearBtn = document.getElementById('clearPropertyLinesBtn');
        const undoBtn = document.getElementById('undoPropertyLineBtn');
        
        if (this.isDrawingProperty) {
            btn.textContent = 'Stop Drawing';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-danger');
            status.textContent = 'Click on map to add points. Click "Stop Drawing" to finish.';
            undoBtn.style.display = 'inline-block';
        } else {
            btn.textContent = 'Draw Property Lines';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-secondary');
            status.textContent = '';
            undoBtn.style.display = 'none';
        }
        
        // Show clear button if there are property lines
        const location = this.locations[this.currentLocationIndex];
        if (location && location.propertyLines && location.propertyLines.length > 0) {
            clearBtn.style.display = 'inline-block';
        } else {
            clearBtn.style.display = 'none';
        }
    }
    
    addPropertyLinePoint(latlng) {
        this.propertyLinePoints.push([latlng.lat, latlng.lng]);
        
        // Update or create polyline
        if (this.currentPropertyLine) {
            this.currentPropertyLine.setLatLngs(this.propertyLinePoints);
        } else {
            this.currentPropertyLine = L.polyline(this.propertyLinePoints, {
                color: '#ff0000',
                weight: 3,
                opacity: 0.8
            }).addTo(this.locationMap);
        }
    }
    
    finishPropertyLine() {
        if (this.propertyLinePoints.length >= 2 && this.currentLocationIndex !== null) {
            const location = this.locations[this.currentLocationIndex];
            if (!location.propertyLines) {
                location.propertyLines = [];
            }
            location.propertyLines.push(this.propertyLinePoints);
            this.saveLocations();
            this.propertyLines.push(this.currentPropertyLine);
            
            // Update Firebase if location has a share code
            if (location.shareCode) {
                this.shareLocationToFirebase(location).catch(err => {
                    console.error('Failed to update shared location:', err);
                });
            }
        }
        this.propertyLinePoints = [];
        this.currentPropertyLine = null;
    }
    
    undoLastPropertyLine() {
        if (this.currentLocationIndex === null) return;
        
        // If currently drawing a line, remove the last point from the current line
        if (this.propertyLinePoints.length > 0) {
            this.propertyLinePoints.pop();
            
            if (this.propertyLinePoints.length === 0) {
                // No points left, remove the line from map
                if (this.currentPropertyLine) {
                    this.locationMap.removeLayer(this.currentPropertyLine);
                    this.currentPropertyLine = null;
                }
            } else {
                // Update the line with remaining points
                this.currentPropertyLine.setLatLngs(this.propertyLinePoints);
            }
            return;
        }
        
        // If no current line being drawn, remove the last completed line
        const location = this.locations[this.currentLocationIndex];
        if (!location.propertyLines || location.propertyLines.length === 0) {
            return;
        }
        
        // Remove the last saved line
        location.propertyLines.pop();
        this.saveLocations();
        
        // Remove the last polyline from map
        if (this.propertyLines.length > 0) {
            const lastPolyline = this.propertyLines.pop();
            this.locationMap.removeLayer(lastPolyline);
        }
        
        this.updatePropertyDrawingUI();
    }
    
    clearPropertyLines() {
        if (this.currentLocationIndex === null) return;
        
        if (confirm('Clear all property lines for this location?')) {
            const location = this.locations[this.currentLocationIndex];
            location.propertyLines = [];
            this.saveLocations();
            
            // Update Firebase if location has a share code
            if (location.shareCode) {
                this.shareLocationToFirebase(location).catch(err => {
                    console.error('Failed to update shared location:', err);
                });
            }
            
            // Remove all polylines from map
            this.propertyLines.forEach(line => {
                this.locationMap.removeLayer(line);
            });
            this.propertyLines = [];
            
            if (this.currentPropertyLine) {
                this.locationMap.removeLayer(this.currentPropertyLine);
                this.currentPropertyLine = null;
            }
            
            this.propertyLinePoints = [];
            this.updatePropertyDrawingUI();
        }
    }
    
    openStandFromMap(locationIndex, standIndex) {
        this.closeLocationMapModal();
        this.viewLocation(locationIndex);
        setTimeout(() => {
            this.editStand(standIndex);
        }, 100);
    }
    
    closeLocationMapModal() {
        const modal = document.getElementById('locationMapModal');
        
        // Save current map view before closing
        if (this.locationMap && this.currentLocationIndex !== null) {
            const location = this.locations[this.currentLocationIndex];
            if (location) {
                const center = this.locationMap.getCenter();
                const zoom = this.locationMap.getZoom();
                location.mapView = {
                    center: [center.lat, center.lng],
                    zoom: zoom
                };
                this.saveLocations();
            }
        }
        
        modal.classList.add('hidden');
        
        // Finish any line being drawn
        if (this.isDrawingProperty && this.propertyLinePoints.length >= 2) {
            this.finishPropertyLine();
        }
        
        // Reset drawing state
        this.isDrawingProperty = false;
        this.propertyLinePoints = [];
        this.currentPropertyLine = null;
        this.propertyLines = [];
        this.currentLocationIndex = null;
        this.updatePropertyDrawingUI();
        
        // Clean up map
        if (this.locationMap) {
            this.locationMap.remove();
            this.locationMap = null;
        }
    }
    
    saveLocation() {
        const name = document.getElementById('locationName').value.trim();
        if (!name) {
            alert('Please enter a location name');
            return;
        }
        
        const editIndex = document.getElementById('locationModal').dataset.editIndex;
        
        if (editIndex !== '') {
            // Rename existing
            this.locations[parseInt(editIndex)].name = name;
        } else {
            // Add new location
            const newLocation = {
                name: name,
                stands: [],
                propertyLines: [],
                shareCode: this.sharingService.generateCode()
            };
            this.locations.push(newLocation);
            
            // Share to Firebase
            this.shareLocationToFirebase(newLocation).catch(err => {
                console.error('Failed to share location:', err);
            });
        }
        
        this.saveLocations();
        this.renderLocations();
        this.closeLocationModal();
    }
    
    async shareLocationToFirebase(location) {
        // Skip Firebase update if not configured
        if (!this.sharingService || !this.sharingService.database) {
            return; // Silently skip if Firebase not configured
        }
        
        try {
            // Compress images before sharing to reduce Firebase storage size
            const compressedLocation = await this.compressLocationImages(location);
            await this.sharingService.shareLocation(compressedLocation, location.shareCode);
            console.log('Location shared successfully with code:', location.shareCode);
        } catch (error) {
            console.error('Error sharing location:', error);
        }
    }
    
    async importLocationFromCode() {
        const code = document.getElementById('locationCodeInput').value.trim();
        
        if (!code || code.length !== 6) {
            alert('Please enter a valid 6-digit code');
            return;
        }
        
        if (!/^\d{6}$/.test(code)) {
            alert('Code must contain only numbers');
            return;
        }
        
        try {
            const locationData = await this.sharingService.getSharedLocation(code);
            
            if (!locationData) {
                alert('No location found with that code. Please check the code and try again.');
                return;
            }
            
            // Check if location with this code already exists
            const existingIndex = this.locations.findIndex(loc => loc.shareCode === code);
            
            if (existingIndex !== -1) {
                if (confirm('A location with this code already exists. Do you want to update it with the shared data?')) {
                    // Update existing location
                    this.locations[existingIndex] = {
                        ...locationData,
                        shareCode: code
                    };
                } else {
                    return;
                }
            } else {
                // Add new location
                this.locations.push({
                    ...locationData,
                    shareCode: code
                });
            }
            
            this.saveLocations();
            this.renderLocations();
            this.closeLocationModal();
            alert('Location imported successfully!');
        } catch (error) {
            console.error('Error importing location:', error);
            alert('Failed to import location. Please check your Firebase configuration and try again.');
        }
    }
    
    toggleLocationMenu(index) {
        // Close all menus first
        document.querySelectorAll('.location-menu').forEach(menu => {
            if (parseInt(menu.dataset.locationMenu) !== index) {
                menu.classList.add('hidden');
            }
        });
        
        // Toggle the clicked menu
        const menu = document.querySelector(`.location-menu[data-location-menu="${index}"]`);
        if (menu) {
            menu.classList.toggle('hidden');
        }
    }
    
    renameLocation(index) {
        this.toggleLocationMenu(index); // Close menu
        this.openLocationModal(index);
    }
    
    deleteLocation(index) {
        this.toggleLocationMenu(index); // Close menu
        if (confirm(`Delete location "${this.locations[index].name}" and all its stands?`)) {
            this.locations.splice(index, 1);
            this.saveLocations();
            this.renderLocations();
            if (this.currentLocationId === index) {
                this.backToLocations();
            }
        }
    }
    
    openStandModal(editIndex = null) {
        this.editingStandId = editIndex;
        document.getElementById('standModalTitle').textContent = editIndex !== null ? 'Edit Stand' : 'Add Stand';
        
        // Show/hide delete button based on whether editing
        const deleteBtn = document.getElementById('deleteStandBtn');
        if (editIndex !== null) {
            deleteBtn.style.display = 'block';
        } else {
            deleteBtn.style.display = 'none';
        }
        
        // Reset form
        const standNameInput = document.getElementById('standName');
        if (standNameInput) {
            standNameInput.value = '';
        }
        const standGallery = document.getElementById('standGallery');
        if (standGallery) {
            standGallery.innerHTML = '';
        }
        this.standCoordinates = null;
        
        // Initialize map picker
        if (!this.standMapPicker) {
            this.standMapPicker = L.map('standMapPicker', {
                zoomControl: true,
                attributionControl: true
            });
            
            // Create base layers - use two-layer approach for satellite with labels
            const satelliteImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and IGP',
                maxZoom: 19
            });
            
            const satelliteLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Esri',
                maxZoom: 19
            });
            
            // Create a layer group for satellite (imagery + labels)
            const satelliteLayer = L.layerGroup([satelliteImagery, satelliteLabels]);
            
            // Create topographic layer (non-satellite version) with higher maxZoom to allow switching at any zoom level
            // We'll enforce the actual maxZoom after switching
            const topoLayer = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'USGS',
                maxZoom: 19  // Set to match satellite so Leaflet allows switching
            });
            
            // Store the actual maxZoom for topographic
            topoLayer._actualMaxZoom = 16;
            
            // Add default layer (satellite with labels)
            satelliteLayer.addTo(this.standMapPicker);
            
            // Add layer control with zoom adjustment
            const baseMaps = {
                "Satellite": satelliteLayer,
                "Topographic": topoLayer
            };
            const layerControl = L.control.layers(baseMaps).addTo(this.standMapPicker);
            
            // Adjust zoom when switching to topographic layer
            this.standMapPicker.on('baselayerchange', (e) => {
                if (e.layer === topoLayer) {
                    const currentZoom = this.standMapPicker.getZoom();
                    const actualMaxZoom = topoLayer._actualMaxZoom || 16;
                    if (currentZoom > actualMaxZoom) {
                        this.standMapPicker.setZoom(actualMaxZoom);
                    }
                    // Also prevent zooming beyond the actual maxZoom
                    this.standMapPicker.setMaxZoom(actualMaxZoom);
                } else if (e.layer === satelliteLayer) {
                    // Restore satellite maxZoom
                    this.standMapPicker.setMaxZoom(19);
                }
            });
            
            // Also handle zoom events to prevent zooming beyond topographic maxZoom
            this.standMapPicker.on('zoom', () => {
                if (this.standMapPicker.hasLayer(topoLayer)) {
                    const currentZoom = this.standMapPicker.getZoom();
                    const actualMaxZoom = topoLayer._actualMaxZoom || 16;
                    if (currentZoom > actualMaxZoom) {
                        this.standMapPicker.setZoom(actualMaxZoom);
                    }
                }
            });
            
            // This code is only reached if map wasn't initialized above
            // Try to center on user location or default
            this.setDefaultStandMapView();
            
            // Set up drag and drop for icons
            this.setupDragAndDrop();
        }
        
        // Reset state
        this.standCoordinates = null;
        this.standMapView = null;
        this.selectedIconType = 'stand';
        this.tempMarkers = []; // Track temporary markers placed during this editing session
        
        // Clear all markers from map
        this.clearAllStandMarkers();
        
        // Load and display all stands for this location on the map
        if (this.currentLocationId !== null) {
            this.displayAllStandsOnMap();
            
            // Load and display property lines for this location (read-only)
            this.displayPropertyLinesOnStandMap();
        }
        
        // Reset checkboxes
        document.querySelectorAll('input[name="wind"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('input[name="time"]').forEach(cb => cb.checked = false);
        
        // If editing, populate form and show saved location
        if (editIndex !== null) {
            const stand = this.locations[this.currentLocationId].stands[editIndex];
            const standNameInput = document.getElementById('standName');
            if (standNameInput) {
                standNameInput.value = stand.name;
            }
            
            // Set icon type
            this.selectedIconType = stand.iconType || 'stand';
            
            // Set wind checkboxes
            if (stand.wind) {
                if (Array.isArray(stand.wind)) {
                    stand.wind.forEach(w => {
                        const checkbox = document.querySelector(`input[name="wind"][value="${w}"]`);
                        if (checkbox) {
                            checkbox.checked = true;
                        }
                    });
                } else {
                    // Handle old format (single value)
                    const checkbox = document.querySelector(`input[name="wind"][value="${stand.wind}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                }
            }
            
            // Set time checkboxes
            if (stand.time) {
                if (Array.isArray(stand.time)) {
                    stand.time.forEach(t => {
                        const checkbox = document.querySelector(`input[name="time"][value="${t}"]`);
                        if (checkbox) {
                            checkbox.checked = true;
                        }
                    });
                } else {
                    // Handle old format (single value)
                    const checkbox = document.querySelector(`input[name="time"][value="${stand.time}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                }
            }
            
            if (stand.lat && stand.lng) {
                // Show saved location with saved view
                this.standCoordinates = { lat: stand.lat, lng: stand.lng };
                if (stand.mapView) {
                    this.standMapView = stand.mapView;
                    this.standMapPicker.setView([stand.mapView.center[0], stand.mapView.center[1]], stand.mapView.zoom);
                } else {
                    // Fallback for old stands without saved view
                    this.standMapPicker.setView([stand.lat, stand.lng], 16);
                }
                // Place all icons for this stand on the map
                if (stand.icons && Array.isArray(stand.icons)) {
                    // New format: stand has icons array
                    stand.icons.forEach(icon => {
                        if (icon.lat && icon.lng) {
                            this.placeIconOnMap(icon.lat, icon.lng, icon.iconType || 'stand');
                        }
                    });
                } else {
                    // Old format: single icon (backward compatibility)
                    if (stand.lat && stand.lng) {
                        this.placeIconOnMap(stand.lat, stand.lng, stand.iconType || 'stand');
                    }
                }
            } else {
                // No saved location, center on user or default
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => {
                            this.standMapPicker.setView([pos.coords.latitude, pos.coords.longitude], 15);
                        },
                        () => {
                            this.standMapPicker.setView([32.7962, -95.4516], 13);
                        }
                    );
                } else {
                    this.standMapPicker.setView([32.7962, -95.4516], 13);
                }
            }
            
            // Load images
            if (stand.images) {
                stand.images.forEach((img, idx) => {
                    this.addImageToGallery(img, editIndex, idx);
                });
            }
        } else {
            // New stand - use location's map view if available, otherwise center on user or default
            if (this.currentLocationId !== null) {
                const location = this.locations[this.currentLocationId];
                
                // Check if location has a saved map view
                if (location.mapView && location.mapView.center && location.mapView.zoom) {
                    // Use location's saved map view
                    this.standMapPicker.setView([location.mapView.center[0], location.mapView.center[1]], location.mapView.zoom);
                } else if (location.stands && location.stands.length > 0) {
                    // No saved view, but has stands - center on first stand or calculate bounds
                    const firstStand = location.stands[0];
                    if (firstStand.lat && firstStand.lng) {
                        this.standMapPicker.setView([firstStand.lat, firstStand.lng], 16);
                    } else if (firstStand.icons && firstStand.icons.length > 0) {
                        const firstIcon = firstStand.icons[0];
                        this.standMapPicker.setView([firstIcon.lat, firstIcon.lng], 16);
                    } else {
                        // Fallback to user location or default
                        this.setDefaultStandMapView();
                    }
                } else {
                    // No stands in location - fallback to user location or default
                    this.setDefaultStandMapView();
                }
            } else {
                // No location selected - fallback to user location or default
                this.setDefaultStandMapView();
            }
        }
        
        // Show modal first, then populate (ensures all elements exist)
        const standModal = document.getElementById('standModal');
        if (standModal) {
            standModal.classList.remove('hidden');
        }
        
        // Invalidate map size to ensure it renders correctly
        setTimeout(() => {
            if (this.standMapPicker) {
                this.standMapPicker.invalidateSize();
            }
        }, 100);
    }
    
    setDefaultStandMapView() {
        // Helper method to set default map view (user location or Quitman, TX 75783)
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    this.standMapPicker.setView([pos.coords.latitude, pos.coords.longitude], 15);
                },
                () => {
                    this.standMapPicker.setView([32.7962, -95.4516], 13);
                }
            );
        } else {
            this.standMapPicker.setView([32.7962, -95.4516], 13);
        }
    }
    
    setupDragAndDrop() {
        if (!this.standMapPicker) return;
        
        const draggableIcons = document.querySelectorAll('.draggable-icon');
        let selectedIconType = null;
        
        // Set up click handlers for icon buttons to select/deselect
        draggableIcons.forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const iconType = icon.dataset.iconType;
                
                // If clicking the same icon, deselect it
                if (selectedIconType === iconType) {
                    selectedIconType = null;
                    icon.classList.remove('selected');
                } else {
                    // Deselect all icons
                    draggableIcons.forEach(i => i.classList.remove('selected'));
                    // Select this icon
                    selectedIconType = iconType;
                    icon.classList.add('selected');
                }
            });
        });
        
        // Set up click handler on map to place icon when one is selected
        this.standMapPicker.on('click', (e) => {
            if (selectedIconType) {
                const latlng = e.latlng;
                this.placeIconOnMap(latlng.lat, latlng.lng, selectedIconType);
                
                // Deselect the icon after placing
                selectedIconType = null;
                draggableIcons.forEach(i => i.classList.remove('selected'));
            }
        });
    }
    
    placeIconOnMap(lat, lng, iconType) {
        if (!this.standMapPicker) return;
        
        // Create the marker
        const iconData = this.getIconForType(iconType);
        const newMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'stand-location-marker',
                html: iconData.html,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            }),
            draggable: true // Allow moving icons after placement
        }).addTo(this.standMapPicker);
        
        // Store marker data
        newMarker.iconType = iconType;
        newMarker.isTemporary = this.editingStandId === null;
        
        // If editing an existing stand, we still want to track all markers
        // Add to temp markers array so it persists
        this.tempMarkers.push(newMarker);
        
        // Update coordinates for saving (use the last placed icon)
        this.standCoordinates = { lat, lng };
        
        // Save current map view (zoom and center) as default
        const center = this.standMapPicker.getCenter();
        const zoom = this.standMapPicker.getZoom();
        this.standMapView = {
            center: [center.lat, center.lng],
            zoom: zoom
        };
        
        // Allow dragging the marker to reposition it
        newMarker.on('dragend', () => {
            const position = newMarker.getLatLng();
            this.standCoordinates = { lat: position.lat, lng: position.lng };
        });
        
        // Show delete option when clicking on marker
        newMarker.on('click', (e) => {
            e.originalEvent.stopPropagation();
            this.showDeleteOptionForMarker(newMarker, e.originalEvent);
        });
    }
    
    showDeleteOptionForMarker(marker, event) {
        // Remove any existing delete option popup
        const existingPopup = document.getElementById('iconDeletePopup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // Create delete option popup
        const popup = document.createElement('div');
        popup.id = 'iconDeletePopup';
        popup.className = 'icon-delete-popup';
        popup.innerHTML = `
            <button class="icon-delete-btn" onclick="standsService.deleteMarkerFromMap(${this.tempMarkers.indexOf(marker)})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Delete
            </button>
        `;
        
        // Position popup near the click location
        const mapContainer = document.getElementById('standMapPicker');
        const rect = mapContainer.getBoundingClientRect();
        const point = this.standMapPicker.latLngToContainerPoint(marker.getLatLng());
        
        popup.style.left = (rect.left + point.x + 10) + 'px';
        popup.style.top = (rect.top + point.y - 30) + 'px';
        
        document.body.appendChild(popup);
        
        // Close popup when clicking outside
        const closePopup = (e) => {
            if (!popup.contains(e.target) && e.target !== event.target) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closePopup);
        }, 100);
    }
    
    deleteMarkerFromMap(markerIndex) {
        if (markerIndex < 0 || markerIndex >= this.tempMarkers.length) return;
        
        const marker = this.tempMarkers[markerIndex];
        if (marker && this.standMapPicker) {
            this.standMapPicker.removeLayer(marker);
            this.tempMarkers.splice(markerIndex, 1);
        }
        
        // Remove the delete popup
        const popup = document.getElementById('iconDeletePopup');
        if (popup) {
            popup.remove();
        }
    }
    
    showDeleteOptionForPermanentMarker(marker, event) {
        // Remove any existing delete option popup
        const existingPopup = document.getElementById('iconDeletePopup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // Create delete option popup
        const popup = document.createElement('div');
        popup.id = 'iconDeletePopup';
        popup.className = 'icon-delete-popup';
        
        popup.innerHTML = `
            <button class="icon-delete-btn" onclick="standsService.deletePermanentMarker(${marker.standIndex}, ${marker.iconIndex !== undefined ? marker.iconIndex : -1})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Delete
            </button>
        `;
        
        // Position popup near the click location
        const mapContainer = document.getElementById('standMapPicker');
        const rect = mapContainer.getBoundingClientRect();
        const point = this.standMapPicker.latLngToContainerPoint(marker.getLatLng());
        
        popup.style.left = (rect.left + point.x + 10) + 'px';
        popup.style.top = (rect.top + point.y - 30) + 'px';
        
        document.body.appendChild(popup);
        
        // Close popup when clicking outside
        const closePopup = (e) => {
            if (!popup.contains(e.target) && e.target !== event.target) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closePopup);
        }, 100);
    }
    
    deletePermanentMarker(standIndex, iconIndex) {
        if (standIndex < 0 || standIndex >= this.locations[this.currentLocationId].stands.length) return;
        
        const stand = this.locations[this.currentLocationId].stands[standIndex];
        
        if (iconIndex >= 0 && stand.icons && Array.isArray(stand.icons)) {
            // New format: remove icon from icons array
            stand.icons.splice(iconIndex, 1);
            
            // If no icons left, remove lat/lng
            if (stand.icons.length === 0) {
                stand.lat = null;
                stand.lng = null;
            } else {
                // Update primary location to first icon
                stand.lat = stand.icons[0].lat;
                stand.lng = stand.icons[0].lng;
                stand.iconType = stand.icons[0].iconType;
            }
        } else {
            // Old format: remove the single icon
            stand.lat = null;
            stand.lng = null;
        }
        
        // Remove marker from map
        const markerToRemove = this.standMarkers.find(m => 
            m.standIndex === standIndex && 
            (iconIndex < 0 ? m.iconIndex === undefined : m.iconIndex === iconIndex)
        );
        
        if (markerToRemove && this.standMapPicker) {
            this.standMapPicker.removeLayer(markerToRemove);
            const index = this.standMarkers.indexOf(markerToRemove);
            if (index > -1) {
                this.standMarkers.splice(index, 1);
            }
        }
        
        this.saveLocations();
        this.renderStands();
        
        // Remove the delete popup
        const popup = document.getElementById('iconDeletePopup');
        if (popup) {
            popup.remove();
        }
    }
    
    getIconForType(iconType) {
        const icons = {
            stand: {
                html: `<svg width="32" height="32" viewBox="0 0 32 32" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));">
                    <!-- House body (red) -->
                    <rect x="6" y="12" width="20" height="18" fill="#ff0000" stroke="white" stroke-width="2"/>
                    <!-- Two windows -->
                    <rect x="9" y="16" width="5" height="5" fill="white" stroke="white" stroke-width="1"/>
                    <rect x="18" y="16" width="5" height="5" fill="white" stroke="white" stroke-width="1"/>
                </svg>`,
                color: '#ff0000'
            },
            feeder: {
                html: `<svg width="32" height="32" viewBox="0 0 32 32" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));">
                    <!-- Feeder body (green rectangle) -->
                    <rect x="12" y="6" width="8" height="18" fill="#00aa00" stroke="white" stroke-width="2" rx="1"/>
                    <!-- Two legs -->
                    <rect x="13" y="24" width="2" height="6" fill="#00aa00" stroke="white" stroke-width="1"/>
                    <rect x="17" y="24" width="2" height="6" fill="#00aa00" stroke="white" stroke-width="1"/>
                </svg>`,
                color: '#00aa00'
            },
            camera: {
                html: `<svg width="32" height="32" viewBox="0 0 32 32" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));">
                    <!-- Camera body (blue) -->
                    <rect x="8" y="10" width="16" height="12" fill="#0066ff" stroke="white" stroke-width="2" rx="2"/>
                    <!-- Camera lens -->
                    <circle cx="16" cy="16" r="4" fill="#000080" stroke="white" stroke-width="1"/>
                    <circle cx="16" cy="16" r="2" fill="#0066ff"/>
                    <!-- Viewfinder -->
                    <rect x="10" y="8" width="4" height="2" fill="#0066ff" stroke="white" stroke-width="1" rx="1"/>
                </svg>`,
                color: '#0066ff'
            }
        };
        return icons[iconType] || icons.stand;
    }
    
    clearAllStandMarkers() {
        // Remove all permanent markers from the map
        this.standMarkers.forEach(marker => {
            if (this.standMapPicker) {
                this.standMapPicker.removeLayer(marker);
            }
        });
        this.standMarkers = [];
        
        // Remove all temporary markers
        this.tempMarkers.forEach(marker => {
            if (this.standMapPicker) {
                this.standMapPicker.removeLayer(marker);
            }
        });
        this.tempMarkers = [];
        
        // Also remove the editing marker
        if (this.standMapMarker && this.standMapPicker) {
            this.standMapPicker.removeLayer(this.standMapMarker);
            this.standMapMarker = null;
        }
        
        // Clear property lines from stand map
        this.standMapPropertyLines.forEach(line => {
            if (this.standMapPicker) {
                this.standMapPicker.removeLayer(line);
            }
        });
        this.standMapPropertyLines = [];
    }
    
    displayPropertyLinesOnStandMap() {
        if (!this.standMapPicker || this.currentLocationId === null) return;
        
        const location = this.locations[this.currentLocationId];
        if (!location || !location.propertyLines || !Array.isArray(location.propertyLines)) return;
        
        // Display all property lines for this location (read-only)
        location.propertyLines.forEach(line => {
            if (line && line.length >= 2) {
                const polyline = L.polyline(line, {
                    color: '#ff0000',
                    weight: 3,
                    opacity: 0.8
                }).addTo(this.standMapPicker);
                this.standMapPropertyLines.push(polyline);
            }
        });
    }
    
    displayAllStandsOnMap() {
        if (!this.standMapPicker || this.currentLocationId === null) return;
        
        const location = this.locations[this.currentLocationId];
        if (!location || !location.stands) return;
        
        // Display all stands except the one being edited
        location.stands.forEach((stand, index) => {
            if (index === this.editingStandId) return; // Skip the one being edited
            
            // Check if stand has icons array (new format) or single icon (old format)
            if (stand.icons && Array.isArray(stand.icons)) {
                // New format: display all icons for this stand
                stand.icons.forEach((icon, iconIndex) => {
                    if (icon.lat && icon.lng) {
                        const iconData = this.getIconForType(icon.iconType || 'stand');
                        const marker = L.marker([icon.lat, icon.lng], {
                            icon: L.divIcon({
                                className: 'stand-location-marker',
                                html: iconData.html,
                                iconSize: [32, 32],
                                iconAnchor: [16, 16]
                            }),
                            draggable: true
                        }).addTo(this.standMapPicker);
                        
                        // Store reference to stand and icon index for deletion
                        marker.standIndex = index;
                        marker.iconIndex = iconIndex;
                        marker.isPermanent = true;
                        
                        // Allow dragging
                        marker.on('dragend', () => {
                            const position = marker.getLatLng();
                            const stand = this.locations[this.currentLocationId].stands[index];
                            if (stand.icons && stand.icons[iconIndex]) {
                                stand.icons[iconIndex].lat = position.lat;
                                stand.icons[iconIndex].lng = position.lng;
                                this.saveLocations();
                            }
                        });
                        
                        // Show delete option when clicking
                        marker.on('click', (e) => {
                            e.originalEvent.stopPropagation();
                            this.showDeleteOptionForPermanentMarker(marker, e.originalEvent);
                        });
                        
                        this.standMarkers.push(marker);
                    }
                });
            } else if (stand.lat && stand.lng) {
                // Old format: single icon (backward compatibility)
                const iconData = this.getIconForType(stand.iconType || 'stand');
                const marker = L.marker([stand.lat, stand.lng], {
                    icon: L.divIcon({
                        className: 'stand-location-marker',
                        html: iconData.html,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    }),
                    draggable: true
                }).addTo(this.standMapPicker);
                
                // Store reference for deletion
                marker.standIndex = index;
                marker.isPermanent = true;
                
                // Allow dragging
                marker.on('dragend', () => {
                    const position = marker.getLatLng();
                    const stand = this.locations[this.currentLocationId].stands[index];
                    stand.lat = position.lat;
                    stand.lng = position.lng;
                    this.saveLocations();
                });
                
                // Show delete option when clicking
                marker.on('click', (e) => {
                    e.originalEvent.stopPropagation();
                    this.showDeleteOptionForPermanentMarker(marker, e.originalEvent);
                });
                
                this.standMarkers.push(marker);
            }
        });
    }
    
    setStandLocation(lat, lng) {
        this.standCoordinates = { lat, lng };
        
        // Get selected icon type
        const iconData = this.getIconForType(this.selectedIconType);
        
        // Remove existing editing marker if any (only the one being edited)
        if (this.standMapMarker) {
            this.standMapPicker.removeLayer(this.standMapMarker);
            this.standMapMarker = null;
        }
        
        // Create new marker with current icon type (this is the one being edited)
        this.standMapMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'stand-location-marker',
                html: iconData.html,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(this.standMapPicker);
        
        // If we have a saved view, use it; otherwise center on location
        if (this.standMapView) {
            this.standMapPicker.setView([this.standMapView.center[0], this.standMapView.center[1]], this.standMapView.zoom);
        } else {
            this.standMapPicker.setView([lat, lng], 16);
        }
    }
    
    closeStandModal() {
        document.getElementById('standModal').classList.add('hidden');
        this.editingStandId = null;
    }
    
    saveStand() {
        console.log('saveStand called'); // Debug log
        
        // Validate that we have a location selected
        if (this.currentLocationId === null || this.currentLocationId === undefined) {
            alert('Please select a location first');
            return;
        }
        
        if (!this.locations || !this.locations[this.currentLocationId]) {
            alert('Location not found. Please try again.');
            return;
        }
        
        const name = document.getElementById('standName').value.trim();
        if (!name) {
            alert('Please enter a stand name');
            return;
        }
        
        // Validate map picker exists
        if (!this.standMapPicker) {
            alert('Map not initialized. Please try again.');
            return;
        }
        
        // Always save current map view (user may have changed it)
        const center = this.standMapPicker.getCenter();
        const zoom = this.standMapPicker.getZoom();
        this.standMapView = {
            center: [center.lat, center.lng],
            zoom: zoom
        };
        
        // Get selected wind directions
        const selectedWinds = Array.from(document.querySelectorAll('input[name="wind"]:checked')).map(cb => cb.value);
        
        // Get selected times
        const selectedTimes = Array.from(document.querySelectorAll('input[name="time"]:checked')).map(cb => cb.value);
        
        // Get images from gallery
        const galleryItems = document.querySelectorAll('#standGallery .gallery-item img');
        const images = [];
        galleryItems.forEach(img => {
            images.push(img.src);
        });
        
        // Collect all icons from temp markers (if any)
        const icons = [];
        this.tempMarkers.forEach(marker => {
            const position = marker.getLatLng();
            icons.push({
                lat: position.lat,
                lng: position.lng,
                iconType: marker.iconType
            });
        });
        
        // Use the first icon's position as the primary location, or use map center if no icons
        let lat, lng, iconType;
        if (icons.length > 0) {
            const primaryIcon = icons[0];
            lat = primaryIcon.lat;
            lng = primaryIcon.lng;
            iconType = primaryIcon.iconType;
        } else {
            // No icons - use current map center or existing coordinates
            if (this.standCoordinates) {
                lat = this.standCoordinates.lat;
                lng = this.standCoordinates.lng;
            } else {
                const center = this.standMapPicker.getCenter();
                lat = center.lat;
                lng = center.lng;
            }
            iconType = 'stand'; // Default icon type
        }
        
        // Save as a single stand with all icons (or empty icons array if none)
        const stand = {
            name: name,
            lat: lat,
            lng: lng,
            mapView: this.standMapView,
            iconType: iconType, // Primary icon type for backward compatibility
            icons: icons, // Array of all icons for this stand (empty if none)
            wind: selectedWinds.length > 0 ? selectedWinds : [],
            time: selectedTimes.length > 0 ? selectedTimes : [],
            images: images.length > 0 ? [...images] : []
        };
        
        if (this.editingStandId !== null) {
            // Editing: replace the existing stand
            this.locations[this.currentLocationId].stands[this.editingStandId] = stand;
        } else {
            // Adding new: create a single stand entry
            this.locations[this.currentLocationId].stands.push(stand);
        }
        
        // Convert all temp markers to permanent markers
        this.tempMarkers.forEach(marker => {
            this.standMarkers.push(marker);
        });
        this.tempMarkers = [];
        
        this.saveLocations();
        
        // Update Firebase if location has a share code
        if (this.currentLocationId !== null) {
            const location = this.locations[this.currentLocationId];
            if (location.shareCode) {
                this.shareLocationToFirebase(location).catch(err => {
                    console.error('Failed to update shared location:', err);
                });
            }
        }
        
        this.renderStands();
        this.closeStandModal();
    }
    
    editStand(index) {
        this.openStandModal(index);
    }
    
    deleteStandFromModal() {
        if (this.editingStandId === null) return;
        
        const stand = this.locations[this.currentLocationId].stands[this.editingStandId];
        if (confirm(`Delete stand "${stand.name}"?`)) {
            this.locations[this.currentLocationId].stands.splice(this.editingStandId, 1);
            this.saveLocations();
            this.renderStands();
            this.closeStandModal();
        }
    }
    
    handleImageUpload(e) {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                this.compressImage(file).then(compressedDataUrl => {
                    this.addImageToGallery(compressedDataUrl);
                }).catch(error => {
                    console.error('Image compression error:', error);
                    // Fallback to original if compression fails
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        this.addImageToGallery(event.target.result);
                    };
                    reader.readAsDataURL(file);
                });
            }
        });
        e.target.value = ''; // Reset input
    }
    
    compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Calculate new dimensions
                    if (width > height) {
                        if (width > maxWidth) {
                            height = (height * maxWidth) / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = (width * maxHeight) / height;
                            height = maxHeight;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Convert to compressed data URL
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressedDataUrl);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    
    // Compress an existing base64 image
    compressBase64Image(dataUrl, maxWidth = 800, maxHeight = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            // Skip if already compressed (check if it's a small JPEG)
            if (dataUrl.startsWith('data:image/jpeg') && dataUrl.length < 100000) {
                // Likely already compressed, check dimensions
                const img = new Image();
                img.onload = () => {
                    if (img.width <= maxWidth && img.height <= maxHeight) {
                        // Already small enough
                        resolve(dataUrl);
                    } else {
                        // Needs compression
                        this.compressImageFromDataUrl(dataUrl, maxWidth, maxHeight, quality)
                            .then(resolve).catch(reject);
                    }
                };
                img.onerror = () => {
                    // If we can't check, try to compress anyway
                    this.compressImageFromDataUrl(dataUrl, maxWidth, maxHeight, quality)
                        .then(resolve).catch(reject);
                };
                img.src = dataUrl;
            } else {
                // Not JPEG or large, compress it
                this.compressImageFromDataUrl(dataUrl, maxWidth, maxHeight, quality)
                    .then(resolve).catch(reject);
            }
        });
    }
    
    // Helper to compress from data URL
    compressImageFromDataUrl(dataUrl, maxWidth, maxHeight, quality) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Calculate new dimensions
                if (width > height) {
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to compressed data URL
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }
    
    // Compress all images in a location's stands before sharing
    async compressLocationImages(location) {
        const compressedLocation = JSON.parse(JSON.stringify(location)); // Deep copy
        
        if (!compressedLocation.stands || compressedLocation.stands.length === 0) {
            return compressedLocation;
        }
        
        // Compress images in all stands
        for (let stand of compressedLocation.stands) {
            if (stand.images && stand.images.length > 0) {
                const compressedImages = [];
                for (let imageDataUrl of stand.images) {
                    try {
                        const compressed = await this.compressBase64Image(imageDataUrl, 800, 800, 0.7);
                        compressedImages.push(compressed);
                    } catch (error) {
                        console.warn('Failed to compress image, using original:', error);
                        // Use original if compression fails
                        compressedImages.push(imageDataUrl);
                    }
                }
                stand.images = compressedImages;
            }
        }
        
        return compressedLocation;
    }
    
    addImageToGallery(imageSrc, standId = null, imageIndex = null) {
        const gallery = document.getElementById('standGallery');
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.innerHTML = `
            <img src="${imageSrc}" alt="Stand image">
            <button class="delete-image" onclick="standsService.removeImageFromGallery(this)">&times;</button>
        `;
        gallery.appendChild(item);
        
        // Store image data
        if (standId !== null && imageIndex !== null) {
            item.dataset.standId = standId;
            item.dataset.imageIndex = imageIndex;
        }
    }
    
    removeImageFromGallery(button) {
        button.closest('.gallery-item').remove();
    }
    
    viewStandGallery(standId) {
        const stand = this.locations[this.currentLocationId].stands[standId];
        if (!stand.images || stand.images.length === 0) {
            alert('No images in this stand\'s gallery');
            return;
        }
        
        this.viewingStandId = standId;
        this.viewingImageIndex = 0;
        this.showImageInViewer(stand.images[0]);
        
        // Show navigation buttons if multiple images
        const imageViewerModal = document.getElementById('imageViewerModal');
        if (imageViewerModal) {
            imageViewerModal.classList.remove('hidden');
            this.updateImageNavigation();
        }
    }
    
    updateImageNavigation() {
        const stand = this.locations[this.currentLocationId].stands[this.viewingStandId];
        if (!stand || !stand.images) return;
        
        const prevBtn = document.getElementById('prevImageBtn');
        const nextBtn = document.getElementById('nextImageBtn');
        
        if (prevBtn) {
            prevBtn.style.display = stand.images.length > 1 ? 'block' : 'none';
            prevBtn.disabled = this.viewingImageIndex === 0;
        }
        
        if (nextBtn) {
            nextBtn.style.display = stand.images.length > 1 ? 'block' : 'none';
            nextBtn.disabled = this.viewingImageIndex === stand.images.length - 1;
        }
    }
    
    showNextImage() {
        const stand = this.locations[this.currentLocationId].stands[this.viewingStandId];
        if (!stand || !stand.images) return;
        
        if (this.viewingImageIndex < stand.images.length - 1) {
            this.viewingImageIndex++;
            this.showImageInViewer(stand.images[this.viewingImageIndex]);
            this.updateImageNavigation();
        }
    }
    
    showPrevImage() {
        const stand = this.locations[this.currentLocationId].stands[this.viewingStandId];
        if (!stand || !stand.images) return;
        
        if (this.viewingImageIndex > 0) {
            this.viewingImageIndex--;
            this.showImageInViewer(stand.images[this.viewingImageIndex]);
            this.updateImageNavigation();
        }
    }
    
    showImageInViewer(imageSrc) {
        document.getElementById('viewerImage').src = imageSrc;
    }
    
    closeImageViewer() {
        document.getElementById('imageViewerModal').classList.add('hidden');
        this.viewingImageIndex = null;
        this.viewingStandId = null;
    }
    
    deleteCurrentImage() {
        if (this.viewingStandId === null || this.viewingImageIndex === null) return;
        
        const stand = this.locations[this.currentLocationId].stands[this.viewingStandId];
        if (confirm('Delete this image?')) {
            stand.images.splice(this.viewingImageIndex, 1);
            this.saveLocations();
            this.renderStands();
            
            // If there are more images, show the next one (or previous if we deleted the last)
            if (stand.images.length > 0) {
                if (this.viewingImageIndex >= stand.images.length) {
                    this.viewingImageIndex = stand.images.length - 1;
                }
                this.showImageInViewer(stand.images[this.viewingImageIndex]);
                this.updateImageNavigation();
            } else {
                // No more images, close viewer
                this.closeImageViewer();
            }
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ColorDetector();
    initTabs();
    new WeatherService();
    new MoonService();
    window.mapTrackingService = new MapTrackingService(); // Store globally for camera integration
    window.standsService = new StandsService(); // Store globally for access from inline handlers
});

// Update Manager Class
class UpdateManager {
    constructor() {
        this.registration = null;
        this.updateAvailable = false;
        this.checkingForUpdate = false;
        this.setupUI();
    }
    
    setupUI() {
        // Create update notification banner
        const updateBanner = document.createElement('div');
        updateBanner.id = 'updateBanner';
        updateBanner.className = 'update-banner hidden';
        updateBanner.innerHTML = `
            <div class="update-banner-content">
                <span class="update-banner-text">🔄 New version available! Click to update.</span>
                <div class="update-banner-actions">
                    <button id="updateNowBtn" class="btn btn-primary" style="padding: 6px 12px; font-size: 13px; margin-right: 8px;">Update Now</button>
                    <button id="updateLaterBtn" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px;">Later</button>
                </div>
            </div>
        `;
        document.body.insertBefore(updateBanner, document.body.firstChild);
        
        // Add settings button with gear icon to container (not header to avoid covering title)
        const container = document.querySelector('.container');
        if (container) {
            container.style.position = 'relative';
            const settingsBtn = document.createElement('button');
            settingsBtn.id = 'settingsBtn';
            settingsBtn.className = 'settings-btn';
            settingsBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"></path>
                </svg>
            `;
            settingsBtn.title = 'Settings';
            settingsBtn.setAttribute('aria-label', 'Settings');
            container.appendChild(settingsBtn);
            
            settingsBtn.addEventListener('click', () => this.openSettings());
        }
        
        // Create settings modal
        this.createSettingsModal();
        
        // Setup update banner buttons (use event delegation since elements are created dynamically)
        document.body.addEventListener('click', (e) => {
            if (e.target.id === 'updateNowBtn') {
                this.applyUpdate();
            } else if (e.target.id === 'updateLaterBtn') {
                this.hideUpdateBanner();
            }
        });
    }
    
    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            console.log('Service Workers not supported');
            return;
        }
        
        try {
            this.registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
            console.log('Service Worker registered:', this.registration);
            
            // Check for updates immediately
            await this.checkForUpdate();
            
            // Listen for service worker updates
            this.registration.addEventListener('updatefound', () => {
                console.log('Service Worker update found');
                this.handleUpdateFound();
            });
            
            // Check for updates periodically (every 5 minutes)
            setInterval(() => this.checkForUpdate(), 5 * 60 * 1000);
            
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
    
    async checkForUpdate() {
        if (this.checkingForUpdate || !this.registration) return;
        
        this.checkingForUpdate = true;
        const checkBtn = document.getElementById('checkUpdateBtn');
        const updateBtnText = document.getElementById('updateBtnText');
        const updateStatusText = document.getElementById('updateStatusText');
        
        if (checkBtn) {
            checkBtn.disabled = true;
        }
        if (updateBtnText) {
            updateBtnText.textContent = '⏳ Checking...';
        }
        if (updateStatusText) {
            updateStatusText.textContent = '';
        }
        
        try {
            // Force update check
            await this.registration.update();
            
            // Check if there's a waiting service worker
            if (this.registration.waiting) {
                this.updateAvailable = true;
                this.showUpdateBanner();
                if (updateStatusText) {
                    updateStatusText.textContent = 'Update available! See banner at top.';
                    updateStatusText.style.color = 'var(--primary-color)';
                }
            } else {
                // Check if there's an installing service worker
                if (this.registration.installing) {
                    this.handleUpdateFound();
                } else {
                    console.log('No updates available');
                    if (updateBtnText) {
                        updateBtnText.textContent = '✅ Up to date';
                    }
                    if (updateStatusText) {
                        updateStatusText.textContent = 'You have the latest version.';
                        updateStatusText.style.color = 'var(--text-secondary)';
                    }
                    setTimeout(() => {
                        if (updateBtnText) {
                            updateBtnText.textContent = '🔄 Check for Updates';
                        }
                        if (checkBtn) {
                            checkBtn.disabled = false;
                        }
                        if (updateStatusText) {
                            updateStatusText.textContent = '';
                        }
                    }, 2000);
                }
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            if (updateBtnText) {
                updateBtnText.textContent = '❌ Error';
            }
            if (updateStatusText) {
                updateStatusText.textContent = 'Failed to check for updates.';
                updateStatusText.style.color = 'var(--primary-color)';
            }
            setTimeout(() => {
                if (updateBtnText) {
                    updateBtnText.textContent = '🔄 Check for Updates';
                }
                if (checkBtn) {
                    checkBtn.disabled = false;
                }
                if (updateStatusText) {
                    updateStatusText.textContent = '';
                }
            }, 2000);
        } finally {
            this.checkingForUpdate = false;
        }
    }
    
    handleUpdateFound() {
        const installingWorker = this.registration.installing;
        if (!installingWorker) return;
        
        installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                    // New service worker is waiting
                    this.updateAvailable = true;
                    this.showUpdateBanner();
                } else {
                    // First time install
                    console.log('Service Worker installed for the first time');
                }
            }
        });
    }
    
    createSettingsModal() {
        const settingsModal = document.createElement('div');
        settingsModal.id = 'settingsModal';
        settingsModal.className = 'settings-modal hidden';
        settingsModal.innerHTML = `
            <div class="settings-modal-content">
                <div class="settings-modal-header">
                    <h2>Settings</h2>
                    <button class="settings-modal-close" id="closeSettingsBtn">&times;</button>
                </div>
                <div class="settings-modal-body">
                    <div class="settings-section">
                        <h3>App Updates</h3>
                        <button id="checkUpdateBtn" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
                            <span id="updateBtnText">🔄 Check for Updates</span>
                        </button>
                        <p class="settings-help-text" id="updateStatusText"></p>
                    </div>
                    <div class="settings-section" style="border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 20px;">
                        <p class="settings-version-text" id="versionText">App Version: Loading...</p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(settingsModal);
        
        // Close settings modal
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                this.closeSettings();
            }
        });
        
        // Check for updates button in settings
        document.getElementById('checkUpdateBtn').addEventListener('click', () => this.checkForUpdate());
        
        // Load version when settings opens
        this.loadVersion();
    }
    
    async loadVersion() {
        const versionText = document.getElementById('versionText');
        if (!versionText) return;
        
        try {
            // Get version from cache name (most reliable method)
            const cacheNames = await caches.keys();
            const currentCache = cacheNames.find(name => name.startsWith('hunting-pro-'));
            if (currentCache) {
                const version = currentCache.replace('hunting-pro-', '');
                versionText.textContent = `App Version: ${version}`;
            } else {
                // Try to get from service worker if available
                if (this.registration && this.registration.active) {
                    // Fetch the service worker script and extract version
                    try {
                        const swResponse = await fetch('./service-worker.js?t=' + Date.now());
                        const swText = await swResponse.text();
                        const versionMatch = swText.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
                        if (versionMatch) {
                            versionText.textContent = `App Version: ${versionMatch[1]}`;
                        } else {
                            versionText.textContent = 'App Version: Unknown';
                        }
                    } catch (e) {
                        versionText.textContent = 'App Version: Not installed';
                    }
                } else {
                    versionText.textContent = 'App Version: Not installed';
                }
            }
        } catch (error) {
            console.error('Error loading version:', error);
            versionText.textContent = 'App Version: Error';
        }
    }
    
    openSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.remove('hidden');
            // Reload version when opening settings
            this.loadVersion();
        }
    }
    
    closeSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    showUpdateBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.classList.remove('hidden');
        }
        const updateBtnText = document.getElementById('updateBtnText');
        if (updateBtnText) {
            updateBtnText.textContent = '🔄 Update Available';
        }
        const checkBtn = document.getElementById('checkUpdateBtn');
        if (checkBtn) {
            checkBtn.disabled = false;
        }
    }
    
    hideUpdateBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.classList.add('hidden');
        }
    }
    
    async applyUpdate() {
        try {
            // Clear all caches first to ensure fresh files are loaded
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(cacheName => {
                    console.log('Deleting cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
            
            // Unregister all service workers
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(
                registrations.map(registration => {
                    console.log('Unregistering service worker');
                    return registration.unregister();
                })
            );
            
            // If there's a waiting worker, tell it to skip waiting
            if (this.registration && this.registration.waiting) {
                this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Force reload with cache bypass (use timestamp to bust cache)
            window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
        } catch (error) {
            console.error('Error applying update:', error);
            // Fallback: reload with cache bypass
            window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
        }
    }
}

// Initialize Update Manager
let updateManager = null;
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        updateManager = new UpdateManager();
        updateManager.registerServiceWorker();
    });
}

