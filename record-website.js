#!/usr/bin/env node
// bundled-ffmpeg-recorder.js — smooth-playback Chrome screencast

const puppeteer = require('puppeteer-core');
const CDP       = require('chrome-remote-interface');
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const ffmpeg    = require('@ffmpeg-installer/ffmpeg');

const FFMPEG = ffmpeg.path;

async function getChrome() {
  // Check for environment variable first
  if (process.env.CHROME_PATH) {
    console.log(`🎬 Using Chrome from CHROME_PATH: ${process.env.CHROME_PATH}`);
    return process.env.CHROME_PATH;
  }

  // Common Chrome paths on different systems
  const possiblePaths = [
    // Linux paths
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    // macOS paths
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Windows paths
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  // Check common paths
  for (const path of possiblePaths) {
    if (fs.existsSync(path)) {
      console.log(`🎬 Found Chrome at: ${path}`);
      return path;
    }
  }

  // Try chrome-launcher as fallback
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

async function recordWebsite(url, {
  duration  = 30000,
  width     = 1920,
  height    = 1080,
  frameRate = 12, // Further reduced for smoothness
  outputDir = './recordings',
  outputFile = null,
  format    = 'mp4',
  quality   = 50, // Further reduced for performance
  verbose   = false,
  cropX     = 0,
  cropY     = 0,
  viewportWidth = 1920,
  viewportHeight = 1080
} = {}) {
  // Prep paths
  fs.mkdirSync(outputDir, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g,'-');
  const file = outputFile || `${new URL(url).hostname.replace(/[^\w]/g,'_')}_${ts}.${format}`;
  const out  = path.join(outputDir, file);

  // Launch Chrome - keeping original compatibility but with frame rate optimizations
  const browser = await puppeteer.launch({
    executablePath: await getChrome(),
    headless: true,
    args: [
      `--window-size=${viewportWidth},${viewportHeight}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--remote-debugging-port=0',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-webgl', // Keep WebGL for compatibility
      '--ignore-gpu-blacklist', // Keep GPU features for compatibility
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Only add safe performance optimizations
      '--mute-audio', // Safe CPU optimization
      '--memory-pressure-off', // Safe memory optimization
    ],
    defaultViewport: null
  });
  const page = await browser.newPage();
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  // Inject minimal performance optimizations (less aggressive)
  await page.evaluateOnNewDocument(() => {
    // Only disable problematic animations, keep site functionality
    const style = document.createElement('style');
    style.textContent = `
      /* Only target CSS animations and transitions that cause flicker */
      * {
        animation-duration: 0.1s !important;
        transition-duration: 0.1s !important;
      }
      /* Smooth scrolling can cause issues in recordings */
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

  // CDP connection
  const port = +browser.wsEndpoint().match(/:(\d+)\//)[1];
  const cdp  = await CDP({ port });
  const { Page } = cdp;
  await Page.enable();

  // ---------- Highly optimized FFmpeg for smooth playback ----------
  const durationSeconds = Math.ceil(duration / 1000);
  const ffArgs = [
    '-loglevel', verbose ? 'info' : 'error',
    '-f','image2pipe','-vcodec','png',
    '-r', String(frameRate), // Input framerate
    '-i','-',
    // Limit output duration to prevent runaway videos
    '-t', String(durationSeconds),
    // Optimized video pipeline: smooth frame generation
    '-vf',[
      'setpts=PTS-STARTPTS', // Reset timestamps
      `crop=${width}:${height}:${cropX}:${cropY}`, // Crop first
      `fps=${frameRate}:round=up`, // Generate smooth frames
      `scale=${width}:${height}:flags=fast_bilinear` // Fast scaling
    ].join(','),
    '-vsync','cfr', // Constant frame rate
    '-r', String(frameRate), // Output framerate
    '-threads', '4', // Use more threads for CX32
  ];

  if (format==='mp4') {
    // Ultra-fast H.264 for smoothness over quality
    ffArgs.push(
      '-c:v','libx264',
      '-preset','ultrafast', // Fastest possible
      '-tune','zerolatency', // Reduce encoding latency
      '-crf','30', // Higher CRF = smaller file, faster encode
      '-pix_fmt','yuv420p',
      '-movflags','+faststart',
      '-bf','0', // No B-frames for faster encoding
      '-refs','1', // Minimal reference frames
      '-me_method','dia', // Fastest motion estimation
      '-subq','1', // Fastest subpixel estimation
      '-g','50' // Keyframe every ~2 seconds
    );
  } else {
    const br = Math.round(quality * 20); // Even lower bitrate
    ffArgs.push(
      '-c:v','libvpx-vp9',
      '-b:v',`${br}k`,
      '-crf','40', // Higher CRF for VP9
      '-cpu-used','8', // Fastest VP9 speed
      '-deadline','realtime',
      '-error-resilient','1'
    );
  }
  ffArgs.push('-y',out);
  
  if(verbose) console.log('FFmpeg ->',FFMPEG,ffArgs.join(' '));
  const ff = spawn(FFMPEG, ffArgs, { 
    stdio: ['pipe','ignore','inherit'],
    env: { ...process.env, OMP_NUM_THREADS: '4' } // Use multiple threads
  });

  // Frame rate control for smoother capture
  let frameCounter = 0;
  let live = true;
  const frameInterval = 1000 / frameRate; // ms between frames
  let lastFrameTime = 0;

  Page.screencastFrame(({ data, sessionId }) => {
    if (!live || ff.stdin.destroyed) {
      Page.screencastFrameAck({ sessionId });
      return;
    }

    const now = Date.now();
    
    // Throttle frames to exact framerate for smoother output
    if (now - lastFrameTime >= frameInterval) {
      frameCounter++;
      lastFrameTime = now;
      
      try {
        ff.stdin.write(Buffer.from(data,'base64'));
      } catch (err) {
        if (verbose) console.error('Frame write error:', err);
      }
    }
    
    Page.screencastFrameAck({ sessionId });
  });

  let navOK = false;
  try {
    await Promise.race([
      Page.navigate({ url, waitUntil: 'domcontentloaded' }),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('nav-timeout')),20000))
    ]);
    navOK = true;
  } catch (_){
    console.warn('⚠️ Navigation timed out – continuing anyway');
  }
  if(navOK){
    try { await Page.loadEventFired(); } catch(_) {}
  }

  // Wait for page stability before recording
  await new Promise(r => setTimeout(r, 3000));

  // Start screencast with performance-optimized settings
  const screencastOptions = {
    format: 'png',
    everyNthFrame: 1, // Capture every frame, we'll throttle in handler
    quality: 70, // Reduced screenshot quality for performance
    maxWidth: viewportWidth,
    maxHeight: viewportHeight
  };
  await Page.startScreencast(screencastOptions);

  // Record for specified duration
  console.log(`🎬 Recording for ${duration}ms at ${frameRate}fps...`);
  const recordStart = Date.now();
  await new Promise(r=>setTimeout(r,duration));
  
  const actualDuration = Date.now() - recordStart;
  console.log(`🎬 Stopping recording... (captured ${frameCounter} frames in ${actualDuration}ms)`);
  
  live=false;
  await Page.stopScreencast();
  ff.stdin.end();
  
  // Wait for FFmpeg to finish with timeout
  await Promise.race([
    new Promise(r=>ff.on('close', (code) => {
      console.log(`🎞️ FFmpeg finished with code: ${code}`);
      r();
    })),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('FFmpeg timeout')), 45000))
  ]);
  await cdp.close();
  await browser.close();

  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error('Empty output');
  
  const fileSize = fs.statSync(out).size;
  const avgFPS = frameCounter / (actualDuration / 1000);
  console.log(`✅ Saved smooth video → ${out}`);
  console.log(`📊 Stats: ${Math.round(fileSize/1024)}KB, ${frameCounter} frames, ${avgFPS.toFixed(1)} avg fps`);
  
  return out;
}

if (require.main === module) {
  const [,,url,...a]=process.argv;
  if(!url){console.log('Usage: node record.js <url> --duration 30000 --fps 12 --quality 50');process.exit(1);} 
  const get=f=>a.includes(f)?Number(a[a.indexOf(f)+1]):undefined;
  recordWebsite(url,{
    duration: get('--duration') || 30000,
    frameRate: get('--fps') || 12,
    quality: get('--quality') || 50,
    verbose: a.includes('--verbose')
  }).catch(e=>{console.error('❌',e);process.exit(1);});
}

module.exports={ recordWebsite };