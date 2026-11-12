#!/usr/bin/env bash
# Run every HomeJack test. Must pass before and after each change (see CLAUDE.md).
# Node isn't needed on the host: tests run in containers (podman or docker).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CT=$(command -v podman || command -v docker)
NODE_IMG=docker.io/library/node:20-alpine
PW_IMG=mcr.microsoft.com/playwright:v1.49.1-noble
PORT=${UI_PORT:-18012}
SKIP_UI=${SKIP_UI:-0}

step() { printf '\n\033[1;33m== %s ==\033[0m\n' "$*"; }

if [ "${UI_ONLY:-0}" != 1 ]; then
git -C "$ROOT" config core.hooksPath .githooks 2>/dev/null || true
step "1/6 content pools are up to date"
python3 tools/build-content.py >/dev/null
python3 tools/make-icons.py >/dev/null
git diff --quiet -- games/data/pools public/sprites.js || { echo "Generated files changed — review and commit them:"; git status --short games/data/pools public/sprites.js; }

step "2/6 type checks (tsc --checkJs on JS, mypy --strict on Python)"
"$CT" run --rm -v "$ROOT":/src:ro,Z -v cabin-fever-pip:/root/.cache/pip docker.io/library/python:3.12-slim sh -c '
  pip install -q mypy==1.13.0 2>/dev/null; cd /src && mypy --strict --cache-dir=/tmp/mypy tools/*.py'

step "3/6 unit + integration tests (node --test, with coverage ≥ 80%)"
# Bots play only the games changed or added since the last commit (BOT_GAMES=all to play every
# game; CI does). A game counts as changed when its module games/<id>.js changed.
if [ -z "${BOT_GAMES:-}" ]; then
  BOT_GAMES=$( { git -C "$ROOT" diff --name-only HEAD 2>/dev/null; git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null; } \
    | sed -n 's#^games/\([a-z0-9]*\)\.js$#\1#p' | sort -u | paste -sd, -)
  BOT_GAMES=${BOT_GAMES:-none}
fi
echo "bots will play: $BOT_GAMES"
mkdir -p "$ROOT/test/ui/snapshots"
"$CT" run --rm -e BOT_GAMES="$BOT_GAMES" -e SNAP_DIR=/snapshots -v "$ROOT/test/ui/snapshots":/snapshots:Z -v "$ROOT":/src:ro,Z -v cabin-fever-npm:/root/.npm "$NODE_IMG" sh -c '
  (command -v openssl >/dev/null || apk add --no-cache -q openssl >/dev/null 2>&1 || true) &&
  cp -r /src /app && cd /app && rm -rf node_modules && npm install --silent --no-audit --no-fund >/dev/null &&
  npm run -s typecheck && echo "tsc: 0 errors" && npm run -s lint && echo "eslint: 0 problems" &&
  node tools/strict-ratchet.js &&
  npx c8 node --test --test-concurrency=4 --test-timeout=600000 test/unit/'

fi
if [ "$SKIP_UI" = 1 ]; then echo "(UI tests skipped)"; exit 0; fi

step "4/6 build image + start server"
"$CT" build -q -t cabin-fever:test . >/dev/null
"$CT" rm -f cabin-fever-test >/dev/null 2>&1 || true
# A 1-second test track in music/menu/ so the browser test can check the menu music never stops.
python3 - "$ROOT/test/.music-fixture" <<'PY'
import math, struct, sys, wave, os
for scene in ('title', 'menu'):
    d = os.path.join(sys.argv[1], scene); os.makedirs(d, exist_ok=True)
    with wave.open(os.path.join(d, 'test-beep.wav'), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        w.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 440 * i / 22050))) for i in range(22050)))
# One real bundled track (with its measured manifest entry) to check quality + streaming.
import json, shutil
root = os.path.dirname(os.path.dirname(sys.argv[1]))
os.makedirs(os.path.join(sys.argv[1], 'game'), exist_ok=True)
shutil.copy(os.path.join(root, 'music/title/heckin-crows.ogg'), os.path.join(sys.argv[1], 'game/heckin-crows.ogg'))
man = json.load(open(os.path.join(root, 'music/manifest.json')))
json.dump({'game/heckin-crows.ogg': man['title/heckin-crows.ogg']}, open(os.path.join(sys.argv[1], 'manifest.json'), 'w'))
PY
"$CT" run -d --name cabin-fever-test --network host -e PORT=$PORT -v "$ROOT/test/.music-fixture":/app/music:ro,Z \
  -e RUMPUS_DEBUG=1 -e RUMPUS_ANSWER_MS=20000 -e RUMPUS_VOTE_MS=8000 -e RUMPUS_RESULTS_MS=5000 -e RUMPUS_REVEAL_MS=2000 \
  cabin-fever:test >/dev/null
trap '"$CT" rm -f cabin-fever-test >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do curl -sf "http://localhost:$PORT/api/info" >/dev/null && break; sleep 0.5; done
# The image must actually start (a crash used to show up only as browser-test timeouts).
curl -sf "http://localhost:$PORT/api/info" >/dev/null || { echo "The image did not start:"; "$CT" logs cabin-fever-test 2>&1 | tail -30; exit 1; }
# The join address (QR code) must be this machine's real LAN address: the one its default route uses.
HOST_IP=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)
FIRST_LAN=$(curl -s "http://localhost:$PORT/api/info" | python3 -c 'import json,sys; l=json.load(sys.stdin)["lan"]; print(l[0] if l else "")')
if [ -n "$HOST_IP" ] && [ "$FIRST_LAN" != "http://$HOST_IP:$PORT" ]; then
  echo "Join address is $FIRST_LAN, but this machine's LAN address is $HOST_IP"; exit 1
fi
echo "join address: $FIRST_LAN"
echo "test server music: $(curl -s "http://localhost:$PORT/api/music")"

step "5/6 browser tests (TV + 3 phones)"
rm -rf "$ROOT/test/ui/.shots" 2>/dev/null || podman unshare rm -rf "$ROOT/test/ui/.shots" 2>/dev/null || true
mkdir -p "$ROOT/test/ui/.shots"
"$CT" run --rm --network host -e BASE_URL="http://localhost:$PORT" -e SHOTS=/shots \
  -v "$ROOT/test/ui":/tests:ro,Z -v "$ROOT/test/ui/.shots":/shots:Z -v cabin-fever-pw:/pw "$PW_IMG" sh -c '
  cd /pw && [ -d node_modules/playwright ] || npm i -s playwright@1.49.1 >/dev/null 2>&1; cp /tests/run.js /pw/run.js && node /pw/run.js'

step "6/6 GitHub Pages build (the TV's browser hosts the room; tested with no server)"
mkdir -p "$ROOT/dist"
"$CT" run --rm -v "$ROOT":/src:ro,Z -v "$ROOT/dist":/out:Z -v cabin-fever-npm:/root/.npm "$NODE_IMG" sh -c '
  cp -r /src /app && cd /app && rm -rf node_modules && npm install --silent --no-audit --no-fund >/dev/null && node tools/build-pages.js /out'
"$CT" run --rm --network host -e DIST=/dist -v "$ROOT/dist":/dist:Z -v "$ROOT/test/ui":/tests:ro,Z -v cabin-fever-pw:/pw "$PW_IMG" sh -c '
  cd /pw && [ -d node_modules/playwright ] || npm i -s playwright@1.49.1 >/dev/null 2>&1; cp /tests/pages.js /pw/pages.js && node /pw/pages.js'

printf '\n\033[1;32mALL TESTS PASSED\033[0m\n'
