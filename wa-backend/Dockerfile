# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# tzdata para que la variable TZ del compose (America/Argentina/Buenos_Aires)
# se aplique. Sin esto, musl cae en UTC silenciosamente.
RUN apk add --no-cache tzdata
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/src/main.js"]
