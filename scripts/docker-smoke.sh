#!/usr/bin/env bash
# Start Cabin Fever exactly the way it runs at the cottage — `docker compose up` with compose.yaml's
# mounts and host networking — for both image targets (full, then lite), and check it really works:
# the server answers, the pages load, a room plays a game, and the container is still up 10 s later.
# CI runs this (needs docker + node); locally: ./scripts/docker-smoke.sh (stops your `rumpus` container!).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8012
OVERRIDE=$(mktemp --suffix=.yaml)
dc() { docker compose -f compose.yaml -f "$OVERRIDE" "$@"; }
trap 'dc down >/dev/null 2>&1 || true; rm -f "$OVERRIDE"' EXIT
fail() { echo "✖ $1"; dc logs --tail 50; exit 1; }

for target in full lite; do
  printf 'services:\n  rumpus:\n    build: { target: %s }\n' "$target" > "$OVERRIDE"
  echo "== docker compose ($target) =="
  dc up -d --build --quiet-pull 2>&1 | tail -3
  for _ in $(seq 1 60); do curl -sf "localhost:$PORT/api/info" >/dev/null && break; sleep 1; done
  curl -sf "localhost:$PORT/api/info" >/dev/null || fail "$target: the server never answered on port $PORT"
  for p in /host /play /api/music; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT$p"); [ "$code" = 200 ] || fail "$target: $p answered $code"
  done
  SMOKE_URL="http://localhost:$PORT" node test/smoke.js || fail "$target: a room couldn't play"
  sleep 10
  state=$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' rumpus)
  [ "$state" = "true 0" ] || fail "$target: the container stopped or restarted ($state)"
  echo "✔ $target: $(curl -s "localhost:$PORT/api/info" | head -c 160)"
  dc down >/dev/null
done
