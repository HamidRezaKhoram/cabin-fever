FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# No build step by design — plain JS/HTML/CSS client, nothing to compile.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY games ./games
COPY public ./public
COPY content ./content
# Offline narrator voice for the TV (/api/tts); openssl makes the https certificate for tilt controls.
RUN apk add --no-cache espeak-ng openssl
RUN mkdir -p /app/data /app/music && chown node:node /app/data /app/music

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/info >/dev/null || exit 1

CMD ["node", "server.js"]
