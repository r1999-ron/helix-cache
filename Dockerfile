FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_ROOT=/var/lib/helixcache

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /var/lib/helixcache \
    && chown -R node:node /app /var/lib/helixcache

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "src/server.js"]
