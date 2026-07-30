#!/usr/bin/env bash
# build-meet.sh — build DINUM upstream Meet + apply local overlay.
#
# The image tag stays DINUM-native (v1.24.0, v1.25.0, …). All our
# additions live in patches/*.patch and are applied on top of the tagged
# upstream tree. When DINUM ships a new monthly release, bump MEET_VERSION
# in .env, re-run this script, and any patches that still apply cleanly
# roll forward for free; any that don't fail loudly so we can adapt.
#
# Usage:
#   MEET_VERSION=v1.24.0 ./meet_app/build-meet.sh
#   ./meet_app/build-meet.sh                        # picks up MEET_VERSION from ../.env
#
# Produces two images:
#   twake-meet-backend:${MEET_VERSION}
#   twake-meet-frontend:${MEET_VERSION}
#
# meet_app/docker-compose.yml references these via ${MEET_VERSION}.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

# Load MEET_VERSION from repo-root .env if not already set.
if [ -z "${MEET_VERSION:-}" ] && [ -f "../.env" ]; then
  # shellcheck disable=SC1091
  MEET_VERSION=$(awk -F= '/^MEET_VERSION=/{gsub(/["\r]/,"",$2); print $2}' ../.env)
fi
: "${MEET_VERSION:?MEET_VERSION must be set (in .env or shell env), e.g. v1.24.0}"

UPSTREAM_REPO="https://github.com/suitenumerique/meet.git"
UPSTREAM_DIR="${here}/upstream"     # gitignored; the local scratch copy
PATCH_DIR="${here}/patches"
BACKEND_TAG="twake-meet-backend:${MEET_VERSION}"
FRONTEND_TAG="twake-meet-frontend:${MEET_VERSION}"

echo "▶ Meet version pin: ${MEET_VERSION}"

# Fetch or reset the upstream working copy at the pinned tag.
if [ ! -d "${UPSTREAM_DIR}/.git" ]; then
  echo "▶ First-time clone of ${UPSTREAM_REPO} into ${UPSTREAM_DIR}"
  git clone --no-single-branch "${UPSTREAM_REPO}" "${UPSTREAM_DIR}"
fi

cd "${UPSTREAM_DIR}"
echo "▶ Fetching and pinning to ${MEET_VERSION}"
git fetch --tags --force origin
# Hard reset so any prior patch application is wiped before we reapply.
git reset --hard "${MEET_VERSION}"
git clean -fdx

# Apply local overlay in numeric order.
shopt -s nullglob
patches=("${PATCH_DIR}"/*.patch)
if [ ${#patches[@]} -gt 0 ]; then
  echo "▶ Applying ${#patches[@]} patch(es) from ${PATCH_DIR}"
  for p in "${patches[@]}"; do
    echo "  · $(basename "$p")"
    git apply --index "$p"
  done
else
  echo "▶ No patches in ${PATCH_DIR}, building vanilla upstream."
fi

# Build the two production targets.
echo "▶ Building ${BACKEND_TAG}"
docker build -f Dockerfile --target backend-production -t "${BACKEND_TAG}" .

echo "▶ Building ${FRONTEND_TAG}"
docker build -f src/frontend/Dockerfile --target frontend-production -t "${FRONTEND_TAG}" .

echo "✔ Done. Images tagged:"
echo "    ${BACKEND_TAG}"
echo "    ${FRONTEND_TAG}"
echo "Bring the stack up with: cd .. && ./wrapper.sh up --meet -d"
