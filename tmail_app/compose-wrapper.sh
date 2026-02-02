#!/bin/bash
# compose-wrapper.sh

# Load environment variables
set -a
source ../.env
set +a

# Process configuration
echo "Processing configuration..."
envsubst '$BASE_DOMAIN' < config/smtpserver.xml.template > config/smtpserver.xml
envsubst '$BASE_DOMAIN $LDAP_BASE_DN' < config/usersrepository.xml.template > config/usersrepository.xml
envsubst '$BASE_DOMAIN' < config/domainlist.xml.template > config/domainlist.xml
envsubst '$BASE_DOMAIN' < config/jmap.properties.template > config/jmap.properties
envsubst '$BASE_DOMAIN' < config/mailcontainer.xml.template > config/mailcontainer.xml
envsubst '$BASE_DOMAIN' < tmail-web-conf/.env.template > tmail-web-conf/.env

# Check if file was created
if [ ! -f "config/smtpserver.xml" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
if [ ! -f "config/usersrepository.xml" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
if [ ! -f "config/domainlist.xml" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
if [ ! -f "config/jmap.properties" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
if [ ! -f "config/mailcontainer.xml" ]; then
    echo "Failed to create configuration file"
    exit 1
fi
if [ ! -f "tmail-web-conf/.env" ]; then
    echo "Failed to create configuration file"
    exit 1
fi

echo "Starting Docker Compose..."

# Pass all arguments to docker compose
sudo docker compose --env-file ../.env "$@"