#!/usr/bin/env node
// bundled-ffmpeg-recorder.js — JPEG screencast (desktop-res, accurate duration)

const puppeteer = require('puppeteer-core');
const CDP       = require('chrome-remote-interface');
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const ffmpeg    = require('@ffmpeg-installer/ffmpeg');

const FFMPEG = ffmpeg.path;

async function getChrome() {
  const { Launcher } = await import('chrome-launcher');
  const [exe] = await Launcher.getInstallations();
  if (!exe) throw new Error('Chrome executable not found');
  return exe;
}

/**
 * Server-friendly recorder: desktop 1080p JPEG screencast, wall-clock PTS, VFR output
 */
async function recordWebsite(url, {
  duration  = 30000,
  width     = 1920,
  height    = 1080,
  frameRate = 30,          // desired playback fps (dup/hold if sparse)
  outputDir = './recordings',
  outputFile = null,
  format    = 'mp4',
  crf       = 22,
  verbose   = false
} = {}) {
  const log=(...a)=>verbose&&console.log('[rec]',...a);
  fs.mkdirSync(outputDir,{recursive:true});
  const ts=new Date().toISOString().replace(/[:.]/g,'-');
  const out=path.join(outputDir, (outputFile||`${new URL(url).hostname.replace(/[^\w]/g,'_')}_${ts}.${format}`));

  // —— Launch Chrome full-HD ——
  const browser=await puppeteer.launch({
    executablePath:await getChrome(),
    headless:'new',
    args:[
      `--window-size=${width},${height}`,
      '--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=0'
    ],
    defaultViewport:null
  });
  const port=+browser.wsEndpoint().match(/:(\d+)\//)[1];
  const cdp=await CDP({port});
  const {Page}=cdp; await Page.enable();

  // —— FFmpeg (wall-clock PTS → constant-fps) ——
  const ffArgs=[
    '-loglevel', verbose?'info':'error',
    '-use_wallclock_as_timestamps','1','-fflags','+genpts',
    '-f','image2pipe','-vcodec','mjpeg','-i','-',          // JPEG stream
    '-vsync','vfr',                                        // keep input timing
    '-vf',`scale=${width}:${height}:flags=lanczos`,        // resize if needed
    '-r', String(frameRate)                                // target playback fps
  ];
  ffArgs.push('-c:v','libx264','-preset','veryfast','-crf',String(crf),'-pix_fmt','yuv420p','-y',out);
  if(verbose)console.log('FFmpeg cmd:',FFMPEG,ffArgs.join(' '));
  const ff=spawn(FFMPEG,ffArgs,{stdio:['pipe','ignore','inherit']});

  // Capture frames
  let live=true,frames=0;
  Page.screencastFrame(({data,sessionId})=>{
    if(!live||ff.stdin.destroyed) return;
    frames++; ff.stdin.write(Buffer.from(data,'base64'));
    Page.screencastFrameAck({sessionId});
  });

  // —— Navigate & start capture ——
  await Page.navigate({url});
  await Page.startScreencast({format:'jpeg',quality:75,everyNthFrame:1});

  await new Promise(r=>setTimeout(r,duration));
  live=false;
  await Page.stopScreencast();
  ff.stdin.end();
  await new Promise(r=>ff.on('close',r));
  await cdp.close();
  await browser.close();

  if(!fs.existsSync(out)||!fs.statSync(out).size) throw new Error('Empty output');
  console.log(`✅ ${out} (${Math.round(frames/(duration/1000))} fps actual, ${frames} JPGs)`);
  return out;
}

if(require.main===module){
  const [,,url,...a]=process.argv;
  if(!url){console.log('Usage: node record.js <url> --duration 30000 --verbose');process.exit(1);} 
  const pick=f=>{const i=a.indexOf(f);return i!==-1?Number(a[i+1]):undefined;};
  recordWebsite(url,{duration:pick('--duration')||30000,verbose:a.includes('--verbose')})
    .catch(e=>{console.error('❌',e);process.exit(1);});
}

module.exports={recordWebsite};