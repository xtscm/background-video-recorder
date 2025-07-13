# Quick Setup Guide

## 1. Prerequisites

Make sure you have these installed:
- **Node.js** (version 14+): [Download here](https://nodejs.org/)
- **Chrome Browser**: [Download here](https://www.google.com/chrome/)

## 2. Installation

```bash
# Navigate to the project directory
cd background-video-recorder

# Install all dependencies
npm install
```

## 3. Start the Server

```bash
# Start the application
npm start

# Alternative command
node server.js
```

You should see:
```
🎬 Website Video Recorder Web UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Server running at: http://localhost:3000
📁 Recordings saved to: ./recordings/
```

## 4. Access the Application

Open your web browser and go to:
```
http://localhost:3000
```

## 5. Test the Crop Feature

1. **Enter a URL**: Try `https://example.com`
2. **Click "Preview & Crop"**: Wait for screenshot to load
3. **Drag the crop area**: Move and resize the blue selection box
4. **Click "Add to Queue"**: Start recording with your crop selection

## 6. Verify Recording

- Watch the **Queue Status** for progress
- **Download** completed recordings from the jobs list
- Files are saved in the `./recordings/` folder

## Troubleshooting

### ❌ Chrome Not Found
```bash
# macOS
brew install --cask google-chrome

# Ubuntu/Debian
sudo apt install google-chrome-stable
```

### ❌ Port 3000 Already in Use
```bash
# Use a different port
PORT=3001 npm start
```

### ❌ Permission Errors (Linux)
```bash
sudo chmod 4755 /opt/google/chrome/chrome-sandbox
```

### ❌ Screenshot Fails
- Check your internet connection
- Try a different website URL
- Verify Chrome is properly installed

## Success! 🎉

You're now ready to record websites with precise crop selection!

### Quick Tips:
- **Drag** the crop area to move it
- **Use the 8 handles** around the edge to resize
- **Reset Crop** button returns to full screen
- **Coordinates display** shows exact pixel values
- **Multiple recordings** can run simultaneously

---

For detailed documentation, see [README.md](README.md)