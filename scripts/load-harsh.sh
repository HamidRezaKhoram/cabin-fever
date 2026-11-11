#!/usr/bin/env bash
# Harsh load runs on top of the normal one in test/unit/load.test.js (which test-all.sh runs):
#   1. bad Wi-Fi — 15 ms ± 10 ms each way and 1% packet loss (tc netem, inside the container)
#   2. starved server — the server alone gets 1/4 of a CPU core (the phones get the rest)
# Each prints its numbers and enforces looser budgets. Not part of test-all.sh: it takes ~2 min.
# Note on (2): container CPU limits come in 100 ms slices, so a throttled server pauses up to
# ~75 ms at a time — rougher than a steadily slow machine like a Raspberry Pi.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CT=$(command -v podman || command -v docker)
NODE_IMG=docker.io/library/node:20-alpine
PORT=${LOAD_PORT:-18777}

step() { printf '\n\033[1;33m== %s ==\033[0m\n' "$*"; }
"$CT" volume create cabin-fever-load-nm >/dev/null 2>&1 || true
run_node() { "$CT" run --rm -v "$ROOT":/app:Z -v cabin-fever-load-nm:/app/node_modules -w /app "$@"; }
run_node "$NODE_IMG" sh -c '[ -d node_modules/socket.io-client ] || npm install --silent --no-audit --no-fund >/dev/null'

step "normal"
run_node -e LOAD_REPORT=1 "$NODE_IMG" node --test --test-reporter=tap test/unit/load.test.js | grep -E '^# (\\# load|pass|fail)|^not ok|error:'

step "bad Wi-Fi: 15±10 ms each way, 1% loss"
run_node --cap-add NET_ADMIN -e LOAD_REPORT=1 -e LOAD_SLACK_MS=120 "$NODE_IMG" sh -c '
  apk add -q iproute2-tc >/dev/null 2>&1 && tc qdisc add dev lo root netem delay 15ms 10ms distribution normal loss 1% &&
  node --test --test-reporter=tap test/unit/load.test.js' | grep -E '^# (\\# load|pass|fail)|^not ok|error:'

step "starved server: 0.25 CPU"
fail=0
starved() { # $1 test name, then the server's env
  local name=$1; shift
  local envs=(); for e in "$@"; do envs+=(-e "$e"); done
  local cid
  cid=$("$CT" run -d --rm --cpus=0.25 --network=host -e PORT="$PORT" -e RUMPUS_DEBUG=1 -e RUMPUS_DATA_DIR=/tmp/d \
    -e RUMPUS_CONTENT_DIR=/nonexistent -e RUMPUS_MUSIC_DIR=/nonexistent "${envs[@]}" \
    -v "$ROOT":/app:ro,Z -v cabin-fever-load-nm:/app/node_modules -w /app "$NODE_IMG" node server.js)
  for _ in $(seq 40); do curl -sf "localhost:$PORT/api/info" >/dev/null && break; sleep 0.25; done
  run_node --network=host -e LOAD_REPORT=1 -e LOAD_SLACK_MS=120 -e LOAD_MIN_FPS=24 -e LOAD_SERVER_URL="http://127.0.0.1:$PORT" "$NODE_IMG" \
    node --test --test-reporter=tap --test-name-pattern="$name" test/unit/load.test.js | grep -E '^# (\\# load|pass|fail)|^not ok|error:' || fail=1
  "$CT" stop -t 1 "$cid" >/dev/null
}
starved "tap storm" RUMPUS_TRIVIA_ROUNDS=8 RUMPUS_TRIVIA_QUESTION_MS=1500 RUMPUS_TRIVIA_REVEAL_MS=300
starved "real-time" RUMPUS_LL_ORDER=tag RUMPUS_LL_INTRO_MS=300 RUMPUS_LL_PLAY_MS=8000
starved "reconnect storm" RUMPUS_TRIVIA_ROUNDS=4 RUMPUS_TRIVIA_QUESTION_MS=2500 RUMPUS_TRIVIA_REVEAL_MS=300
exit $fail
