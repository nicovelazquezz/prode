# Multi-stage build for the Prode frontend (Next.js 15 standalone).
#
# Stages:
#   deps  — install only production+dev deps from the lockfile (cacheable layer)
#   build — compile Next with --webpack (Serwist requires webpack — Phase 8) and
#           inline NEXT_PUBLIC_* values into the client bundle
#   prod  — minimal runtime image: just the standalone server, static assets,
#           and public files. Runs as non-root by default (node user).
#
# NEXT_PUBLIC_* vars are inlined at build time, so they MUST be passed as
# --build-arg in CI/Dokploy. Server-only env (none right now) would go on the
# `prod` stage.

FROM node:22-alpine AS deps
WORKDIR /app
# npm 11 understands the inBundle wasm sub-deps that ship with @rolldown and
# @tailwindcss/oxide-wasm32-wasi; the 10.x bundled with node:22-alpine does not
# and breaks `npm ci` ("Missing: @emnapi/runtime@1.10.0 from lock file").
# node:22-alpine ships npm 10.9.x, but the lockfile uses inBundle wasm deps
# (@rolldown/binding-wasm32-wasi → @emnapi/runtime@1.10.0) that only npm 11
# resolves correctly. Self-upgrade via `npm i -g npm` triggers a known
# "Cannot find module 'promise-retry'" rebuild bug, and `npm-cli.js` ships with
# a bash shebang (alpine has no bash), so we replace the bundled cli files
# in-place with the npm 11 tarball contents — that keeps the existing /usr/bin
# shims pointing at a working binary.
RUN wget -qO /tmp/npm.tgz https://registry.npmjs.org/npm/-/npm-11.6.2.tgz \
  && rm -rf /usr/local/lib/node_modules/npm \
  && mkdir -p /usr/local/lib/node_modules/npm \
  && tar -xzf /tmp/npm.tgz -C /usr/local/lib/node_modules/npm --strip-components=1 \
  && rm /tmp/npm.tgz
COPY package.json package-lock.json ./
RUN npm --version && npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* build args — Next inlines these into the client JS bundle.
# Anything that needs to differ per environment (staging vs prod) MUST be
# passed via --build-arg, not at runtime.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_FRONTEND_URL
ARG NEXT_PUBLIC_WORLD_CUP_START
ARG NEXT_PUBLIC_INSCRIPCION_PRECIO
ARG NEXT_PUBLIC_ADMIN_WHATSAPP
ARG NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=false
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_FRONTEND_URL=$NEXT_PUBLIC_FRONTEND_URL \
    NEXT_PUBLIC_WORLD_CUP_START=$NEXT_PUBLIC_WORLD_CUP_START \
    NEXT_PUBLIC_INSCRIPCION_PRECIO=$NEXT_PUBLIC_INSCRIPCION_PRECIO \
    NEXT_PUBLIC_ADMIN_WHATSAPP=$NEXT_PUBLIC_ADMIN_WHATSAPP \
    NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=$NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production \
    TZ=America/Argentina/Buenos_Aires \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
