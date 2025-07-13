#!/usr/bin/env node

const puppeteer = require('puppeteer-core');
const CDP       = require('chrome-remote-interface');
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const ffmpeg    = require('@ffmpeg-installer/ffmpeg');

const FFMPEG = ffmpeg.path;

async function getChrome() {
  const { Launcher } = await import('chrome-launcher');
  const [exe] = Launcher.getInstallations();
  if (!exe) throw new Error('Chrome executable not found');
  return exe;
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
  width  = even(width);
  height = even(height);
  const vWidth = even(viewportWidth);
  const vHeight = even(viewportHeight);
  const log = (...a)=>verbose&&console.log('[rec]',...a);

  fs.mkdirSync(outputDir,{recursive:true});
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const file = outputFile || `${new URL(url).hostname.replace(/[^\w]/g,'_')}_${ts}.${format}`;
  const out  = path.join(outputDir,file);

  const browser = await puppeteer.launch({
    executablePath: await getChrome(),
    headless:'new',
    args:[`--window-size=${vWidth},${vHeight}`,
      '--no-sandbox','--disable-dev-shm-usage',
      '--remote-debugging-port=0','--ignore-gpu-blacklist'],
    defaultViewport:null
  });

  const port = +browser.wsEndpoint().match(/:(\d+)\//)[1];
  const cdp  = await CDP({port});
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
}

if(require.main===module){
  const [,,url,...args]=process.argv;
  if(!url){console.log('Usage: node record.js <url> --duration 30000 --verbose');process.exit(1);}
  const pick=f=>{const i=args.indexOf(f);return i!==-1?Number(args[i+1]):undefined;};
  recordWebsite(url,{duration:pick('--duration')||30000,verbose:args.includes('--verbose')})
    .catch(e=>{console.error('❌',e);process.exit(1);});
}

module.exports={recordWebsite};
