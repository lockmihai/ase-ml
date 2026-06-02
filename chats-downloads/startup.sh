#!/bin/bash

# Exit on any error
set -e

echo "Starting Antigravity Optimizer setup on Google Compute Engine..."

# 1. Update system packages
echo "Updating package list..."
sudo apt-get update -y
sudo apt-get upgrade -y

# 2. Install prerequisites and dependencies (ffmpeg, python3, pip, curl)
echo "Installing prerequisites (ffmpeg, python3)..."
sudo apt-get install -y curl ffmpeg python3 python3-pip

# 3. Install Node.js (Using NodeSource for latest LTS)
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Install yt-dlp by downloading the latest release binary
echo "Installing yt-dlp..."
sudo apt-get remove -y yt-dlp || true # Remove apt version if exists
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# 5. Install PM2 globally to manage the Node.js application
echo "Installing PM2..."
sudo npm install -g pm2

# 6. Prepare App Directory
APP_DIR="/opt/chats-downloads"
echo "Setting up application directory at $APP_DIR..."

if [ ! -d "$APP_DIR" ]; then
  sudo mkdir -p $APP_DIR
  sudo chown $USER:$USER $APP_DIR
fi

# We assume the user has copied their files to the VM or cloned the repo.
# For this script, we'll ensure dependencies in the current directory are installed.
echo "Installing Node.js app dependencies in current directory..."
npm install

# 7. Start the application with PM2
echo "Starting application with PM2..."
pm2 start server.js --name "chats-downloads"

# 8. Setup PM2 to start on boot
echo "Setting up PM2 startup script..."
pm2 startup | grep "sudo env PATH" | bash
pm2 save

echo ""
echo "========================================================="
echo "Setup Complete!"
echo "Your server should be running on port 3000."
echo ""
echo "To access it over the internet, make sure to:"
echo "1. Create a firewall rule in Google Cloud to allow TCP port 3000."
echo "2. Visit http://<YOUR_VM_EXTERNAL_IP>:3000 in your browser."
echo "3. Default login is admin / admin (change this by creating a .env file)."
echo "========================================================="
