#!/bin/bash
set -e

# Container name
CONTAINER_NAME="onlyoffice-documentserver"

# Patch local.json inside the container
docker exec -it "$CONTAINER_NAME" bash -c "
    apt-get update && apt-get install -y jq && \
    jq '.services.CoAuthoring.token.enable.browser=false
        | del(.storage)
        | .services.CoAuthoring[\"request-filtering-agent\"].allowPrivateIPAddress=true
        | .services.CoAuthoring[\"request-filtering-agent\"].allowMetaIPAddress=true' \
        /etc/onlyoffice/documentserver/local.json > /tmp/oolocal.json && \
    mv /tmp/oolocal.json /etc/onlyoffice/documentserver/local.json && \
    supervisorctl restart all
    documentserver-update-securelink.sh
"
