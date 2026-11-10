#!/usr/bin/env bash
# Join bot phones to a running room: ./scripts/bots.sh CODE [count=4] [speed=1] [url=http://localhost:8012]
# Node isn't needed on the host — runs in the same node container the tests use.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CT=$(command -v podman || command -v docker)
exec "$CT" run --rm -it --network host -v "$ROOT":/src:ro,Z -v homejack-npm:/root/.npm docker.io/library/node:20-alpine sh -c "
  cp -r /src /app && cd /app && rm -rf node_modules && npm install --silent --no-audit --no-fund >/dev/null && node tools/bots.js $*"
