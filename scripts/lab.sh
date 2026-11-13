#!/usr/bin/env bash
# Cottage Lab: every game on a simulated mid-range Samsung TV + 3 Samsung phones, measured screen by
# screen against the feel budgets (docs/future-features/feel-plan.md). Writes test/lab/out/report.md.
#   ./scripts/lab.sh                 every game (slow: ~1 h; nightly CI runs it)
#   ./scripts/lab.sh trivia,storm    just these
set -euo pipefail
cd "$(dirname "$0")/.."
source test/kit/containers.sh
PORT=${LAB_PORT:-18013}
"$CT" build -q -t cabin-fever:lab . >/dev/null
"$CT" rm -f cabin-fever-lab >/dev/null 2>&1 || true
"$CT" run -d --name cabin-fever-lab --network host -e PORT=$PORT -e RUMPUS_DEBUG=1 \
  -e RUMPUS_ANSWER_MS=20000 -e RUMPUS_VOTE_MS=10000 -e RUMPUS_RESULTS_MS=5000 -e RUMPUS_REVEAL_MS=4000 cabin-fever:lab >/dev/null
trap '"$CT" rm -f cabin-fever-lab >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/api/info" >/dev/null && break; sleep 0.5; done
mkdir -p test/lab/out
in_playwright cabin-fever test/lab 'node /pw/lab/run.js' --network host -e BASE_URL="http://localhost:$PORT" \
  -e LAB_GAMES="${1:-}" -e LAB_PROFILE="${LAB_PROFILE:-}" -e LAB_NO_NET="${LAB_NO_NET:-}" -e LAB_FLASH="${LAB_FLASH:-}" -e LAB_STRICT="${LAB_STRICT:-}" -e LAB_OUT=/out -v "$PWD/test/lab/out":/out:z
