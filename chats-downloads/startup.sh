#!/bin/bash
# Log output of the startup script to console logs
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "=== GCE VM STARTUP PROVISIONING ==="

# 1. Update and install basic tools
apt-get update
apt-get install -y curl build-essential ffmpeg python3 python3-pip git sqlite3

# 2. Install Node.js 18.x LTS
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# 3. Install PM2 globally
echo "Installing PM2 process manager..."
npm install -g pm2

# 4. Install latest yt-dlp
echo "Installing latest yt-dlp release..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

# Verify versions
node -v
npm -v
ffmpeg -version | head -n 1
yt-dlp --version

# 5. Create app directories
mkdir -p /home/mihai/app/downloads
chown -R mihai:mihai /home/mihai/app

echo "=== GCE VM STARTUP PROVISIONING COMPLETED ==="
