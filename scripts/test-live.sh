#!/usr/bin/env bash
# Smoke-test the live GitHub Pages site over the real PeerJS broker (needs internet).
#   ./scripts/test-live.sh [url]
set -euo pipefail
cd "$(dirname "$0")/.."
CT=$(command -v podman || command -v docker)
"$CT" run --rm -e LIVE_URL="${1:-https://hamidrezakhoram.github.io/cabin-fever/}" -v "$PWD/test/ui":/tests:ro,Z -v cabin-fever-pw:/pw \
  mcr.microsoft.com/playwright:v1.49.1-noble sh -c 'cd /pw && [ -d node_modules/playwright ] || npm i -s playwright@1.49.1 >/dev/null 2>&1; cp /tests/live.js /pw/live.js && node /pw/live.js'
