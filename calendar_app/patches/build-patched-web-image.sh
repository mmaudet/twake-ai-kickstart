#!/usr/bin/env bash
#
# Build a patched linagora/twake-calendar-web image with the WS3
# per-attendee "delegate host" crown toggle (Patch C).
#
# Usage: ./build-patched-web-image.sh [WORKDIR]
#   WORKDIR defaults to /tmp/twake-calendar-frontend-build
#
# Outputs: docker image tagged `local/twake-calendar-web:ws3-hostdel`
#
# Requires: docker, git, ~2GB disk. First run ~5-10min (npm install);
# subsequent runs are seconds thanks to a persistent node_modules cache
# in WORKDIR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="${SCRIPT_DIR}/03-frontend-delegate-host.patch"

BASE_COMMIT="0d173029e5fd"   # branch-master tip that produced the deployed 2026-07-28 image
REPO="https://github.com/linagora/twake-calendar-frontend.git"
IMAGE_TAG="local/twake-calendar-web:ws3-hostdel"

WORKDIR="${1:-/tmp/twake-calendar-frontend-build}"
mkdir -p "${WORKDIR}"

SRC_DIR="${WORKDIR}/twake-calendar-frontend"

echo "==> Workdir: ${WORKDIR}"

if [ ! -d "${SRC_DIR}/.git" ]; then
    echo "==> Cloning twake-calendar-frontend"
    git clone --quiet "${REPO}" "${SRC_DIR}"
fi

echo "==> Resetting to ${BASE_COMMIT} and applying patch"
(
    cd "${SRC_DIR}"
    git fetch --quiet origin
    git reset --hard --quiet "${BASE_COMMIT}"
    # node_modules is reused across runs; git reset won't delete it (untracked)
    git apply --index "${PATCH_FILE}"
)

NODE_IMAGE="node:20"

# Tell git it's OK to trust the bind-mounted repo, then install and build.
echo "==> npm ci (first run downloads ~1GB into ${SRC_DIR}/node_modules)"
docker run --rm \
    -v "${SRC_DIR}:/build" \
    -w /build \
    "${NODE_IMAGE}" \
    bash -c 'git config --global --add safe.directory "*" && npm ci --prefer-offline --no-audit --no-fund'

echo "==> npm run build:private"
docker run --rm \
    -v "${SRC_DIR}:/build" \
    -w /build \
    "${NODE_IMAGE}" \
    bash -c 'git config --global --add safe.directory "*" && npm run build:private'

if [ ! -d "${SRC_DIR}/apps/private/dist" ]; then
    echo "!! apps/private/dist not produced"
    exit 1
fi

echo "==> Building Docker image ${IMAGE_TAG}"
docker build -f "${SRC_DIR}/apps/private/Dockerfile" -t "${IMAGE_TAG}" "${SRC_DIR}"

echo "==> Done — image ready:"
docker images "${IMAGE_TAG}"
