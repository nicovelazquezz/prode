# syntax=docker/dockerfile:1.7

# ── Stage 1: deps (full deps for build) ────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ─────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `prisma generate` only needs DATABASE_URL because prisma.config.ts validates env;
# the placeholder is never used to connect — it is a build-time formality.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npx prisma generate && npx nest build

# ── Stage 3: prod ──────────────────────────────────────────
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Argentina/Buenos_Aires

# Install only prod deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

# Prisma CLI is a devDependency, but we need it at runtime to apply
# migrations on container start (see scripts/start.sh). Pull it from
# the build stage rather than reinstalling — keeps the image minimal
# and avoids a second `npm ci`.
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Entrypoint: run `prisma migrate deploy`, then start Nest.
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

# Healthcheck (Docker-level, complements the /health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1))"

EXPOSE 3001
CMD ["./scripts/start.sh"]
