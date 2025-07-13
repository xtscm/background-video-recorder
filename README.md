# Background Video Recorder with Crop Feature

A web-based tool for recording websites as videos with precise crop selection. Features a queue system for parallel processing and an intuitive crop interface.

## Features

- 🎬 **Website Video Recording**: Capture any website as MP4/WebM video
- ✂️ **Crop Selection**: Preview websites and select exact recording regions
- 🔄 **Queue System**: Process multiple recordings simultaneously (up to 3 concurrent)
- 📱 **Desktop Focus**: Optimized for 1920×1080 desktop recording
- 🎯 **Precise Cropping**: Pixel-perfect crop selection with real-time preview
- ⚡ **Live Progress**: Real-time recording status and progress tracking
- 📥 **Easy Downloads**: Direct download of completed recordings

## Quick Start

### Installation
```bash
# Install dependencies
npm install

# Start the server
npm start
# or
node server.js
```

### Access Web Interface
```bash
# Open your browser to:
http://localhost:3000
```

### Basic Usage
1. Enter a website URL (e.g., `https://example.com`)
2. Select recording duration (10s to 5min)
3. Click **"Add to Queue"** for simple full-screen recording

### Crop Recording
1. Enter a website URL
2. Click **"Preview & Crop"**
3. Wait for the screenshot to load
4. **Drag** the crop area to reposition
5. **Resize** using the 8 handles around the crop box
6. Review coordinates in the info display
7. Click **"Add to Queue"** to record with cropping

## Interface Overview

### Main Queue Interface (`/`)
- **URL Input**: Enter website to record
- **Duration Selector**: Choose recording length
- **Preview & Crop**: Open crop selection interface
- **Queue Status**: Live statistics (queued, recording, completed, failed)
- **Jobs List**: Monitor recording progress and download results

### Crop Interface
- **Screenshot Preview**: Live website screenshot at 1920×1080
- **Drag & Resize**: Interactive crop selection with 8 resize handles
- **Coordinate Display**: Real-time X, Y, Width, Height values
- **Reset Crop**: Return to full-screen selection

## API Reference

### Screenshot API
```bash
POST /api/screenshot
Content-Type: application/json

{
  "url": "https://example.com",
  "width": 1920,
  "height": 1080
}

# Returns: PNG image data
```

### Recording API
```bash
POST /api/record
Content-Type: application/json

{
  "url": "https://example.com",
  "duration": 30000,
  "width": 800,
  "height": 600,
  "cropX": 100,
  "cropY": 50,
  "viewportWidth": 1920,
  "viewportHeight": 1080
}

# Returns: {"success": true, "jobId": 123}
```

### Queue Status
```bash
GET /api/queue

# Returns:
{
  "jobs": [...],
  "status": {
    "queued": 2,
    "running": 1,
    "completed": 5,
    "failed": 0
  }
}
```

### Download Recording
```bash
GET /api/download?file=/path/to/recording.mp4

# Returns: Video file download
```

## Configuration

### Default Settings
```javascript
// Record duration
duration: 30000 (30 seconds)

// Video quality  
quality: 80 (0-100 scale)

// Frame rate
frameRate: 30

// Output format
format: 'mp4' (or 'webm')

// Concurrent recordings
maxConcurrent: 3
```

### Customization

#### Change concurrent limit:
```javascript
// In server.js
const recordingQueue = new RecordingQueue(5); // Allow 5 concurrent
```

#### Modify video quality:
```javascript
// In record-website.js, recordWebsite function
quality: 90 // Higher quality (larger files)
```

#### Add new durations:
```html
<!-- In public/index.html -->
<option value="600000">10 minutes</option>
```

## File Structure

```
background-video-recorder/
├── package.json              # Dependencies
├── server.js                 # Express server & API
├── record-website.js         # Core recording logic
├── public/
│   └── index.html           # Main interface with crop
└── recordings/               # Output videos
```

## Technical Details

### Recording Pipeline
1. **Chrome Launch**: Puppeteer opens headless Chrome at viewport size
2. **Navigation**: Page loads with timeout handling
3. **Screenshot**: Chrome DevTools captures PNG frames
4. **FFmpeg Processing**: 
   - Crop frames: `crop=${width}:${height}:${cropX}:${cropY}`
   - Convert to constant frame rate
   - Encode to MP4/WebM

### Crop Implementation
- Screenshot taken at full 1920×1080 resolution
- Crop overlay scales dynamically with image display
- Coordinates converted from display pixels to actual pixels
- FFmpeg applies crop during video encoding

## Troubleshooting

### Chrome Not Found
```bash
# macOS
brew install --cask google-chrome

# Ubuntu/Debian  
sudo apt install google-chrome-stable

# Verify installation
which google-chrome
```

### Permission Issues (Linux)
```bash
sudo chmod 4755 /opt/google/chrome/chrome-sandbox
```

### Memory Issues
```bash
# Increase Node.js memory
node --max-old-space-size=4096 server.js
```

### Port Already in Use
```bash
# Use different port
PORT=3001 node server.js
```

### Common Error Messages

**"Screenshot failed"**
- Check Chrome installation
- Verify website is accessible
- Check network connectivity

**"Navigation timeout"**
- Website may be slow to load
- Try a different URL
- Check if website blocks headless browsers

**"FFmpeg not found"**
- FFmpeg is auto-installed via npm
- Restart the application

## Requirements

- **Node.js**: 14 or higher
- **Chrome/Chromium**: Latest stable version
- **FFmpeg**: Auto-installed via @ffmpeg-installer/ffmpeg
- **Disk Space**: ~100MB for dependencies + recording storage

## Development

### Debug Mode
```bash
# Enable verbose logging
DEBUG=true node server.js
```

### Testing Crop Function
```javascript
// Test screenshot
curl -X POST http://localhost:3000/api/screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  --output test.png

// Test recording with crop
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "duration": 10000,
    "width": 400,
    "height": 300,
    "cropX": 200,
    "cropY": 100
  }'
```


**Happy Recording! 🎬✂️**