#!/bin/bash
set -e

CONTAINER="tcalendar-side-service.twake.local"

echo "▶ Import root CA into Java truststore inside container"

docker exec -it "$CONTAINER" bash -c "
  keytool -importcert -trustcacerts \
    -keystore \$JAVA_HOME/lib/security/cacerts \
    -storepass changeit \
    -alias twake-root-ca \
    -file /usr/local/share/ca-certificates/root-ca.crt \
    -noprompt
"

echo "▶ Restarting container"
docker restart "$CONTAINER"

echo "✅ Patch completed"
