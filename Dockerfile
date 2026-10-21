FROM node:22-slim

WORKDIR /app

# Dependencies first so the layer caches.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server/ ./server/
COPY public/ ./public/
COPY content/ ./content/
COPY assets/ ./assets/

ENV NODE_ENV=production
ENV PORT=3000
ENV ORATOR_DATA_DIR=/app/data
RUN mkdir -p /app/data /app/assets/generated

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
