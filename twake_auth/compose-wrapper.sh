#!/bin/bash
# compose-wrapper.sh

# Load environment variables
set -a
source .env
set +a

# Process configuration
echo "Processing LemonLDAP configuration..."
envsubst < config/lmConf-1.json.template > config/lmConf-1.json

# Check if file was created
if [ ! -f "config/lmConf-1.json" ]; then
    echo "Failed to create configuration file"
    exit 1
fi

echo "Creating  Certs..."
./generate-cert.sh

echo "Starting Docker Compose..."

# Pass all arguments to docker compose
sudo docker compose "$@"