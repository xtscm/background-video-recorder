const express = require('express');
const path = require('path');
const fs = require('fs');
const { recordWebsite } = require('./record-website');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

async function getChrome() {
  const { Launcher } = await import('chrome-launcher');
  const [exe] = await Launcher.getInstallations();
  if (!exe) throw new Error('Chrome executable not found');
  return exe;
}

async function takeScreenshot(url, { width = 1920, height = 1080 } = {}) {
  console.log(`📸 Starting screenshot for ${url} at ${width}x${height}`);
  
  let browser;
  try {
    const chromePath = await getChrome();
    console.log(`📸 Using Chrome at: ${chromePath}`);
    
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        `--window-size=${width},${height}`,
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

    console.log(`📸 Browser launched successfully`);

    const page = await browser.newPage();
    await page.setViewport({ width, height });
    
    console.log(`📸 Navigating to ${url}`);

    // Navigate with timeout and better error handling
    try {
      await Promise.race([
        page.goto(url, { 
          waitUntil: 'networkidle0',
          timeout: 30000 
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout after 30s')), 30000))
      ]);
      console.log(`📸 Navigation completed`);
    } catch (navError) {
      console.warn(`📸 Navigation warning: ${navError.message}, continuing anyway`);
      // Try a simpler navigation
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }

    // Wait for page to render
    console.log(`📸 Waiting for page to render`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take screenshot
    console.log(`📸 Taking screenshot`);
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: width,
        height: height
      }
    });

    console.log(`📸 Screenshot completed, size: ${screenshot.length} bytes`);
    return screenshot;
    
  } catch (error) {
    console.error(`📸 Screenshot error:`, error);
    throw new Error(`Screenshot failed: ${error.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log(`📸 Browser closed`);
      } catch (closeError) {
        console.warn(`📸 Browser close warning:`, closeError);
      }
    }
  }
}

app.use(express.json());
app.use(express.static('public'));

class RecordingQueue {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.queue = [];
        this.running = new Map();
        this.completed = new Map();
        this.failed = new Map();
        this.nextId = 1;
    }

    addJob(jobData) {
        const id = this.nextId++;
        const job = {
            id,
            ...jobData,
            status: 'queued',
            progress: 0,
            startTime: null,
            endTime: null,
            error: null
        };
        
        this.queue.push(job);
        this.processQueue();
        return id;
    }

    async processQueue() {
        if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const job = this.queue.shift();
        this.running.set(job.id, job);
        job.status = 'recording';
        job.startTime = new Date();

        try {
            const outputPath = await recordWebsite(job.url, {
                duration: job.duration,
                width: job.width,
                height: job.height,
                cropX: job.cropX || 0,
                cropY: job.cropY || 0,
                viewportWidth: job.viewportWidth || job.width,
                viewportHeight: job.viewportHeight || job.height,
                verbose: false
            });

            job.status = 'completed';
            job.endTime = new Date();
            job.outputPath = outputPath;
            job.progress = 100;
            
            // Get file stats for additional info
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                job.fileSize = stats.size;
                job.fileName = path.basename(outputPath);
            }
            
            this.completed.set(job.id, job);
        } catch (error) {
            job.status = 'failed';
            job.endTime = new Date();
            job.error = error.message;
            job.progress = 0;
            
            this.failed.set(job.id, job);
        }

        this.running.delete(job.id);
        this.processQueue();
    }

    getJob(id) {
        if (this.running.has(id)) return this.running.get(id);
        if (this.completed.has(id)) return this.completed.get(id);
        if (this.failed.has(id)) return this.failed.get(id);
        return this.queue.find(job => job.id === id);
    }

    getAllJobs() {
        return [
            ...this.queue,
            ...Array.from(this.running.values()),
            ...Array.from(this.completed.values()),
            ...Array.from(this.failed.values())
        ].sort((a, b) => b.id - a.id);
    }

    getQueueStatus() {
        return {
            queued: this.queue.length,
            running: this.running.size,
            completed: this.completed.size,
            failed: this.failed.size
        };
    }
}

const recordingQueue = new RecordingQueue(3);

app.post('/api/record', async (req, res) => {
    try {
        const { url, duration, width, height, cropX, cropY, viewportWidth, viewportHeight } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        const jobId = recordingQueue.addJob({
            url,
            duration: duration || 30000,
            width: width || 1920,
            height: height || 1080,
            cropX: cropX || 0,
            cropY: cropY || 0,
            viewportWidth: viewportWidth || 1920,
            viewportHeight: viewportHeight || 1080
        });

        console.log(`🎬 Added recording job ${jobId} for ${url}`);
        
        res.json({
            success: true,
            jobId: jobId,
            status: 'queued'
        });
        
    } catch (error) {
        console.error('Recording error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/api/screenshot', async (req, res) => {
    try {
        const { url, width, height } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (urlError) {
            return res.status(400).json({ success: false, error: 'Invalid URL format' });
        }

        console.log(`📸 API: Taking screenshot of ${url} at ${width || 1920}x${height || 1080}`);
        
        const screenshot = await takeScreenshot(url, {
            width: width || 1920,
            height: height || 1080
        });

        if (!screenshot || screenshot.length === 0) {
            throw new Error('Screenshot returned empty data');
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Length', screenshot.length.toString());
        res.send(screenshot);
        
        console.log(`📸 API: Screenshot sent successfully`);
        
    } catch (error) {
        console.error('📸 API: Screenshot error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to take screenshot'
        });
    }
});

app.get('/api/queue', (req, res) => {
    res.json({
        jobs: recordingQueue.getAllJobs(),
        status: recordingQueue.getQueueStatus()
    });
});

app.get('/api/job/:id', (req, res) => {
    const job = recordingQueue.getJob(parseInt(req.params.id));
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
});

app.get('/api/proxy', (req, res) => {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
        return res.status(400).send('URL parameter is required');
    }

    // Simple iframe proxy for preview (note: many sites block iframe embedding)
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { margin: 0; padding: 0; overflow: hidden; }
                iframe { width: 100%; height: 100vh; border: none; }
            </style>
        </head>
        <body>
            <iframe src="${targetUrl}" sandbox="allow-scripts allow-same-origin"></iframe>
            <div style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; border-radius: 3px; font-family: Arial; font-size: 12px;">
                Preview: ${targetUrl}
            </div>
        </body>
        </html>
    `);
});

