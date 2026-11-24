FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node main.js db.js healthcheck.js openapi.yaml ./
COPY --chown=node:node src ./src

USER node
CMD ["node", "main.js"]
