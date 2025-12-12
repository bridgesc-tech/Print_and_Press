# Hunting Pro - Color Detection PWA

A Progressive Web App that uses your iPhone camera to detect red colors (or any color you choose) in real-time.

## Features

- 📹 Live camera preview
- 🎨 Real-time color detection
- ⚙️ Adjustable color settings (hue, saturation, brightness)
- 🔔 Visual alerts when color is detected
- 📱 Works as a PWA - add to home screen
- 🎯 Customizable detection threshold

## How to Use

1. **Open in Safari** (on iPhone):
   - Navigate to the folder and open `index.html` in Safari
   - Or serve it from a web server

2. **Add to Home Screen**:
   - Tap the Share button in Safari
   - Select "Add to Home Screen"
   - The app will now work like a native app

3. **Using the App**:
   - Tap "Start Camera" to begin
   - Grant camera permissions when prompted
   - Adjust color settings as needed
   - When the target color is detected, a red overlay will appear
   - Tap "Stop Camera" when done

## Settings Explained

- **Target Color**: The color you want to detect (default: red)
- **Hue Tolerance**: How close the hue needs to be (0-60°)
- **Saturation Min**: Minimum color intensity (0-100%)
- **Brightness Min**: Minimum brightness (0-100%)
- **Detection Threshold**: Minimum % of frame that must match (1-50%)

## Technical Notes

- Uses `getUserMedia` API for camera access
- Processes video frames using Canvas API
- Converts RGB to HSV for better color matching
- Samples pixels for performance (every 4th pixel)
- Works offline after first load (PWA caching)

## Browser Compatibility

- iOS Safari 11.1+
- Chrome (Android)
- Edge (mobile)
- Requires HTTPS for camera access (or localhost)

## Notes

- Camera access requires HTTPS (except localhost)
- Best performance on newer devices
- May drain battery faster due to continuous processing

