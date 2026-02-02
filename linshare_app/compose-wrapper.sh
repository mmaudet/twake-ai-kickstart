#!/bin/bash
# compose-wrapper.sh

# Load environment variables
set -a
source ../.env
set +a

BACKEND_CONTAINER="linshare_backend"
PROVIDER_SCRIPT="./config/provider.sh"
# Process configuration
echo "Processing configuration..."
envsubst '$BASE_DOMAIN' < config/backend/linshare.extra.properties.template > config/backend/linshare.extra.properties
envsubst '$BASE_DOMAIN' < config/user-ui/config.js.template > config/user-ui/config.js

# Check if file was created
if [ ! -f "config/backend/linshare.extra.properties" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
if [ ! -f "config/user-ui/config.js" ]; then
    echo "Failed to create configuration file"
    exit 1
fi

echo "Starting Docker Compose..."

# Pass all arguments to docker compose
sudo docker compose --env-file ../.env "$@"

# ---- Wait for backend to be healthy ----
echo "⏳ Waiting for backend container to become healthy..."

while true; do
  STATUS=$(sudo docker inspect \
    --format='{{.State.Health.Status}}' \
    "$BACKEND_CONTAINER" 2>/dev/null || echo "starting")

  case "$STATUS" in
    healthy)
      echo "✔ Backend is healthy"
      break
      ;;
    unhealthy)
      echo "❌ Backend is unhealthy"
      exit 1
      ;;
    *)
      echo "… backend status: $STATUS"
      sleep 7
      ;;
  esac
done

# ---- Run provider bootstrap ----
echo "🚀 Running OIDC provider bootstrap..."
bash "$PROVIDER_SCRIPT"