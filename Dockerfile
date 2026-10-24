FROM node:20-alpine AS builder
WORKDIR /app
# Retry dropped registry connections (ECONNRESET) instead of failing the deployment.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
# The runtime stage reuses these packages (without the build-only ones) instead of
# downloading everything a second time.
RUN npm prune --omit=dev && npm cache clean --force

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/tsconfig.json ./tsconfig.json
ENV PAYLOAD_CONFIG_PATH=/app/dist/payload.config.js
ENV NODE_ENV=production
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server.js"]
