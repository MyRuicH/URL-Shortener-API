FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node main.js openapi.yaml ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node
CMD ["node", "main.js"]
