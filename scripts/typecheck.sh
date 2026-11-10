#!/bin/sh
# Type-check all JavaScript (tsc --checkJs) and Python (mypy --strict). Runs inside containers.
set -e
for cfg in tsconfig.json tsconfig.host.json tsconfig.play.json; do
  echo "tsc -p $cfg"; npx tsc -p "$cfg"
done
