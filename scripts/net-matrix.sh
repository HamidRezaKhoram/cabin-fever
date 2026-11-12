#!/usr/bin/env bash
# Live check of the website version across networks (needs internet; not part of test-all.sh):
# the TV and a phone run in separate containers, first on the SAME podman network (like one Wi-Fi),
# then on DIFFERENT networks (like Ethernet vs a guest Wi-Fi). Prints whether the phone got in, and
# whether a relay (TURN) is available — without one, different networks can't connect.
#   scripts/net-matrix.sh [base-url]     (default: the live GitHub Pages site)
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=${1:-https://hamidrezakhoram.github.io/cabin-fever/}
PW=mcr.microsoft.com/playwright:v1.49.1-noble
W=$(mktemp -d)
cp test/net-matrix/role.js "$W/"
podman network create cf-net-a >/dev/null 2>&1 || true
podman network create cf-net-b >/dev/null 2>&1 || true
podman run --rm -v "$W":/w:z -w /w "$PW" sh -c 'npm i -s playwright@1.49.1 >/dev/null 2>&1'
run() { podman run --rm --network "$1" -e BASE="$BASE" -v "$W":/w:z -w /w "$PW" node role.js "${@:2}"; }
for pair in "cf-net-a cf-net-a same-network" "cf-net-a cf-net-b different-networks"; do
  set -- $pair
  run "$1" tv > "$W/tv.out" 2>&1 &
  for _ in $(seq 60); do grep -q '^ROOM' "$W/tv.out" 2>/dev/null && break; sleep 2; done
  code=$(sed -n 's/^ROOM //p' "$W/tv.out")
  printf '%-20s ' "$3:"; run "$2" phone "$code" | head -1
  wait
done
printf '%-20s ' "relay (TURN):"; run cf-net-b relay
rm -rf "$W"
