#!/usr/bin/env bash
# Smoke-test the live GitHub Pages site over the real PeerJS broker (needs internet).
#   ./scripts/test-live.sh [url]
set -euo pipefail
cd "$(dirname "$0")/.."
source test/kit/containers.sh
in_playwright cabin-fever test/ui 'node /pw/ui/live.js' -e LIVE_URL="${1:-https://hamidrezakhoram.github.io/cabin-fever/}"
