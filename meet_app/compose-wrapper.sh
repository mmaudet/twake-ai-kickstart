#!/bin/bash
# compose-wrapper.sh

set -e

ACTION="$1"

# Load environment variables
set -a
source ../.env
set +a

if [ "$ACTION" = "up" ]; then
# Process configuration
echo "Processing configuration..."
envsubst '$BASE_DOMAIN' < ./config/nginx.conf.template > config/nginx.conf
envsubst '$LIVEKIT_USE_EXTERNAL_IP $LIVEKIT_NODE_IP $LIVEKIT_TURN_HOST $LIVEKIT_TURN_USER $LIVEKIT_TURN_CREDENTIAL' < ./config/livekit.yaml.template > config/livekit.yaml

# Strip the turn_servers block when no external TURN is configured. Leaving
# it in with an empty host makes LiveKit try to register a bogus relay and
# spam warnings, so remove the whole indented block (from `turn_servers:`
# until the next unindented top-level `turn:` key inclusive of the credential
# lines but exclusive of `turn:`).
if [ -z "${LIVEKIT_TURN_HOST:-}" ]; then
  sed -i '/^  turn_servers:/,/^turn:/{/^turn:/!d}' config/livekit.yaml
fi

# Check if files were created
if [ ! -f "config/nginx.conf" ] || [ ! -f "config/livekit.yaml" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
fi

# Pass all arguments to docker compose
sudo docker compose --env-file ../.env "$@"