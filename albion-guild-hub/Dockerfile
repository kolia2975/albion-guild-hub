FROM node:24-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/ .
COPY --chown=node:node frontend/ ./public/
RUN mkdir -p /app/icon-cache && chown node:node /app/icon-cache
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "src/server.js"]
