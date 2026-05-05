#!/bin/sh
# Container entrypoint: apply pending Prisma migrations, then start Nest.
# `migrate deploy` is idempotent — re-running it on every boot is safe and
# guarantees the schema matches the deployed binary before traffic arrives.
set -e

echo "[start] running prisma migrate deploy..."
npx prisma migrate deploy

echo "[start] launching nest app..."
exec node dist/src/main.js
