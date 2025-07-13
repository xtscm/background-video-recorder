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
  frameRate = 15, // Reduced from 30 for server performance
  outputDir = './recordings',
  outputFile = null,
  format    = 'mp4',
  quality   = 60, // Reduced from 80 for server performance
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

  // Launch Chrome at viewport size
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
      '--enable-webgl',
      '--ignore-gpu-blacklist',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    defaultViewport: null
  });
  const page = await browser.newPage();
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  // CDP connection
  const port = +browser.wsEndpoint().match(/:(\d+)\//)[1];
  const cdp  = await CDP({ port });
  const { Page } = cdp;
  await Page.enable();

  // ---------- FFmpeg (server-optimized, duration-limited) ----------
  const durationSeconds = Math.ceil(duration / 1000);
  const ffArgs = [
    '-loglevel', verbose ? 'info' : 'error',
    '-use_wallclock_as_timestamps','1','-fflags','+genpts',
    '-f','image2pipe','-vcodec','png','-i','-',
    // Limit output duration to prevent runaway videos
    '-t', String(durationSeconds),
    // Server-optimized video filter: crop first, then fps, then scale
    '-vf',`setpts=PTS-STARTPTS,crop=${width}:${height}:${cropX}:${cropY},fps=${frameRate}:round=up,scale=${width}:${height}:flags=fast_bilinear`,
    '-vsync','cfr',
    // Server optimization flags
    '-threads', '2',
    '-preset', 'ultrafast',
  ];
  if (format==='mp4') {
    // Server-optimized H.264 settings
    const crf = Math.max(23, 40 - Math.round(quality/4)); // Higher CRF for servers
    ffArgs.push('-c:v','libx264','-preset','ultrafast','-crf',String(crf),'-pix_fmt','yuv420p');
    ffArgs.push('-movflags','+faststart'); // Web optimization
  } else {
    const br=Math.round(quality*30); // Lower bitrate for servers
    ffArgs.push('-c:v','libvpx-vp9','-b:v',`${br}k`,'-cpu-used','8'); // Fastest VP9 encoding
  }
  ffArgs.push('-y',out);
  if(verbose) console.log('FFmpeg ->',FFMPEG,ffArgs.join(' '));
  const ff = spawn(FFMPEG, ffArgs, { stdio: ['pipe','ignore','inherit'] });

  let live=true;
  Page.screencastFrame(({ data, sessionId }) => {
    if (!live || ff.stdin.destroyed) return;
    ff.stdin.write(Buffer.from(data,'base64'));
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
  // Start screencast with server-optimized settings
  const screencastOptions = {
    format: 'png',
    everyNthFrame: Math.max(1, Math.floor(30 / frameRate)), // Reduce capture rate
    quality: Math.min(80, quality) // Limit screenshot quality for performance
  };
  await Page.startScreencast(screencastOptions);

  // Record for specified duration
  console.log(`🎬 Recording for ${duration}ms...`);
  await new Promise(r=>setTimeout(r,duration));
  live=false;
  
  console.log(`🎬 Stopping recording...`);
  await Page.stopScreencast();
  ff.stdin.end();
  
  // Wait for FFmpeg to finish with timeout
  await Promise.race([
    new Promise(r=>ff.on('close',r)),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('FFmpeg timeout')), 30000))
  ]);
  await cdp.close();
  await browser.close();

  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error('Empty output');
  console.log(`✅ Saved smooth video → ${out}`);
  return out;
}

if (require.main === module) {
  const [,,url,...a]=process.argv;
  if(!url){console.log('Usage: node record.js <url> --duration 30000');process.exit(1);} 
  const get=f=>a.includes(f)?Number(a[a.indexOf(f)+1]):undefined;
  recordWebsite(url,{duration:get('--duration')||30000,verbose:a.includes('--verbose')})
    .catch(e=>{console.error('❌',e);process.exit(1);});
}

module.exports={ recordWebsite };