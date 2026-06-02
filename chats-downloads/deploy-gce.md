# Deploying to Google Compute Engine (GCE)

This guide walks you through deploying the Antigravity Optimizer app to a Google Compute Engine (GCE) Virtual Machine so you can access it and record streams from your phone anywhere.

## 1. Create a VM Instance

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **Compute Engine > VM instances**.
3. Click **Create Instance**.
4. Set the following configuration:
   - **Name**: `antigravity-optimizer`
   - **Region/Zone**: Choose a region close to you (e.g., `us-central1`).
   - **Machine Configuration**: Choose a lightweight instance type, such as `e2-micro` or `e2-small`. Video downloading requires some CPU and memory, but no heavy processing.
   - **Boot Disk**:
     - **OS**: `Ubuntu` (Version `22.04 LTS` or `24.04 LTS` is recommended).
     - **Size**: Increase the disk size to at least `30-50 GB` (or more depending on how many videos you plan to archive).
   - **Firewall**: Check **Allow HTTP traffic** and **Allow HTTPS traffic**. (We will add a specific rule for port 3000 next).
5. Click **Create**.

## 2. Open Firewall for Port 3000

By default, the app runs on port `3000`. You need to allow traffic on this port.

1. Navigate to **VPC network > Firewall**.
2. Click **Create Firewall Rule**.
3. Set the following configuration:
   - **Name**: `allow-port-3000`
   - **Targets**: `All instances in the network`
   - **Source IPv4 ranges**: `0.0.0.0/0` (Allows access from anywhere)
   - **Protocols and ports**: Check `Specified protocols and ports`, select `TCP`, and enter `3000`.
4. Click **Create**.

## 3. Upload Code & Run Setup Script

Once the VM is running:

1. Click the **SSH** button next to your VM instance to open a terminal in your browser.
2. Upload the `chats-downloads` folder to your VM. You can click the **Upload file** button (up arrow icon) in the top right of the SSH window, or clone your repository if it's on GitHub.
3. Make the script executable and run it:

```bash
cd chats-downloads
chmod +x startup.sh
./startup.sh
```

This script will automatically:
- Install `Node.js`, `yt-dlp`, and `ffmpeg`.
- Install your Node.js application dependencies.
- Start the server using `pm2` so it runs continuously in the background.
- Configure `pm2` to automatically start your server if the VM reboots.

## 4. Securing Your App

Basic authentication is enabled. By default, the login is `admin` / `admin`.

To change this, create a `.env` file in the `chats-downloads` directory:

```bash
cd chats-downloads
nano .env
```

Add the following lines (replace with your desired secure credentials):
```
PORT=3000
ADMIN_USERNAME=your_secure_username
ADMIN_PASSWORD=your_secure_password
```
Save (`Ctrl+O`, `Enter`) and exit (`Ctrl+X`).

Then restart the app so it picks up the new credentials:
```bash
pm2 restart chats-downloads
```

## 5. Access Your App

Find your VM's **External IP** address in the Compute Engine console.
Open your browser and navigate to:
`http://<YOUR_VM_EXTERNAL_IP>:3000`

Log in using your credentials, and you're good to start recording streams from your phone!
