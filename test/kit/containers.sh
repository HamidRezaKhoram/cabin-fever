#!/usr/bin/env bash
# Test kit — run Node / Playwright in containers, so the host needs only podman or docker.
# No project knowledge: copy into any project, then in a script:
#   source test/kit/containers.sh
#   in_node myproj 'npm test'                                   # repo copied in read-only, node_modules cached
#   in_node myproj 'node build.js /out' -e FOO=1 -v "$PWD/out":/out:Z   # extra args go to `run`
#   in_playwright myproj test/ui 'node /pw/ui/run.js' --network host  # that folder + test/kit under /pw
# Mounts use the shared SELinux label (:z, not :Z): a private label would cut off other containers
# already using these files (e.g. the test server reading a fixture from the repo).
# node_modules lives in a volume named after the lockfile, so `npm install` runs only when the lockfile
# changes. Old volumes: `podman volume ls | grep -- -nm-` and remove them now and then.
CT=${CT:-$(command -v podman || command -v docker)}
KIT_NODE_IMG=${KIT_NODE_IMG:-docker.io/library/node:20-alpine}
KIT_PW_VERSION=${KIT_PW_VERSION:-1.49.1}
KIT_PW_IMG=${KIT_PW_IMG:-mcr.microsoft.com/playwright:v$KIT_PW_VERSION-noble}

# in_node <name> <shell command> [container run args…]: runs in /app, a copy of the repo (the source itself stays read-only).
in_node() {
  local name=$1 cmd=$2 lock; shift 2
  lock=$( (cat package-lock.json package.json 2>/dev/null || true) | sha1sum | cut -c1-12)
  "$CT" run --rm "$@" -v "$PWD":/src:ro,z -v "$name-nm-$lock":/app/node_modules -v "$name-npm":/root/.npm \
    "$KIT_NODE_IMG" sh -c '
    cd /src && tar --exclude=./node_modules --exclude=./.git -cf - . | tar -xf - -C /app && cd /app &&
    { [ -f node_modules/.kit-ok ] || { npm install --silent --no-audit --no-fund >/dev/null && touch node_modules/.kit-ok; }; } &&
    '"$cmd"
}

# in_playwright <name> <test folder> <shell command> [container run args…]: the folder is copied to /pw/<its name>, test/kit to /pw/kit.
in_playwright() {
  local name=$1 dir=$2 cmd=$3 kit; shift 3
  kit=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  "$CT" run --rm "$@" -v "$PWD/$dir":/tests/"$(basename "$dir")":ro,z -v "$kit":/tests/kit:ro,z -v "$name-pw":/pw \
    "$KIT_PW_IMG" sh -c '
    cd /pw && { [ -d node_modules/playwright ] || npm i -s playwright@'"$KIT_PW_VERSION"' >/dev/null 2>&1; } &&
    rm -rf /pw/kit /pw/'"$(basename "$dir")"' && cp -r /tests/. /pw/ && '"$cmd"
}
