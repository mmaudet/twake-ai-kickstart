#!/bin/bash
# compose-wrapper.sh

# Load environment variables
set -a
source .env
set +a

# Process configuration
echo "Processing ldap configuration..."
envsubst < ldap/bootstrap/users.ldif.template > ldap/bootstrap/users.ldif

# Check if file was created
if [ ! -f "ldap/bootstrap/users.ldif" ]; then
    echo "Failed to create configuration file"
    exit 1
fi


echo "Starting Docker Compose..."

# Pass all arguments to docker compose
sudo docker compose "$@"