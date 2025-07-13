#!/usr/bin/env node
// Drop-in replacement for your recordWebsite function
// Just replace your existing recordWebsite function with this one

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const FFMPEG = ffmpeg.path;

async function getChrome() {
  // Your existing getChrome function - keep it exactly the same
  if (process.env.CHROME_PATH) {
    console.log(`🎬 Using Chrome from CHROME_PATH: ${process.env.CHROME_PATH}`);
    return process.env.CHROME_PATH;
  }

  const possiblePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  for (const path of possiblePaths) {
    if (fs.existsSync(path)) {
      console.log(`🎬 Found Chrome at: ${path}`);
      return path;
    }
  }

  try {
    const { Launcher } = await import('chrome-launcher');
    const [exe] = await Launcher.getInstallations();
    if (exe) {
      console.log(`🎬 Chrome-launcher found: ${exe}`);
      return exe;
    }
  } catch (error) {
    console.warn(`🎬 Chrome-launcher failed: ${error.message}`);
  }

  throw new Error('Chrome executable not found. Please install Chrome or set CHROME_PATH environment variable.');
}

// REPLACE YOUR EXISTING recordWebsite FUNCTION WITH THIS ONE
async function recordWebsite(url, {
  duration  = 30000,
  width     = 1920,
  height    = 1080,
  frameRate = 20, // Keep your existing frameRate variable
  outputDir = './recordings',
  outputFile = null,
  format    = 'mp4',
  quality   = 70, // Keep your existing quality variable
  verbose   = false,
  cropX     = 0,
  cropY     = 0,
  viewportWidth = 1920,
  viewportHeight = 1080
} = {}) {
  
  // Keep your existing file naming logic
  fs.mkdirSync(outputDir, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g,'-');
  const file = outputFile || `${new URL(url).hostname.replace(/[^\w]/g,'_')}_${ts}.${format}`;
  const out  = path.join(outputDir, file);

  // Create temp directory for screenshots
  const tempDir = path.join(outputDir, `temp_${ts}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // Launch Chrome - keep your existing args but server-optimized
  const browser = await puppeteer.launch({
    executablePath: await getChrome(),
    headless: true,
    args: [
      `--window-size=${viewportWidth},${viewportHeight}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process', // Key for server stability
      '--remote-debugging-port=0',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--mute-audio',
      '--memory-pressure-off',
    ],
    defaultViewport: null
  });

  const page = await browser.newPage();
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  // Keep your existing CSS injection
  await page.evaluateOnNewDocument(() => {
    const style = document.createElement('style');
    style.textContent = `
      * {
        animation-duration: 0.1s !important;
        transition-duration: 0.1s !important;
      }
      html {
        scroll-behavior: auto !important;
      }
    `;
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.head.appendChild(style);
      });
    }
  });

  // Keep your existing navigation logic
  let navOK = false;
  try {
    await Promise.race([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('nav-timeout')),20000))
    ]);
    navOK = true;
  } catch (_){
    console.warn('⚠️ Navigation timed out – continuing anyway');
  }
  
  if(navOK){
    try { 
      await page.waitForLoadState?.() || await new Promise(r => setTimeout(r, 2000));
    } catch(_) {}
  }

  // Wait for page stability - keep your existing wait
  await new Promise(r => setTimeout(r, 3000));

  // Apply crop if needed (using your existing crop variables)
  if (cropX > 0 || cropY > 0) {
    await page.evaluate((x, y) => {
      window.scrollTo(x, y);
    }, cropX, cropY);
    await page.waitForTimeout(500);
  }

  // SCREENSHOT INTERVAL RECORDING - Fixed timing
  const targetFrames = Math.ceil((duration / 1000) * frameRate); // Total frames needed for full duration
  let frameCount = 0;
  const startTime = Date.now();

  console.log(`🎬 Recording for ${duration}ms using screenshots...`);
  console.log(`📸 Taking ${targetFrames} screenshots at ${frameRate}fps...`);

  // Take screenshots for the full duration, regardless of actual timing
  const endTime = startTime + duration;
  while (frameCount < targetFrames && Date.now() < endTime) {
    const frameNumber = String(frameCount).padStart(6, '0');
    const screenshotPath = path.join(tempDir, `frame_${frameNumber}.jpg`);
    
    try {
      await page.screenshot({
        path: screenshotPath,
        quality: Math.round(quality * 1.2), // Use your existing quality variable
        type: 'jpeg',
        fullPage: false,
        clip: cropX > 0 || cropY > 0 ? {
          x: cropX,
          y: cropY, 
          width: width,
          height: height
        } : undefined
      });
      frameCount++;
      
      // Progress logging (matching your existing style)
      if (frameCount % Math.max(1, Math.floor(frameRate * 2)) === 0) {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / duration) * 100);
        console.log(`📸 Progress: ${frameCount}/${targetFrames} frames (${progress.toFixed(0)}%)`);
      }
    } catch (err) {
      if (verbose) console.warn(`Screenshot ${frameCount} failed:`, err.message);
    }

    // Adaptive timing - calculate how much time we should wait
    const elapsedTime = Date.now() - startTime;
    const expectedTimeForFrame = ((frameCount + 1) / frameRate) * 1000;
    const timeToWait = Math.max(10, expectedTimeForFrame - elapsedTime); // At least 10ms wait
    
    if (timeToWait > 10) {
      await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
  }

  // If we finished early, take a few more screenshots to fill the duration
  if (Date.now() < endTime && frameCount < targetFrames) {
    const remainingTime = endTime - Date.now();
    const remainingFrames = targetFrames - frameCount;
    const catchupInterval = Math.max(50, remainingTime / remainingFrames);
    
    console.log(`📸 Catching up: taking ${remainingFrames} more frames...`);
    while (frameCount < targetFrames && Date.now() < endTime) {
      const frameNumber = String(frameCount).padStart(6, '0');
      const screenshotPath = path.join(tempDir, `frame_${frameNumber}.jpg`);
      
      try {
        await page.screenshot({
          path: screenshotPath,
          quality: Math.round(quality * 1.2),
          type: 'jpeg',
          fullPage: false,
          clip: cropX > 0 || cropY > 0 ? {
            x: cropX,
            y: cropY, 
            width: width,
            height: height
          } : undefined
        });
        frameCount++;
      } catch (err) {
        if (verbose) console.warn(`Catchup screenshot ${frameCount} failed:`, err.message);
      }
      
      await new Promise(resolve => setTimeout(resolve, catchupInterval));
    }
  }

  const actualDuration = Date.now() - startTime;
  const actualFps = frameCount / (actualDuration / 1000);
  console.log(`🎬 Stopping recording... (captured ${frameCount} frames in ${actualDuration}ms)`);
  console.log(`📊 Actual capture rate: ${actualFps.toFixed(1)} fps (target: ${frameRate} fps)`);

  await browser.close();

  // FFMPEG VIDEO CREATION (using your existing FFmpeg setup)
  console.log(`🎞️ Creating video from ${frameCount} screenshots...`);
  
  // Keep your existing FFmpeg arguments structure
  const ffArgs = [
    '-loglevel', verbose ? 'info' : 'error',
    '-y', // Overwrite output
    '-framerate', String(frameRate), // Use your frameRate variable
    '-i', path.join(tempDir, 'frame_%06d.jpg'),
    '-threads', '2', // Keep your existing thread setting
  ];

  // Keep your existing format handling
  if (format === 'mp4') {
    // Use your existing H.264 settings
    const crf = Math.max(18, 36 - Math.round(quality/3)); // Your existing CRF calculation
    ffArgs.push(
      '-c:v','libx264',
      '-preset','ultrafast', // Keep your existing preset
      '-crf', String(crf),
      '-pix_fmt','yuv420p',
      '-movflags','+faststart'
    );
  } else {
    // Use your existing WebM settings  
    const br = Math.round(quality * 20); // Your existing bitrate calculation
    ffArgs.push(
      '-c:v','libvpx-vp9',
      '-b:v',`${br}k`,
      '-cpu-used','8'
    );
  }

  ffArgs.push(out); // Your existing output path

  if(verbose) console.log('FFmpeg ->',FFMPEG,ffArgs.join(' '));

  // Run FFmpeg (keeping your existing spawn approach)
  await new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ffArgs, { stdio: ['pipe','ignore','inherit'] });
    
    ff.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });
    
    ff.on('error', (err) => {
      reject(err);
    });
  });

  // Cleanup temp files
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (err) {
    if (verbose) console.warn('Cleanup failed:', err.message);
  }

  // Keep your existing validation and return
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error('Empty output');
  console.log(`✅ Saved smooth video → ${out}`);
  
  return out;
}

// Keep your existing CLI and module exports exactly the same
if (require.main === module) {
  const [,,url,...a]=process.argv;
  if(!url){console.log('Usage: node record.js <url> --duration 30000');process.exit(1);} 
  const get=f=>a.includes(f)?Number(a[a.indexOf(f)+1]):undefined;
  recordWebsite(url,{duration:get('--duration')||30000,verbose:a.includes('--verbose')})
    .catch(e=>{console.error('❌',e);process.exit(1);});
}

module.exports={ recordWebsite };