app.get('/api/recordings', (req, res) => {
    try {
        const recordingsDir = './recordings';
        
        if (!fs.existsSync(recordingsDir)) {
            return res.json([]);
        }

        const files = fs.readdirSync(recordingsDir)
            .filter(file => file.endsWith('.webm'))
            .map(file => {
                const filePath = path.join(recordingsDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    path: filePath,
                    size: stats.size,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => b.created - a.created);

        res.json(files);
    } catch (error) {
        console.error('Error loading recordings:', error);
        res.status(500).json({ error: 'Failed to load recordings' });
    }
});

app.get('/api/download', (req, res) => {
    try {
        const filePath = req.query.file;
        
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const fileName = path.basename(filePath);
        
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'video/webm');
        
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

app.delete('/api/delete', (req, res) => {
    try {
        const filePath = req.query.file;
        
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        fs.unlinkSync(filePath);
        console.log(`🗑️  Deleted: ${filePath}`);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.get('/', (_, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
🎬 Website Video Recorder Web UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Server running at: http://localhost:${PORT}
📁 Recordings saved to: ./recordings/
🎯 API endpoints:
   POST /api/record     - Start recording
   GET  /api/recordings - List recordings
   GET  /api/download   - Download recording
   DELETE /api/delete   - Delete recording

Ready to record websites! 🚀
    `);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});