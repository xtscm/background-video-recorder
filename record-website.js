#!/usr/bin/env node

const puppeteer = require('puppeteer-core');
const CDP       = require('chrome-remote-interface');
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const ffmpeg    = require('@ffmpeg-installer/ffmpeg');

const FFMPEG = ffmpeg.path;

async function getChrome() {
  // Check for environment variable first (Docker/server deployment)
  if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
    const chromePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  
  // Common server paths
  const serverPaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  
  for (const path of serverPaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  
  // Fallback to chrome-launcher (development)
  try {
    const { Launcher } = await import('chrome-launcher');
    const [exe] = Launcher.getInstallations();
    if (exe) return exe;
  } catch (e) {
    // chrome-launcher might not be available in server environment
  }
  
  throw new Error('Chrome executable not found. Please install Chrome or set CHROME_PATH environment variable.');
}

function even(n){ return n % 2 === 0 ? n : n - 1; }

async function recordWebsite(url, {
  duration   = 30000,
  width      = 1920,
  height     = 1080,
  frameRate  = 25,
  jpegQ      = 60,
  outputDir  = './recordings',
  outputFile = null,
  format     = 'mp4',
  crf        = 23,
  verbose    = false,
  cropX      = 0,
  cropY      = 0,
  viewportWidth = 1920,
  viewportHeight = 1080
} = {}) {
  let browser, cdp, ff;
  const log = (...a)=>verbose&&console.log('[rec]',...a);
  
  try {
    width  = even(width);
    height = even(height);
    const vWidth = even(viewportWidth);
    const vHeight = even(viewportHeight);

    fs.mkdirSync(outputDir,{recursive:true});
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const file = outputFile || `${new URL(url).hostname.replace(/[^\w]/g,'_')}_${ts}.${format}`;
    const out  = path.join(outputDir,file);

    browser = await puppeteer.launch({
      executablePath: await getChrome(),
      headless: 'new',
      args: [
        `--window-size=${vWidth},${vHeight}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--remote-debugging-port=0',
        '--ignore-gpu-blacklist',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--ignore-certificate-errors-spki-list'
      ],
      defaultViewport: null
    });

    const port = +browser.wsEndpoint().match(/:(\d+)\//)[1];
    cdp = await CDP({port});
    const { Page } = cdp; await Page.enable();

  const needsCrop = (cropX > 0 || cropY > 0 || width !== vWidth || height !== vHeight);
  const videoFilter = needsCrop
    ? `crop=${width}:${height}:${cropX}:${cropY},scale=${width}:${height}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2`
    : `scale=${width}:${height}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2`;
  
  log(`Recording ${url}`);
  log(`Viewport: ${vWidth}x${vHeight}, Output: ${width}x${height}`);
  log(`Crop: ${needsCrop ? `${cropX},${cropY}` : 'none'}`);
  log(`Filter: ${videoFilter}`);
  
  const ffArgs=[
    '-loglevel', verbose?'info':'error',
    '-use_wallclock_as_timestamps','1','-fflags','+genpts',
    '-f','image2pipe','-vcodec','mjpeg','-i','-',
    '-vsync','vfr',
    '-vf',videoFilter,
    '-r',String(frameRate),
    '-c:v','libx264','-preset','veryfast','-crf',String(crf),
    '-pix_fmt','yuv420p','-y',out
  ];
  if(verbose)console.log('FFmpeg ->',FFMPEG,ffArgs.join(' '));
  const ff=spawn(FFMPEG,ffArgs,{stdio:['pipe','ignore','inherit']});
  
  ff.on('error', (error) => {
    log('FFmpeg error:', error);
  });
  
  ff.on('close', (code) => {
    log(`FFmpeg exited with code ${code}`);
  });

  let live=true,frames=0;
  Page.screencastFrame(({data,sessionId})=>{
    if(!live||ff.stdin.destroyed)return;
    frames++;
    if(frames === 1) log('First frame received');
    if(frames % 25 === 0) log(`${frames} frames captured`);
    ff.stdin.write(Buffer.from(data,'base64'));
    Page.screencastFrameAck({sessionId});
  });

  await Page.navigate({url});
  await new Promise(resolve => setTimeout(resolve, 3000));
  await Page.startScreencast({format:'jpeg',quality:jpegQ,everyNthFrame:1});

  await new Promise(r=>setTimeout(r,duration));
  live=false;
  try {
    await Page.stopScreencast();
  } catch(e){
    log('stopScreencast warning:', e.message);
  }
  log(`Stopping recording. Captured ${frames} frames`);
  ff.stdin.end();
  await new Promise(r=>ff.once('close',r));
  await cdp.close();
  await browser.close();

    if(!fs.existsSync(out)||!fs.statSync(out).size) throw new Error(`Empty output. Captured ${frames} frames but no video generated`);
    log(`✅ Recording completed: ${out} (${frames} frames)`);
    return out;
    
  } catch (error) {
    log(`❌ Recording failed: ${error.message}`);
    
    // Cleanup resources on error
    if (ff && !ff.stdin.destroyed) {
      try { ff.stdin.end(); } catch (e) {}
      try { ff.kill('SIGTERM'); } catch (e) {}
    }
    if (cdp) {
      try { await cdp.close(); } catch (e) {}
    }
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    
    throw error;
  }
}

if(require.main===module){
  const [,,url,...args]=process.argv;
  if(!url){console.log('Usage: node record.js <url> --duration 30000 --verbose');process.exit(1);}
  const pick=f=>{const i=args.indexOf(f);return i!==-1?Number(args[i+1]):undefined;};
  recordWebsite(url,{duration:pick('--duration')||30000,verbose:args.includes('--verbose')})
    .catch(e=>{console.error('❌',e);process.exit(1);});
}

module.exports={recordWebsite};
