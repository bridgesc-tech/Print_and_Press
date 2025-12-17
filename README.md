# Print and Press PWA

Progressive Web App for mobile order processing and purchase recording.

## Features

- 📱 **Mobile-First Design** - Optimized for mobile devices
- 📋 **Order Management** - Create and view orders on the go
- 💰 **Purchase Recording** - Record income and expenses
- 🔄 **Real-time Sync** - Automatically syncs with Firebase
- 📴 **Offline Support** - Works offline with service worker caching

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure Firebase:
   - Update `../shared/firebase-config.js` with your Firebase credentials

3. Run development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Deployment to GitHub Pages

1. Build the app:
```bash
npm run build
```

2. Push the `dist` folder to your GitHub repository

3. Enable GitHub Pages in repository settings

4. Set the source to the `dist` folder

## PWA Installation

Users can install the PWA by:
- **Chrome/Edge**: Click the install icon in the address bar
- **Safari (iOS)**: Tap Share → Add to Home Screen
- **Firefox**: Menu → Install

## Icons

You'll need to create icon files:
- `icon-192.png` (192x192 pixels)
- `icon-512.png` (512x512 pixels)

Place these in the `pwa` directory root.














