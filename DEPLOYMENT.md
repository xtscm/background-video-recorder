# Server Deployment Guide

## How It Runs on the Server

The application is **server-ready** with the following optimizations and configurations:

### 🐳 Docker Deployment (Recommended)

#### Build and Run
```bash
# Build the Docker image
docker build -t video-recorder .

# Run the container
docker run -p 3000:3000 \
  -v $(pwd)/recordings:/app/recordings \
  -e CHROME_PATH=/usr/bin/chromium-browser \
  video-recorder
```

#### Docker Environment Variables
- `CHROME_PATH`: Path to Chrome executable (auto-detected)
- `PUPPETEER_EXECUTABLE_PATH`: Alternative Chrome path setting
- `PORT`: Server port (default: 3000)

### 🖥️ VPS/Server Deployment

#### 1. Install Dependencies
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nodejs npm chromium-browser

# CentOS/RHEL
sudo yum install -y nodejs npm chromium

# Alpine Linux
apk add --no-cache nodejs npm chromium
```

#### 2. Application Setup
```bash
# Clone and install
git clone <repository>
cd background-video-recorder
npm install

# Set Chrome path (if needed)
export CHROME_PATH=/usr/bin/chromium-browser

# Start server
npm start
```

#### 3. Process Manager (PM2)
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server.js --name "video-recorder"
pm2 startup
pm2 save
```

### 🔧 Server Optimizations Applied

#### Chrome Browser Arguments
- `--no-sandbox` - Required for Docker/containerized environments
- `--disable-setuid-sandbox` - Security for restricted environments
- `--single-process` - Reduces memory usage
- `--disable-gpu` - Software rendering for servers without GPU
- `--disable-dev-shm-usage` - Uses /tmp instead of /dev/shm

#### Resource Management
- **Concurrent Recordings**: Limited to 3 simultaneous (configurable)
- **Memory Optimization**: Single-process Chrome instances
- **Error Handling**: Automatic cleanup of failed recordings
- **Process Monitoring**: FFmpeg and Chrome process management

#### Chrome Detection
The app automatically detects Chrome in these locations:
1. Environment variables (`CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`)
2. Common server paths:
   - `/usr/bin/chromium-browser` (Alpine, Debian)
   - `/usr/bin/chromium` (Ubuntu)
   - `/usr/bin/google-chrome-stable` (CentOS)
   - `/opt/google/chrome/chrome` (Manual installs)

### ⚡ Performance Considerations

#### Server Specifications
- **Minimum**: 1 CPU, 2GB RAM
- **Recommended**: 2+ CPUs, 4GB+ RAM for concurrent recordings
- **Storage**: 1GB+ free space for recordings

#### Scaling Options
```javascript
// Increase concurrent limit
const recordingQueue = new RecordingQueue(5);

// Adjust video quality for performance
quality: 50,  // Lower = faster encoding
frameRate: 15 // Lower = less CPU usage
```

### 🛡️ Security & Limitations

#### Firewall Settings
```bash
# Allow only necessary port
sudo ufw allow 3000/tcp
```

#### Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### SSL/HTTPS
```bash
# With Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

### 🔍 Monitoring & Troubleshooting

#### Health Check Endpoint
```bash
curl http://localhost:3000/api/queue
```

#### Common Issues

**"Chrome executable not found"**
```bash
# Install Chrome
sudo apt install chromium-browser
# Or set path manually
export CHROME_PATH=/usr/bin/chromium-browser
```

**Memory Issues**
```bash
# Increase Node.js memory
node --max-old-space-size=4096 server.js

# Monitor memory usage
htop
```

**Permission Issues**
```bash
# Docker permissions
sudo chmod 666 /var/run/docker.sock

# File permissions
sudo chown -R $USER:$USER recordings/
```

### 📊 Production Monitoring

#### Log Management
```bash
# PM2 logs
pm2 logs video-recorder

# Docker logs
docker logs container-name

# Custom logging
tail -f recordings/app.log
```

#### Resource Monitoring
```bash
# CPU/Memory usage
pm2 monit

# Docker stats
docker stats

# System resources
htop
iostat
```

### 🚀 Production Checklist

- [ ] Chrome installed and accessible
- [ ] Adequate server resources (2+ GB RAM)
- [ ] Recordings directory writable
- [ ] Firewall configured
- [ ] SSL certificate installed (for HTTPS)
- [ ] Process manager configured (PM2/systemd)
- [ ] Log rotation configured
- [ ] Backup strategy for recordings
- [ ] Monitoring alerts configured

### 🎯 API Usage in Production

```bash
# Test recording via API
curl -X POST http://your-server:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "duration": 30000,
    "width": 1920,
    "height": 1080
  }'

# Check queue status
curl http://your-server:3000/api/queue

# Download recording
curl "http://your-server:3000/api/download?file=recordings/example.mp4" \
  --output recording.mp4
```

The application is **production-ready** and includes all necessary optimizations for server deployment!