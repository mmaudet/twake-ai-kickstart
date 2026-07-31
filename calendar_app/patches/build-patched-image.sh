#!/usr/bin/env bash
#
# Build a patched linagora/twake-calendar-side-service image with the
# WS3 Meet host-delegation patch applied.
#
# Usage: ./build-patched-image.sh [WORKDIR]
#   WORKDIR defaults to /tmp/twake-calendar-side-service-build
#
# Outputs: docker image tagged `local/twake-calendar-side-service:ws3-hostdel`
#
# Requires: docker, git, and enough disk (~5 GB) + ~20 min the first time
# (subsequent runs are incremental thanks to a persistent .m2 cache in
# WORKDIR).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="${SCRIPT_DIR}/02-meet-host-delegation.patch"

BASE_COMMIT="06e01598efa9"   # branch-master tip that produced the 2026-07-29 image
SIDE_SERVICE_REPO="https://github.com/linagora/twake-calendar-side-service.git"
TMAIL_BACKEND_REPO="https://github.com/linagora/tmail-backend.git"
IMAGE_TAG="local/twake-calendar-side-service:ws3-hostdel"

WORKDIR="${1:-/tmp/twake-calendar-side-service-build}"
mkdir -p "${WORKDIR}"

SIDE_SERVICE_DIR="${WORKDIR}/twake-calendar-side-service"
TMAIL_BACKEND_DIR="${WORKDIR}/tmail-backend"
M2_DIR="${WORKDIR}/.m2"
mkdir -p "${M2_DIR}"

echo "==> Workdir: ${WORKDIR}"

if [ ! -d "${SIDE_SERVICE_DIR}/.git" ]; then
    echo "==> Cloning twake-calendar-side-service"
    git clone --quiet "${SIDE_SERVICE_REPO}" "${SIDE_SERVICE_DIR}"
fi

echo "==> Resetting side-service to ${BASE_COMMIT} and applying patch"
(
    cd "${SIDE_SERVICE_DIR}"
    git fetch --quiet origin
    git reset --hard --quiet "${BASE_COMMIT}"
    git apply --index "${PATCH_FILE}"
)

if [ ! -d "${TMAIL_BACKEND_DIR}/.git" ]; then
    echo "==> Cloning tmail-backend (shallow) + james-project submodule"
    git clone --depth 1 --quiet "${TMAIL_BACKEND_REPO}" "${TMAIL_BACKEND_DIR}"
    (cd "${TMAIL_BACKEND_DIR}" && git submodule update --init --depth 1 --quiet james-project)
fi

TMAIL_BACKEND_MODULES=":tmail-backend-parent,:james-project,:james-server-guice,:logback-json-classic,:logback-jackson,:tmail-saas-rabbitmq,:jmap-extensions,:jmap-extensions-opensearch,:tmail-event-bus-redis,:apache-james-backends-opensearch,:apache-james-backends-rabbitmq,:apache-james-backends-redis,:james-server-data-ldap,:james-server-data-memory,:james-server-guice-common,:james-server-guice-data-ldap,:james-server-guice-opensearch,:james-server-guice-webadmin,:james-server-testing,:james-server-webadmin-data,:mock-smtp-server,:queue-rabbitmq-guice,:testing-base,:james-core,:james-server-core,:james-server-jwt,:metrics-api,:metrics-tests,:event-bus-api,:james-server-jmap,:james-server-guice-configuration,:james-server-webadmin-core,:apache-james-mailbox-store,:james-server-data-api,:james-server-util"

MAVEN_IMAGE="maven:3.9-eclipse-temurin-26"

# The tmail-backend build calls git describe on the checked-out repo — we need
# to tell git it's OK to trust our bind-mounted paths.
GIT_SAFE_DIRS='git config --global --add safe.directory "*"'

echo "==> Building tmail-backend (mvn install, no tests) — this takes a while the first time"
docker run --rm \
    -v "${TMAIL_BACKEND_DIR}:/build" \
    -v "${M2_DIR}:/root/.m2" \
    -w /build \
    "${MAVEN_IMAGE}" \
    bash -c "${GIT_SAFE_DIRS} && mvn -B clean install -Dmaven.javadoc.skip=true -DskipTests -T1C -pl ${TMAIL_BACKEND_MODULES} -am"

echo "==> Building patched twake-calendar-side-service (mvn install, no tests)"
docker run --rm \
    -v "${SIDE_SERVICE_DIR}:/build" \
    -v "${M2_DIR}:/root/.m2" \
    -w /build \
    "${MAVEN_IMAGE}" \
    bash -c "${GIT_SAFE_DIRS} && mvn -B clean install -Dmaven.javadoc.skip=true -DskipTests -T1C"

JIB_TARBALL="${SIDE_SERVICE_DIR}/app/target/jib-image.tar"
if [ ! -f "${JIB_TARBALL}" ]; then
    echo "!! jib-image.tar not produced at ${JIB_TARBALL}"
    exit 1
fi

echo "==> Loading jib image"
docker load -i "${JIB_TARBALL}"
BASE_TAG="local/twake-calendar-side-service:ws3-hostdel-base"
docker tag linagora/twake-calendar-side-service:latest "${BASE_TAG}"

# Layer the deployment's private CA into Java's truststore, so the side-service
# can complete OIDC discovery + code→token exchange against auth.<BASE> which
# uses a cert signed by the local self-signed Root CA. Without this, the
# calendar-ng SPA is stuck on the /callback screen after login.
echo "==> Baking deployment CA into Java truststore → ${IMAGE_TAG}"
CA_CTX="${WORKDIR}/ca-context"
mkdir -p "${CA_CTX}"
cp "${SCRIPT_DIR}/../../twake_auth/traefik/ssl/root-ca.crt" "${CA_CTX}/root-ca.crt"
cat > "${CA_CTX}/Dockerfile" <<EOF
FROM ${BASE_TAG}
COPY root-ca.crt /usr/local/share/ca-certificates/root-ca.crt
RUN keytool -importcert -trustcacerts \\
      -keystore \$JAVA_HOME/lib/security/cacerts \\
      -storepass changeit \\
      -alias twake-root-ca \\
      -file /usr/local/share/ca-certificates/root-ca.crt \\
      -noprompt
EOF
docker build -t "${IMAGE_TAG}" "${CA_CTX}"

echo "==> Done — image ready:"
docker images "${IMAGE_TAG}"
