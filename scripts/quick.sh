#!/usr/bin/env bash
# The quick loop while working (Node isn't needed on the host: runs in a container):
#   scripts/quick.sh                      type check + lint + strict ratchet (a few seconds)
#   scripts/quick.sh test/unit/rooms.test.js "test/unit/l*.test.js"   …then those unit tests
# The full suite (bots, browser tests) is scripts/test-all.sh — run it before and after a change.
set -euo pipefail
cd "$(dirname "$0")/.."
CT=$(command -v podman || command -v docker)
"$CT" volume create cabin-fever-quick-nm >/dev/null 2>&1 || true
"$CT" run --rm -e BOT_GAMES="${BOT_GAMES:-none}" -e LOAD_REPORT="${LOAD_REPORT:-}" -v "$PWD":/app:Z -v cabin-fever-quick-nm:/app/node_modules -w /app docker.io/library/node:20-alpine sh -c '
  [ -x node_modules/.bin/tsc ] || npm install --silent --no-audit --no-fund >/dev/null 2>&1
  command -v openssl >/dev/null || apk add --no-cache -q openssl >/dev/null 2>&1 || true
  npm run -s typecheck && echo "tsc: ok" && npm run -s lint && echo "eslint: ok" && node tools/strict-ratchet.js >/dev/null && echo "ratchet: ok" || exit 1
  [ $# -eq 0 ] && exit 0
  node --test --test-concurrency=4 --test-timeout=300000 "$@" 2>&1 | grep -E "^# (pass|fail)|^not ok|^# load|error:|expected|actual" | head -80
' sh "$@"
