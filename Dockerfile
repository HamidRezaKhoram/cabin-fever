# Two images from one file (todo 2.5):
#   default (`full`): the server makes the narrator's natural voice natively (fp32 model + native
#                     ONNX runtime) — ~1.4 GB image, ~1 GB memory while the voice is loaded
#   `--target lite`:  no voice on the server; the TV's browser runs it from /tts (the small uint8
#                     model, no native runtime) — for a small machine like a Raspberry Pi
# Both download the voice once while building, so the running container stays fully offline.

# Kokoro-82M (Apache-2.0) + the browser runtime files.
FROM node:20-slim AS fetch
WORKDIR /v
COPY tools/fetch-kokoro.js tools/fetch-kokoro.js
RUN npm init -y >/dev/null && npm install --no-audit --no-fund --silent kokoro-js@1.2.1 onnxruntime-web@1.22.0-dev.20250409-89f8206ba4 >/dev/null
# Full precision: the server runs it natively, ~3× faster than real time.
FROM fetch AS voice
RUN node tools/fetch-kokoro.js /tts --dtype fp32
# uint8: what a browser runs fastest (WebAssembly).
FROM fetch AS voice-lite
RUN node tools/fetch-kokoro.js /tts --dtype uint8

# Debian (not Alpine): the native ONNX runtime for the voice needs glibc.
FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production
# Offline narrator voice for the TV (/api/tts); openssl makes the https certificate for tilt controls.
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng openssl && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data /app/music && chown node:node /app/data /app/music
COPY package.json package-lock.json* ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]

# Lite: the browser model only, and no native runtime, removed in the same layer it is installed
# in so the image really shrinks (only core/voice-worker.mjs loads it, and RUMPUS_SERVER_VOICE=0
# means that worker never starts). No build step by design — plain JS/HTML/CSS client.
FROM base AS lite
RUN npm install --omit=dev && npm cache clean --force && rm -rf node_modules/onnxruntime-node
COPY server.js ./
COPY core ./core
COPY games ./games
COPY public ./public
COPY content ./content
COPY --from=voice-lite /tts ./tts
ENV RUMPUS_SERVER_VOICE=0
USER node

# Full (the default: last stage).
FROM base AS full
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY core ./core
COPY games ./games
COPY public ./public
COPY content ./content
COPY --from=voice /tts ./tts
USER node
