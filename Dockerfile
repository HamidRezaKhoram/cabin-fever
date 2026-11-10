# The narrator's natural voice (Kokoro-82M, Apache-2.0): downloaded once while building the image,
# so the running container stays fully offline.
FROM node:20-alpine AS voice
WORKDIR /v
COPY tools/fetch-kokoro.js tools/fetch-kokoro.js
RUN npm init -y >/dev/null && npm install --no-audit --no-fund --silent kokoro-js@1.2.1 onnxruntime-web@1.22.0-dev.20250409-89f8206ba4 >/dev/null \
 && node tools/fetch-kokoro.js /tts

FROM node:20-alpine

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
RUN apk add --no-cache espeak-ng openssl
RUN mkdir -p /app/data /app/music && chown node:node /app/data /app/music

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/info >/dev/null || exit 1

CMD ["node", "server.js"]
