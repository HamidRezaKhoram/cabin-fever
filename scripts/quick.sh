#!/usr/bin/env bash
# The quick loop while working (Node isn't needed on the host: runs in a container):
#   scripts/quick.sh                      type check + lint + strict ratchet (a few seconds)
#   scripts/quick.sh test/unit/rooms.test.js "test/unit/l*.test.js"   …then those unit tests
# The full suite (bots, browser tests) is scripts/test-all.sh — run it before and after a change.
set -euo pipefail
cd "$(dirname "$0")/.."
source test/kit/containers.sh
in_node cabin-fever '
  command -v openssl >/dev/null || apk add --no-cache -q openssl >/dev/null 2>&1 || true
  npm run -s typecheck && echo "tsc: ok" && npm run -s lint && echo "eslint: ok" && node tools/strict-ratchet.js >/dev/null && echo "ratchet: ok" || exit 1
  [ -z "$TESTS" ] && exit 0
  node --test --test-concurrency=4 --test-timeout=300000 $TESTS 2>&1 | grep -E "^# (pass|fail)|^not ok|^# load|error:|expected|actual" | head -80
' -e TESTS="$*" -e BOT_GAMES="${BOT_GAMES:-none}" -e LOAD_REPORT="${LOAD_REPORT:-}"
