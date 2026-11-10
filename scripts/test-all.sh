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
step "1/5 content pools are up to date"
python3 tools/build-content.py >/dev/null
python3 tools/make-icons.py >/dev/null
git diff --quiet -- games/data/pools public/sprites.js || { echo "Generated files changed — review and commit them:"; git status --short games/data/pools public/sprites.js; }

step "2/5 type checks (tsc --checkJs on JS, mypy --strict on Python)"
"$CT" run --rm -v "$ROOT":/src:ro,Z -v homejack-pip:/root/.cache/pip docker.io/library/python:3.12-slim sh -c '
  pip install -q mypy==1.13.0 2>/dev/null; cd /src && mypy --strict --cache-dir=/tmp/mypy tools/*.py'

step "3/5 unit + integration tests (node --test)"
"$CT" run --rm -v "$ROOT":/src:ro,Z -v homejack-npm:/root/.npm "$NODE_IMG" sh -c '
  cp -r /src /app && cd /app && rm -rf node_modules && npm install --silent --no-audit --no-fund >/dev/null &&
  npm run -s typecheck && echo "tsc: 0 errors" && npm run -s lint && echo "eslint: 0 problems" &&
  node tools/strict-ratchet.js &&
  node --test --test-concurrency=4 test/unit/'

fi
if [ "$SKIP_UI" = 1 ]; then echo "(UI tests skipped)"; exit 0; fi

step "4/5 build image + start server"
"$CT" build -q -t homejack:test . >/dev/null
"$CT" rm -f homejack-test >/dev/null 2>&1 || true
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
"$CT" run -d --name homejack-test --network host -e PORT=$PORT -v "$ROOT/test/.music-fixture":/app/music:ro,Z \
  -e RUMPUS_DEBUG=1 -e RUMPUS_ANSWER_MS=20000 -e RUMPUS_VOTE_MS=8000 -e RUMPUS_RESULTS_MS=5000 -e RUMPUS_REVEAL_MS=2000 \
  homejack:test >/dev/null
trap '"$CT" rm -f homejack-test >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do curl -sf "http://localhost:$PORT/api/info" >/dev/null && break; sleep 0.5; done
echo "test server music: $(curl -s "http://localhost:$PORT/api/music")"

step "5/5 browser tests (TV + 3 phones)"
mkdir -p "$ROOT/test/ui/.shots"
"$CT" run --rm --network host -e BASE_URL="http://localhost:$PORT" -e SHOTS=/shots \
  -v "$ROOT/test/ui":/tests:ro,Z -v "$ROOT/test/ui/.shots":/shots:Z -v homejack-pw:/pw "$PW_IMG" sh -c '
  cd /pw && [ -d node_modules/playwright ] || npm i -s playwright@1.49.1 >/dev/null 2>&1; cp /tests/run.js /pw/run.js && node /pw/run.js'

printf '\n\033[1;32mALL TESTS PASSED\033[0m\n'
