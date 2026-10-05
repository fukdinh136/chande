FROM node:24-alpine AS build
WORKDIR /srv/driver
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /srv/driver
COPY --from=build --chown=node:node /srv/driver/node_modules ./node_modules
COPY --from=build --chown=node:node /srv/driver/dist ./dist
USER node
EXPOSE 3003
CMD ["node", "dist/main.js"]
