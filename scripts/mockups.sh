#!/bin/sh
# Render the Phase 1.5 mockups (frontend/design/*.html) to docs/design/*.webp, see docs/plans/0007.
# Uses the official Playwright image, so no browser is installed on the host and Playwright is not a project
# dependency. Needs Docker, frontend/node_modules (npm ci) and internet access for the OpenStreetMap tiles.
#
#   scripts/mockups.sh                 # every page
#   scripts/mockups.sh catalogue map   # only these
set -eu

PLAYWRIGHT_VERSION=1.65.1
repo=$(cd "$(dirname "$0")/.." && pwd)

docker run --rm --init \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
  -v "$repo:/repo" \
  -w /repo/frontend \
  "mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble" \
  sh -c "npm install --silent --no-audit --no-fund --prefix /tmp/pw playwright@${PLAYWRIGHT_VERSION} >/dev/null \
         && node design/render.mjs \"\$@\"" render "$@"
