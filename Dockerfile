FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.mjs ./
COPY --chown=node:node scripts/add-empty-categories.mjs scripts/transfer-poomsae.mjs ./scripts/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node csv/ ./csv/
COPY --chown=node:node seed/ ./seed/

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
