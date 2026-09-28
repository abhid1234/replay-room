FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./dist/db/migrations
EXPOSE 10000
CMD ["node", "dist/api/server.js"]
