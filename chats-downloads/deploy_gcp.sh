#!/bin/bash
set -e

# Configuration
ZONE="us-central1-a"
INSTANCE_NAME="stream-recorder-vm"
MACHINE_TYPE="e2-small"
TAG="stream-recorder"
FIREWALL_RULE="allow-stream-recorder"
PROJECT_ID="stream-recorder-491900"

echo "=== STARTING GCP VM DEPLOYMENT ==="

# 1. Set the correct active project
echo "Setting gcloud project to ${PROJECT_ID}..."
gcloud config set project $PROJECT_ID

# 2. Create firewall rule to expose port 3000
echo "Creating firewall rule to allow incoming traffic on port 3000..."
if gcloud compute firewall-rules describe $FIREWALL_RULE &>/dev/null; then
  echo "Firewall rule ${FIREWALL_RULE} already exists."
else
  gcloud compute firewall-rules create $FIREWALL_RULE \
    --allow tcp:3000 \
    --target-tags=$TAG \
    --description="Allow remote access to stream recorder dashboard"
  echo "Firewall rule created."
fi

# 3. Provision the VM Instance
echo "Creating Google Compute Engine VM instance: ${INSTANCE_NAME}..."
if gcloud compute instances describe $INSTANCE_NAME --zone=$ZONE &>/dev/null; then
  echo "VM instance ${INSTANCE_NAME} already exists. Skipping creation."
else
  gcloud compute instances create $INSTANCE_NAME \
    --zone=$ZONE \
    --machine-type=$MACHINE_TYPE \
    --image-project=debian-cloud \
    --image-family=debian-11 \
    --metadata-from-file startup-script=startup.sh \
    --tags=$TAG \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-balanced
  echo "VM instance created successfully."
fi

# 4. Wait for GCE VM startup and SSH availability
echo "Waiting 30 seconds for VM to initialize and startup script to begin..."
sleep 30

# Keep checking until SSH connection works
echo "Testing SSH connectivity to VM..."
MAX_ATTEMPTS=10
ATTEMPT=1
while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  if gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="echo 'SSH Connected!'" --quiet &>/dev/null; then
    echo "SSH Connection established."
    break
  fi
  echo "SSH not ready yet, retrying in 10 seconds (Attempt $ATTEMPT/$MAX_ATTEMPTS)..."
  sleep 10
  ATTEMPT=$((ATTEMPT+1))
done

if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
  echo "Error: SSH connection timed out. Check GCP Console."
  exit 1
fi

# 5. Sync application code to VM
echo "Deploying application code to VM using gcloud scp..."
gcloud compute scp --recurse \
  server.js \
  database.json \
  package.json \
  .env \
  cookies.txt \
  public \
  ${INSTANCE_NAME}:/home/mihai/app/ \
  --zone=$ZONE \
  --quiet

# 6. Install dependencies and start server on VM
echo "Configuring dependencies and launching server under PM2 on the VM..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --quiet --command="
  # Wait for startup script to finish configuring node/pm2/yt-dlp
  echo 'Waiting for startup script to finish package installations...'
  while [ ! -f /var/log/user-data.log ] || ! grep -q '=== GCE VM STARTUP PROVISIONING COMPLETED ===' /var/log/user-data.log; do
    echo 'Startup packages still installing, checking again in 5 seconds...'
    sleep 5
  done
  
  echo 'Startup provisioning completed. Proceeding with npm installs...'
  cd /home/mihai/app
  npm install
  
  echo 'Starting Express server with PM2...'
  pm2 delete all &>/dev/null || true
  pm2 start server.js --name 'stream-recorder'
  pm2 save
  
  echo 'Configuring PM2 to run on VM startup...'
  # Enable startup script in background
  sudo env PATH=\$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u mihai --hp /home/mihai
"

# 7. Print external IP address
EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE_NAME --zone=$ZONE --format="get(networkInterfaces[0].accessConfigs[0].natIP)")

# Read credentials from local .env to display in success message
BASIC_AUTH_USER_VAL=$(grep '^BASIC_AUTH_USER=' .env | cut -d'=' -f2-)
BASIC_AUTH_PASS_VAL=$(grep '^BASIC_AUTH_PASS=' .env | cut -d'=' -f2-)

echo ""
echo "=================================================="
echo "🎉 DEPLOYMENT COMPLETED SUCCESSFUL!"
echo "=================================================="
echo "Your app is live and remote-accessible!"
echo "URL: http://${EXTERNAL_IP}:3000"
echo "Basic Auth Username: ${BASIC_AUTH_USER_VAL:-admin}"
echo "Basic Auth Password: ${BASIC_AUTH_PASS_VAL}"
echo "=================================================="
echo ""
