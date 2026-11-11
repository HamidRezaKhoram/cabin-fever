# The narrator's natural voice (Kokoro-82M, Apache-2.0): downloaded once while building the image,
# so the running container stays fully offline. Full precision (fp32): the server runs it natively
# (core/voice.js), ~3× faster than real time — a line starts in well under a second.
FROM node:20-slim AS voice
WORKDIR /v
COPY tools/fetch-kokoro.js tools/fetch-kokoro.js
RUN npm init -y >/dev/null && npm install --no-audit --no-fund --silent kokoro-js@1.2.1 onnxruntime-web@1.22.0-dev.20250409-89f8206ba4 >/dev/null \
 && node tools/fetch-kokoro.js /tts --dtype fp32

# Debian (not Alpine): the native ONNX runtime for the voice needs glibc.
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

# No build step by design — plain JS/HTML/CSS client, nothing to compile.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY core ./core
COPY games ./games
COPY public ./public
COPY content ./content
COPY --from=voice /tts ./tts
# Offline narrator voice for the TV (/api/tts); openssl makes the https certificate for tilt controls.
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng openssl && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data /app/music && chown node:node /app/data /app/music

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
