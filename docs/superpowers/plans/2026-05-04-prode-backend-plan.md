# Prode Backend — Plan de implementación

> **For Claude:** Use executing-plans skill to implement this plan task-by-task. Reference `docs/superpowers/specs/2026-05-04-prode-backend-design.md` for full design detail; this plan instructs *how* to build it, the spec is the *what*.

## Remember
- Exact file paths always
- Complete code for non-obvious logic; reference spec for code that's already there
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits (1 commit per task minimum, 1 per phase mandatory)
- All paths relative to `/Users/nicolasvelazquez/Desktop/dev/prode/` unless stated otherwise
- Backend code lives in `backend/`

## Overview

Backend NestJS para el Prode Mundial 2026 del Club Tiro Federal. Sistema de pronósticos con flujo público de pago vía MercadoPago, panel admin completo, scoring automático, leaderboard con materialized view, mini-ligas, notificaciones WhatsApp, auditoría completa.

**Spec de referencia (autoridad):** `docs/superpowers/specs/2026-05-04-prode-backend-design.md`

**Stack:** NestJS 11 + Prisma 7 (ESM, driver-adapter) + PostgreSQL 16 + Redis 7 + BullMQ 5 + JWT + bcrypt + Pino + Sentry.

## Prerequisites

Antes de empezar, validar que el entorno tiene:
- [ ] Node.js 22 LTS instalado (`node -v` ≥ 20.19)
- [ ] pnpm 9+ instalado (`pnpm -v`)
- [ ] Docker Desktop corriendo (`docker info`)
- [ ] Git configurado con acceso al repo (ya hecho — origin = github.com/nicovelazquezz/prode)
- [ ] Cuenta MercadoPago de prueba con credenciales (TEST-*)
- [ ] Cuenta de Sentry creada con un proyecto "prode-backend"
- [ ] Backend WhatsApp existente accesible (URL + token)
- [ ] Email SMTP / API (Resend, SES, etc.) credenciales

## Estructura del plan

14 fases ordenadas por dependencias. Cada fase es un PR y termina con un commit. Las tareas dentro de cada fase se ejecutan en orden estricto (cada una depende de la anterior).

| Fase | Nombre | Tareas | Output verificable |
|------|--------|--------|---------------------|
| 1 | Foundation | 8 | App levanta, /health responde, DB+Redis conectados |
| 2 | Schema + seeds + audit infra | 7 | Schema migrado, seeds cargados, audit interceptor ready |
| 3 | Auth core | 9 | Admin puede login, refresh, recovery por WhatsApp |
| 4 | Notifications + Admin alerts | 6 | WhatsApp/email funcionan; admin recibe alertas de prueba |
| 5 | Public payment flow | 10 | E2E con mock provider: paga → completa → loguea |
| 6 | Match management | 5 | Admin maneja matches; auto-lock funciona |
| 7 | Predictions | 7 | Usuario predice partidos + especiales; locks server-side |
| 8 | Scoring + Match progression | 9 | Admin carga resultado → puntos calculados → fase cierra |
| 9 | Leaderboard | 5 | MV refresca async; rankings global/fase/liga consultables |
| 10 | Mini-leagues | 4 | Crear, unirse, ver ranking |
| 11 | Crons + delayed jobs | 5 | Recordatorios, orphan cleanup, daily summary |
| 12 | Hardening | 6 | Rate limiting, CORS, helmet, Turnstile, Sentry |
| 13 | E2E test suite | 5 | 5 flujos E2E pasando en CI |
| 14 | Deployment | 4 | Dockerfile + Dokploy config; deploy a staging |

**Total estimado: ~90 tareas atómicas.**

---

# FASE 1 — Foundation

**Goal:** repo backend inicializado, NestJS levantando, Prisma 7 conectado a Postgres, Redis conectado, healthcheck respondiendo. Sin lógica de dominio aún.

## Task 1.1 — Inicializar `backend/` con pnpm + ESM

**Files:** `backend/package.json`, `backend/.gitignore`, `backend/.npmrc`

**Acceptance:**
- `cd backend && pnpm init` creó `package.json`
- Editado para incluir `"type": "module"` (ESM obligatorio para Prisma 7)
- `pnpm-lock.yaml` no se commitea aún (sin deps todavía)
- `.npmrc` con `engine-strict=true`

**Verification:**
```bash
cd backend && cat package.json | grep '"type"'
# Expected: "type": "module"
```

**Commit:** `chore(backend): init pnpm workspace with ESM`

---

## Task 1.2 — TypeScript ESM config

**Files:** `backend/tsconfig.json`, `backend/tsconfig.build.json`

**Content of `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2023",
    "lib": ["ES2023"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "incremental": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*", "prisma.config.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

**Content of `tsconfig.build.json`:**
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

**Acceptance:**
- `tsconfig.json` usa `NodeNext` (no `bundler` ni `commonjs`)
- Target ES2023
- Strict mode

**Verification:**
```bash
cd backend && npx -y typescript@5.7 --noEmit -p tsconfig.json 2>&1 | head -3
# Expected: silent (no source files yet) o "no inputs were found" (OK por ahora)
```

**Commit:** `chore(backend): add TS ESM config (NodeNext, strict, ES2023)`

---

## Task 1.3 — Instalar deps de NestJS + core

**Files:** `backend/package.json` (deps)

```bash
cd backend && pnpm add \
  @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 \
  @nestjs/config@^4 \
  reflect-metadata rxjs \
  zod
```

```bash
cd backend && pnpm add -D \
  @nestjs/cli@^11 @nestjs/testing@^11 \
  @types/node@^22 @types/express \
  typescript@^5.7 \
  ts-node@^10 ts-loader \
  jest@^29 ts-jest @types/jest \
  supertest @types/supertest \
  prettier eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**Acceptance:**
- Deps en `package.json` con versiones exactas
- `pnpm install` corre sin errores
- `node_modules/` ignorado por gitignore (ya está en `.gitignore` raíz)

**Verification:**
```bash
cd backend && node -e "import('@nestjs/core').then(m => console.log('OK', !!m.NestFactory))"
# Expected: OK true
```

**Commit:** `chore(backend): add NestJS 11 + Zod + dev deps`

---

## Task 1.4 — Bootstrap mínimo de NestJS

**Files:** `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/app.controller.ts`

**`main.ts`:**
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // necesario para verificación de firma MP
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Backend corriendo en :${port}`);
}

bootstrap();
```

**`app.module.ts`:**
```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';

@Module({
  imports: [],
  controllers: [AppController],
})
export class AppModule {}
```

**`app.controller.ts`:**
```typescript
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

**Test:** `backend/src/app.controller.spec.ts`
```typescript
import { Test } from '@nestjs/testing';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  let controller: AppController;
  beforeEach(async () => {
    const ref = await Test.createTestingModule({ controllers: [AppController] }).compile();
    controller = ref.get(AppController);
  });

  it('GET /health responds 200 with status ok', () => {
    const res = controller.health();
    expect(res.status).toBe('ok');
    expect(typeof res.timestamp).toBe('string');
  });
});
```

**Acceptance:**
- `pnpm exec nest start --watch` levanta el server sin errores
- `curl localhost:3001/health` devuelve `{"status":"ok",...}`
- Test pasa

**Verification:**
```bash
cd backend && pnpm exec jest app.controller.spec.ts
# Expected: 1 passing
```

**Commit:** `feat(backend): bootstrap NestJS app with /health endpoint`

---

## Task 1.5 — Docker Compose para Postgres + Redis (dev local)

**Files:** `docker-compose.yml` (en raíz del repo)

**Content:**
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: prode-postgres
    environment:
      POSTGRES_USER: prode
      POSTGRES_PASSWORD: prode_dev_pwd
      POSTGRES_DB: prode
      TZ: America/Argentina/Buenos_Aires
    ports:
      - '5432:5432'
    volumes:
      - prode_pg:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U prode']
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: prode-redis
    ports:
      - '6379:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  prode_pg:
```

**Acceptance:**
- `docker compose up -d` arranca ambos containers
- `docker compose ps` muestra ambos como `healthy`

**Verification:**
```bash
docker compose up -d && sleep 8 && docker compose ps
# Expected: prode-postgres healthy, prode-redis healthy
```

**Commit:** `chore: add docker-compose with postgres 16 + redis 7`

---

## Task 1.6 — Env validation con Zod

**Files:** `backend/src/config/env.ts`, `backend/.env.example`, `backend/.env` (no commiteado)

**`env.ts`:**
```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  MP_ACCESS_TOKEN: z.string().min(1),
  MP_PUBLIC_KEY: z.string().min(1),
  MP_WEBHOOK_SECRET: z.string().min(1),

  WHATSAPP_API_URL: z.string().url(),
  WHATSAPP_API_TOKEN: z.string().min(1),
  ADMIN_WHATSAPP_NUMBER: z.string().regex(/^\d{10,15}$/),

  EMAIL_FROM: z.string().email(),
  RESEND_API_KEY: z.string().min(1).optional(),

  FRONTEND_URL: z.string().url(),
  API_URL: z.string().url(),

  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid env vars:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
```

**`.env.example`:**
```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://prode:prode_dev_pwd@localhost:5432/prode
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change_me_to_a_long_random_string_at_least_32_chars
JWT_REFRESH_SECRET=change_me_to_a_long_random_string_at_least_32_chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
MP_ACCESS_TOKEN=TEST-...
MP_PUBLIC_KEY=TEST-...
MP_WEBHOOK_SECRET=...
WHATSAPP_API_URL=https://your-whatsapp-backend.com
WHATSAPP_API_TOKEN=...
ADMIN_WHATSAPP_NUMBER=5492914xxxxxxx
EMAIL_FROM=prode@tirofederal.com
RESEND_API_KEY=
FRONTEND_URL=http://localhost:3000
API_URL=http://localhost:3001
TURNSTILE_SECRET_KEY=
SENTRY_DSN=
```

**Test:** `backend/src/config/env.spec.ts`
- Mock `process.env`, llamar `loadEnv()`, esperar `Env` correcto
- Caso inválido: falta `DATABASE_URL` → debe llamar `process.exit`. Mockear `process.exit`.

**Acceptance:**
- Falla rápido en startup si falta variable
- `.env.example` está completo
- `.env` está en `.gitignore` (ya está)

**Verification:**
```bash
cd backend && pnpm exec jest env.spec.ts
# Expected: 2 passing
```

**Commit:** `feat(backend): add Zod env validation`

---

## Task 1.7 — Prisma 7 setup + driver adapter + config file

**Files:**
- `backend/package.json` (add deps)
- `backend/prisma/schema.prisma` (skeleton)
- `backend/prisma.config.ts`

**Install:**
```bash
cd backend && pnpm add @prisma/client@^7 @prisma/adapter-pg pg dotenv
cd backend && pnpm add -D prisma@^7 @types/pg
```

**`prisma/schema.prisma`** (mínimo para inicializar):
```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**`prisma.config.ts`:**
```typescript
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

**Acceptance:**
- `pnpm exec prisma generate` corre sin error y genera cliente en `backend/generated/prisma/`
- `generated/` está en `.gitignore`

**Verification:**
```bash
cd backend && pnpm exec prisma generate 2>&1 | tail -3
# Expected: Generated Prisma Client (v7.x.x) to ./generated/prisma
ls backend/generated/prisma/index.d.ts
# Expected: archivo existe
```

**Commit:** `chore(backend): install Prisma 7 with adapter-pg + config`

---

## Task 1.8 — PrismaService con driver adapter + healthcheck DB

**Files:**
- `backend/src/shared/prisma/prisma.service.ts`
- `backend/src/shared/prisma/prisma.module.ts`
- `backend/src/app.controller.ts` (update healthcheck)

**`prisma.service.ts`:**
```typescript
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client.js';
import { loadEnv } from '../../config/env.js';

const env = loadEnv();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    super({ adapter, log: ['warn', 'error'] });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Postgres connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
```

**`prisma.module.ts`:**
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**Update `app.module.ts`:**
```typescript
imports: [PrismaModule],
```

**Update `app.controller.ts`:**
```typescript
constructor(private readonly prisma: PrismaService) {}

@Get('health')
async health() {
  const dbOk = await this.prisma.ping();
  return {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    timestamp: new Date().toISOString(),
  };
}
```

**Acceptance:**
- App levanta y se conecta a Postgres
- `curl localhost:3001/health` devuelve `{"status":"ok","db":true,...}`

**Verification:**
```bash
cd backend && docker compose -f ../docker-compose.yml ps  # postgres healthy
cd backend && pnpm exec nest start &  # background
sleep 4 && curl -s localhost:3001/health
# Expected: {"status":"ok","db":true,...}
kill %1
```

**Commit:** `feat(backend): wire Prisma 7 with driver adapter + DB healthcheck`

**End of Phase 1 — verifica:**
```bash
cd backend && pnpm exec jest && pnpm exec nest start &
sleep 5 && curl -s localhost:3001/health | grep '"db":true'
kill %1
```
**Phase 1 commit (squash si querés):** `feat(backend): foundation — NestJS+Prisma7+Postgres+Redis ready`

---

# FASE 2 — Schema completo + Seeds + Audit infra

**Goal:** schema Prisma completo migrado, materialized view creada, seeds cargados (48 teams, 104 matches, scoring rules, admin user), AuditLog interceptor listo para uso transversal.

## Task 2.1 — Schema Prisma completo

**Files:** `backend/prisma/schema.prisma`

**Action:** copiar EL SCHEMA COMPLETO desde `docs/superpowers/specs/2026-05-04-prode-backend-design.md` sección **5.2 Schema Prisma completo**, asegurando:
- Generator `prisma-client` con `output = "../generated/prisma"`
- Todos los enums incluyendo `PrizeStatus`, `OutcomeType`, `NotificationType`, etc.
- Todos los modelos: User, RefreshToken, PasswordReset, Team, Player, Match, ScoringRule, PhaseMultiplier, SpecialPrizeRule, Prediction, SpecialPrediction, PhaseWinner, Payment, League, LeagueMembership, Notification, AppConfig, AuditLog
- `tokenHash` en RefreshToken/PasswordReset, `completionTokenHash` en Payment
- `@@index` en columnas frecuentemente queried (lista en spec sección 5.5)

**Acceptance:**
- `pnpm exec prisma format` no cambia el archivo (formato correcto)
- `pnpm exec prisma validate` pasa

**Verification:**
```bash
cd backend && pnpm exec prisma validate && pnpm exec prisma format --check
# Expected: ✔ Schema is valid; (no output del format)
```

**Commit:** `feat(backend): add complete Prisma schema for prode domain`

---

## Task 2.2 — Migración inicial

**Files:** `backend/prisma/migrations/<timestamp>_init/migration.sql`

**Action:**
```bash
cd backend && pnpm exec prisma migrate dev --name init
```

**Acceptance:**
- Migración generada y aplicada a la BD local
- `\dt` en `psql` muestra todas las tablas

**Verification:**
```bash
cd backend && PGPASSWORD=prode_dev_pwd psql -h localhost -U prode -d prode -c "\dt" | grep users
# Expected: public | users | table | prode
```

**Commit:** `feat(backend): initial migration for prode schema`

---

## Task 2.3 — Migración separada para Materialized View `leaderboard_global`

**Files:** `backend/prisma/migrations/<timestamp>_leaderboard_view/migration.sql`

**Action:**
```bash
cd backend && pnpm exec prisma migrate dev --create-only --name leaderboard_view
```

Editá el SQL generado (vacío) y pegale el contenido del spec sección **5.4 Materialized view de leaderboard**:

```sql
CREATE MATERIALIZED VIEW leaderboard_global AS
SELECT
  u.id AS user_id,
  u.first_name,
  u.last_name,
  COALESCE(SUM(p.points_earned), 0) +
    COALESCE(sp.total_points, 0) AS total_points,
  COUNT(p.id) FILTER (WHERE p.outcome_type = 'EXACT') AS exact_count,
  COUNT(p.id) FILTER (WHERE p.outcome_type IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT')) AS hits_count,
  sp.champion_team_id IS NOT NULL AS has_champion_pick
FROM users u
LEFT JOIN predictions p ON p.user_id = u.id
LEFT JOIN special_predictions sp ON sp.user_id = u.id
WHERE u.status = 'ACTIVE'
GROUP BY u.id, u.first_name, u.last_name, sp.total_points, sp.champion_team_id;

CREATE UNIQUE INDEX leaderboard_global_user_id_idx ON leaderboard_global (user_id);
CREATE INDEX leaderboard_global_total_points_idx
  ON leaderboard_global (total_points DESC, exact_count DESC, hits_count DESC);
```

Aplicar:
```bash
cd backend && pnpm exec prisma migrate dev
```

**Acceptance:**
- MV existe en la BD
- Tiene los 2 índices

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -U prode -d prode -c "\d leaderboard_global" | head -10
# Expected: muestra Materialized view "public.leaderboard_global"
```

**Commit:** `feat(backend): add leaderboard_global materialized view`

---

## Task 2.4 — Seed de teams (48 selecciones)

**Files:** `backend/prisma/seed-teams.ts`, `backend/prisma/data/teams.json`

**`teams.json`:** 48 entradas con `fifaCode`, `name`, `shortName`, `flagUrl`, `confederation`, `groupCode` (cuando se conozca el sorteo de 2026; si aún no, dejar `null`). Para no inventar, usar la lista oficial FIFA del Mundial 2026 al momento de seedear.

Estructura ejemplo:
```json
[
  { "fifaCode": "ARG", "name": "Argentina", "shortName": "ARG", "flagUrl": "https://flagcdn.com/ar.svg", "confederation": "CONMEBOL", "groupCode": null, "fifaRanking": 1 },
  ...
]
```

**`seed-teams.ts`:**
```typescript
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import teams from './data/teams.json' with { type: 'json' };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const t of teams) {
    await prisma.team.upsert({
      where: { fifaCode: t.fifaCode },
      update: t,
      create: t,
    });
  }
  console.log(`Seeded ${teams.length} teams`);
}

main().finally(() => prisma.$disconnect());
```

**Run:**
```bash
cd backend && pnpm exec tsx prisma/seed-teams.ts
```

**Acceptance:**
- Tabla `teams` tiene 48 filas
- Re-correr el script no duplica (upsert)

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -U prode -d prode -c "SELECT COUNT(*) FROM teams"
# Expected: 48
```

**Commit:** `feat(backend): seed 48 World Cup 2026 teams`

---

## Task 2.5 — Seed de matches (104 partidos)

**Files:** `backend/prisma/seed-matches.ts`, `backend/prisma/data/matches.json`

**`matches.json`:** 104 entradas con `matchNumber`, `phase`, `groupCode`, `homeTeamLabel`, `awayTeamLabel`, `kickoffAt` (ISO UTC), `predictionsLockAt` (kickoff - 10min), `venue`, `city`, `country`. Para los 72 de grupos, los `homeTeamId/awayTeamId` se setean cuando el sorteo esté hecho; el seed inicial puede dejarlos null y solo poblar labels.

**`seed-matches.ts`:** análogo a teams; upsert por `matchNumber`.

**Acceptance:**
- 104 filas en `matches`
- Phase distribution correcta: 72 GROUPS, 16 ROUND_32, 8 ROUND_16, 4 QUARTERS, 2 SEMIS, 1 THIRD_PLACE, 1 FINAL

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -U prode -d prode \
  -c "SELECT phase, COUNT(*) FROM matches GROUP BY phase ORDER BY phase"
# Expected: GROUPS 72, ROUND_32 16, ROUND_16 8, QUARTERS 4, SEMIS 2, THIRD_PLACE 1, FINAL 1
```

**Commit:** `feat(backend): seed 104 World Cup 2026 matches`

---

## Task 2.6 — Seed de ScoringRule + PhaseMultiplier + SpecialPrizeRule + AppConfig + admin user

**Files:** `backend/prisma/seed-config.ts`

**Default values (del spec):**
- ScoringRule: EXACT=5, WINNER_AND_DIFF=3, DRAW_DIFFERENT=2, WINNER_ONLY=1, MISS=0
- PhaseMultiplier: GROUPS=1, ROUND_32=1.5, ROUND_16=2, QUARTERS=3, SEMIS=4, THIRD_PLACE=4, FINAL=5
- SpecialPrizeRule: champion=25, runnerUp=12, thirdPlace=8, topScorer=15, totalGoalsExact=10, totalGoalsClose=5
- AppConfig: `inscripcion_precio=15000`, `inscripcion_cierre=2026-06-11T19:00:00-03:00`, `pozo_dist_top1=0.25`, `pozo_dist_top2=0.12`, `pozo_dist_top3=0.08`, `pozo_dist_fase=0.05`, `pozo_club=0.20`, `pozo_reserva=0.05`
- Admin user: leído de env `ADMIN_DEFAULT_DNI` y `ADMIN_DEFAULT_PASSWORD` (agregar al schema env), bcrypt hashed

**Acceptance:**
- Todas las reglas default cargadas
- Admin user existe con role=ADMIN, isPaid implícito (existe = pagó)

**Verification:**
```bash
PGPASSWORD=prode_dev_pwd psql -h localhost -U prode -d prode \
  -c "SELECT outcome_type, base_points FROM scoring_rules ORDER BY outcome_type"
# Expected: 5 filas
```

**Commit:** `feat(backend): seed scoring rules, phase multipliers, app config, admin user`

---

## Task 2.7 — Audit infrastructure: AuditService + @Audit decorator + Interceptor

**Files:**
- `backend/src/modules/audit/audit.service.ts`
- `backend/src/modules/audit/audit.module.ts`
- `backend/src/common/decorators/audit.decorator.ts`
- `backend/src/common/interceptors/audit.interceptor.ts`

**`audit.decorator.ts`:**
```typescript
import { SetMetadata } from '@nestjs/common';
export const AUDIT_KEY = 'audit';
export interface AuditOptions { action: string; entity: string; entityIdParam?: string; }
export const Audit = (opts: AuditOptions) => SetMetadata(AUDIT_KEY, opts);
```

**`audit.service.ts`:**
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(args: {
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    changes?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: args.userId ?? null,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId ?? null,
        changes: args.changes as Prisma.InputJsonValue | undefined,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      },
    });
  }
}
```

**`audit.interceptor.ts`:** lee metadata `@Audit`, captura request.user (set por JwtAuthGuard luego) y request.ip/headers, ejecuta el handler, luego llama `auditService.log` async (sin await dentro del response).

**Test:** unitario del AuditService con mock PrismaService → verifica que `auditLog.create` se llame con los argumentos correctos.

**Acceptance:**
- Decorator `@Audit({ action: 'X', entity: 'Y' })` aplicable
- Interceptor inserta en `audit_logs` después de cada handler decorado
- Si el handler tira excepción, NO se loggea (solo éxito)

**Verification:**
```bash
cd backend && pnpm exec jest audit.service.spec
# Expected: passing
```

**Commit:** `feat(backend): add Audit infra (service + decorator + interceptor)`

**End of Phase 2.** Commit final: `feat(backend): phase 2 — schema, seeds, audit ready`

---

# FASE 3 — Auth core

**Goal:** módulo de auth funcional. Admin (creado por seed) puede loguear, refresh, recuperar contraseña por WhatsApp. Protección de endpoints con guards.

## Task 3.1 — bcrypt + jwt deps

```bash
cd backend && pnpm add bcrypt jsonwebtoken
cd backend && pnpm add -D @types/bcrypt @types/jsonwebtoken
```

**Commit:** `chore(backend): add bcrypt + jsonwebtoken deps`

---

## Task 3.2 — JwtAuthGuard + RolesGuard + @Public + @Roles + @CurrentUser

**Files:**
- `backend/src/common/guards/jwt-auth.guard.ts`
- `backend/src/common/guards/roles.guard.ts`
- `backend/src/common/decorators/public.decorator.ts`
- `backend/src/common/decorators/roles.decorator.ts`
- `backend/src/common/decorators/current-user.decorator.ts`

**Test:** unit tests de cada guard con `Reflector` mockeado.

**Acceptance:**
- `@Public()` skipea auth
- Sin token → 401
- Token válido → setea `request.user`
- `@Roles('ADMIN')` con user no-admin → 403

**Verification:**
```bash
cd backend && pnpm exec jest guards
# Expected: passing
```

**Commit:** `feat(backend): add JwtAuthGuard, RolesGuard, decorators`

---

## Task 3.3 — AuthService: hash + token utilities

**Files:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.module.ts`

Métodos pure-utility:
- `hashPassword(plain: string): Promise<string>` (bcrypt 12 rounds)
- `comparePassword(plain: string, hash: string): Promise<boolean>`
- `signAccessToken(payload: { sub: string; role: Role }): string`
- `signRefreshToken(payload: { sub: string }): string`
- `verifyAccessToken(token: string): Payload | null`
- `verifyRefreshToken(token: string): Payload | null`
- `hashToken(plain: string): string` → sha256 hex (para `tokenHash` en BD)
- `generatePlainToken(): string` → `randomBytes(32).hex`

**Test:** unit test cada función pura.

**Acceptance:**
- Hash y compare funcionan
- Tokens firmados se verifican; tokens manipulados fallan
- `hashToken` es determinístico

**Verification:**
```bash
cd backend && pnpm exec jest auth.service.spec
```

**Commit:** `feat(backend/auth): add AuthService primitives (hash, JWT, tokens)`

---

## Task 3.4 — POST /auth/login (DNI + password)

**Files:** `backend/src/modules/auth/auth.controller.ts`, `backend/src/modules/auth/dto/login.dto.ts`

**DTO:** class-validator: `dni` (string regex `^\d{7,8}$`), `password` (string min 1)

**Controller:**
```typescript
@Public()
@Post('login')
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
  const user = await this.usersService.findByDni(dto.dni);
  if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
  const ok = await this.authService.comparePassword(dto.password, user.passwordHash);
  if (!ok) throw new UnauthorizedException();

  const accessToken = this.authService.signAccessToken({ sub: user.id, role: user.role });
  const refreshPlain = this.authService.generatePlainToken();
  await this.refreshTokensService.create(user.id, refreshPlain, req.headers, req.ip);

  res.cookie('refresh_token', refreshPlain, {
    httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return { accessToken, user: pickPublic(user) };
}
```

**`RefreshTokensService.create`:** hashea, persiste con expiresAt, userAgent, ipAddress.

**Test:** integration test con BD real (Testcontainers o docker-compose ya levantado): admin del seed puede login.

**Acceptance:**
- Login válido → 200 con accessToken + cookie httpOnly refresh
- Login inválido → 401
- Audit log `auth.login_success` y `auth.login_failed`

**Commit:** `feat(backend/auth): POST /auth/login with JWT + refresh cookie`

---

## Task 3.5 — POST /auth/refresh

**Files:** mismo controller.

Verifica el refresh token de la cookie, busca por `tokenHash` en BD, chequea no revocado y no expirado, emite nuevo access token, **rota el refresh** (revoca el viejo, crea nuevo, lo setea en cookie).

**Test:** integration: con cookie válida → nuevo access; sin cookie → 401; con cookie revocada → 401.

**Acceptance:**
- Rotación de refresh tokens funciona
- Token revocado no permite nuevos refreshes

**Commit:** `feat(backend/auth): POST /auth/refresh with rotation`

---

## Task 3.6 — POST /auth/logout

Invalida el refresh token actual marcando `revokedAt`.

**Commit:** `feat(backend/auth): POST /auth/logout (revokes refresh)`

---

## Task 3.7 — POST /auth/forgot-password (envía link por WhatsApp)

Genera plain token, hashea, persiste en `password_resets` con TTL 30min. Encola WhatsApp al usuario con link `${FRONTEND_URL}/reset?token=${plain}`.

Si DNI no existe: responde 200 igual (no revelar info), pero no crea token.

**Acceptance:**
- Notification WhatsApp creada (verificable en BD `notifications`)
- Token persistido hasheado

**Commit:** `feat(backend/auth): POST /auth/forgot-password via WhatsApp`

---

## Task 3.8 — POST /auth/reset-password

Recibe `{ token, newPassword }`. Hashea token, busca, valida `expiresAt > now()`, `usedAt === null`. Hashea nueva pass, update `User.passwordHash`, marca token `usedAt = now()`. Audit log.

**Commit:** `feat(backend/auth): POST /auth/reset-password`

---

## Task 3.9 — Wiring global: ValidationPipe + JwtAuthGuard global + ExceptionFilters

**Files:** `backend/src/main.ts`, `backend/src/common/filters/global-exception.filter.ts`, `backend/src/common/filters/prisma-exception.filter.ts`

Global setup:
- `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
- `app.useGlobalGuards(new JwtAuthGuard(reflector))`
- `app.useGlobalInterceptors(new AuditInterceptor(...))`
- `app.useGlobalFilters(new PrismaExceptionFilter(), new GlobalExceptionFilter(sentryClient))`

**Acceptance:**
- E2E con supertest: `POST /auth/login` con body inválido → 400 detallado
- Endpoint sin `@Public()` sin token → 401

**Commit:** `feat(backend): wire global validation, guards, filters`

**End of Phase 3.** Commit: `feat(backend): phase 3 — auth complete (login/refresh/recovery)`

---

# FASE 4 — Notifications + Admin alerts

**Goal:** infraestructura de notificaciones (cola BullMQ, outbox, workers WhatsApp/email), AdminAlertsService funcional, smoke test enviando WhatsApp al admin.

## Task 4.1 — Instalar BullMQ + ioredis + nodemailer/resend

```bash
cd backend && pnpm add bullmq ioredis @nestjs/bullmq resend
```

**Commit:** `chore(backend): add BullMQ + ioredis + Resend`

---

## Task 4.2 — RedisModule + BullMQ root setup

**Files:**
- `backend/src/shared/redis/redis.module.ts`
- `backend/src/shared/bullmq/bullmq.module.ts`

`@nestjs/bullmq` con configuración de conexión vía env.

**Acceptance:**
- App levanta con BullMQ root configurado
- `pnpm exec nest start` no tira error de conexión Redis

**Commit:** `feat(backend): RedisModule + BullMQ root config`

---

## Task 4.3 — WhatsappService (wrapper backend existente)

**Files:** `backend/src/shared/whatsapp/whatsapp.service.ts`

Método `send(to, message): Promise<void>` que hace POST al `WHATSAPP_API_URL`. Manejo de errores: tira excepción si HTTP no-2xx.

**Test:** mock `fetch` global, verifica que se llame con los headers/body correctos.

**Commit:** `feat(backend): WhatsappService wrapper`

---

## Task 4.4 — EmailService (Resend)

**Files:** `backend/src/shared/email/email.service.ts`

Método `send({ to, subject, html, text }): Promise<void>` que usa Resend SDK.

**Commit:** `feat(backend): EmailService via Resend`

---

## Task 4.5 — NotificationsService + queue + workers

**Files:**
- `backend/src/modules/notifications/notifications.service.ts` — método `enqueue(notification)` que crea Notification en BD y agrega job
- `backend/src/modules/notifications/notifications.processor.ts` — worker BullMQ que procesa job `send-notification`, lee Notification por id, llama Whatsapp/Email service según `channel`, actualiza status
- `backend/src/modules/notifications/notifications.module.ts`

**Outbox helper:** patrón `runOnCommit(callback)` que usa NestJS event emitter o simple wrapper alrededor de TX que ejecuta el job-add **después** del commit.

**Test:** integration: crea Notification, procesa job (con mocks de Whatsapp/Email), verifica `status=SENT`.

**Acceptance:**
- Job retry 3 veces con backoff exponencial
- `dedupKey` previene duplicados en upsert

**Commit:** `feat(backend/notifications): outbox queue + workers`

---

## Task 4.6 — AdminAlertsService

**Files:** `backend/src/shared/admin-alerts/admin-alerts.service.ts`

Métodos:
- `notify({ type, message })` → crea Notification con `toAddress=ADMIN_WHATSAPP_NUMBER`, `channel=WHATSAPP`, `type=ADMIN_BROADCAST`, `dedupKey` opcional

**Test:** unit con mock NotificationsService.

**Acceptance:**
- Llamar `notify` encola WhatsApp al admin
- Smoke test manual: `pnpm exec ts-node -e "..."` envía un WhatsApp real

**Commit:** `feat(backend): AdminAlertsService for backend critical events`

**End of Phase 4.** Commit: `feat(backend): phase 4 — notifications + admin alerts ready`

---

# FASE 5 — Public payment flow

**Goal:** flujo público end-to-end: usuario inicia pago, paga (mock provider en tests), webhook llega, magic link disponible, completar registro crea User + Payment vinculados, login funciona.

## Task 5.1 — CheckoutProvider interface + types

**Files:** `backend/src/shared/checkout/checkout.types.ts`, `backend/src/shared/checkout/checkout.provider.ts`

Interface tal cual spec sección 6.5.

**Commit:** `feat(backend/checkout): provider-agnostic interface`

---

## Task 5.2 — MockCheckoutProvider (para tests)

**Files:** `backend/src/shared/checkout/mock.provider.ts`

In-memory store de payments, IDs deterministas (`mock_pay_${counter}`), `verifyWebhookSignature` no-op, `getPayment` devuelve lo guardado.

**Commit:** `feat(backend/checkout): MockCheckoutProvider for tests`

---

## Task 5.3 — MercadoPagoCheckoutProvider (producción)

**Files:** `backend/src/shared/checkout/mercadopago.provider.ts`

```bash
cd backend && pnpm add mercadopago
```

Implementa interface usando `mercadopago` SDK v2:
- `createPreference`: crea con `metadata.completion_token`, `back_urls.success`, `payment_methods.excluded_payment_types`
- `getPayment`: consulta por id de MP
- `verifyWebhookSignature`: HMAC-SHA256 sobre manifest `id:DATA_ID;request-id:REQUEST_ID;ts:TS;`, comparación constant-time

**Test:** unit test del verifier con manifest conocido.

**Acceptance:**
- Firma válida pasa, firma alterada falla con `UnauthorizedException`

**Commit:** `feat(backend/checkout): MercadoPagoCheckoutProvider with HMAC verification`

---

## Task 5.4 — POST /payments/init

**Files:** `backend/src/modules/payments/payments.controller.ts`, `backend/src/modules/payments/payments.service.ts`, DTOs

Service:
1. Validar Turnstile token (skip en NODE_ENV=test)
2. Generar `tokenPlain`, hashear
3. Crear Payment con `userId=null`, `status=PENDING`, `completionTokenHash`, `tokenExpiresAt=now+7d`, `method=MERCADOPAGO`, `amount=15000`
4. Llamar `checkoutProvider.createPreference({ metadata: { completion_token: tokenPlain }, back_urls.success: ${FRONTEND_URL}/inscripcion/success?token=${tokenPlain} })`
5. Update Payment con `mpPreferenceId`
6. Devolver `{ paymentId, initPoint }`

**Test:** E2E con MockCheckoutProvider — POST devuelve initPoint.

**Acceptance:**
- Rate limit 5/h por IP (configurar en task 12.1)
- Audit log `payment.init`

**Commit:** `feat(backend/payments): POST /payments/init creates MP preference`

---

## Task 5.5 — POST /payments/webhook con idempotencia y firma

**Files:** mismo controller

Implementación tal cual spec sección 6.5 (con todos los fixes aplicados):
- `@Public()`
- Verifica firma con `req.rawBody` (NestJS configurado con `rawBody: true` en main.ts)
- `updateMany` con `where: { id, status: { in: ['PENDING'] } }` para idempotencia
- Handler de `payer.email` null → AdminAlerts inmediato
- `notification.upsert` con `dedupKey: recovery:${paymentId}`
- Delayed job `admin-orphan-alert` con `delay: 2 * 3600 * 1000` y `jobId: orphan-alert:${paymentId}` para deduplicación

**Test:** E2E:
1. POST /payments/init → recibo paymentId
2. Simular webhook con MockCheckoutProvider y status=approved
3. Verifico Payment en BD: status=APPROVED, payerEmail capturado, Notification creada con dedupKey
4. Reenvío webhook idéntico → no duplica Notification ni delayed job

**Acceptance:**
- Firma inválida → 401
- Idempotencia probada (segundo webhook = no-op)
- Notification con magic link creada

**Commit:** `feat(backend/payments): POST /payments/webhook with idempotency + HMAC`

---

## Task 5.6 — GET /payments/by-token/:token

Resuelve `Payment` desde `token` plano (hashea y busca por `completionTokenHash`). Devuelve estado público (sin info sensible): `{ status, expiresAt, completed: bool }`.

**Acceptance:**
- Token expirado → 410 Gone
- Token completado → 410 Gone con `completed: true`
- Token desconocido → 404
- Token válido pendiente → 200 con info

**Commit:** `feat(backend/payments): GET /payments/by-token/:token`

---

## Task 5.7 — POST /auth/complete-registration

**Files:** `backend/src/modules/auth/auth.controller.ts`

Body DTO: `{ token, dni, firstName, lastName, whatsapp, password }` — todas validadas con class-validator.

Service:
```typescript
async completeRegistration(dto): Promise<{ accessToken, user }> {
  const tokenHash = sha256(dto.token);
  return prisma.$transaction(async tx => {
    const payment = await tx.payment.findUnique({ where: { completionTokenHash: tokenHash } });
    if (!payment) throw new InvalidCompletionTokenException();
    if (payment.status !== 'APPROVED') throw new PaymentNotApprovedException();
    if (payment.completedAt) throw new InvalidCompletionTokenException();
    if (payment.tokenExpiresAt! < new Date()) throw new InvalidCompletionTokenException();

    // Validar duplicados — manejados por unique constraint pero check antes para mensaje claro
    const existingDni = await tx.user.findUnique({ where: { dni: dto.dni } });
    if (existingDni) {
      // alerta admin
      throw new DniAlreadyExistsException();
    }
    const existingWa = await tx.user.findUnique({ where: { whatsapp: dto.whatsapp } });
    if (existingWa) throw new WhatsappAlreadyExistsException();

    const user = await tx.user.create({
      data: {
        dni: dto.dni,
        firstName: dto.firstName,
        lastName: dto.lastName,
        whatsapp: dto.whatsapp,
        passwordHash: await this.authService.hashPassword(dto.password),
        role: 'USER',
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { userId: user.id, completedAt: new Date() },
    });
    await tx.auditLog.create({ data: { userId: user.id, action: 'auth.registration_completed', entity: 'user', entityId: user.id } });
    return user;
  }).then(user => ({
    accessToken: this.authService.signAccessToken({ sub: user.id, role: user.role }),
    user: pickPublic(user),
  }));
}
```

**Test:** E2E completo: init payment → mock webhook approved → POST /auth/complete-registration → token válido inválido para 2do uso (TX fallaría por completedAt).

**Acceptance:**
- Flujo end-to-end funciona
- DNI duplicado lanza alerta WhatsApp al admin (vía AdminAlertsService)
- Token válido se invalida tras uso (completedAt)

**Commit:** `feat(backend/auth): POST /auth/complete-registration`

---

## Task 5.8 — Cron job: cleanup ORPHANED payments

**Files:** `backend/src/modules/payments/payments.cron.ts`

`@Cron('0 3 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })` (3am ART):
- Busca `Payment { status: 'APPROVED', userId: null, tokenExpiresAt: { lt: now() } }`
- Update a `status: 'ORPHANED'`
- Audit log

**Commit:** `feat(backend/payments): cron daily orphan cleanup`

---

## Task 5.9 — Cron job: daily orphan summary al admin

`@Cron('0 9 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })`:
- Cuenta `Payment { status: 'ORPHANED', updatedAt: { gte: yesterday } }`
- Si > 0, AdminAlerts.notify

**Commit:** `feat(backend/payments): cron daily orphan summary`

---

## Task 5.10 — Worker: admin-orphan-alert (delayed 2hs)

**Files:** `backend/src/modules/payments/orphan-alert.processor.ts`

BullMQ processor que recibe `{ paymentId }`, lee Payment, si `completedAt === null` envía AdminAlerts con `payerEmail` y `id`.

**Commit:** `feat(backend/payments): orphan-alert processor (2h delay)`

**End of Phase 5.** Commit: `feat(backend): phase 5 — public payment flow E2E ready`

---

# FASE 6 — Match management

**Goal:** admin gestiona los 104 matches; cron auto-lock funciona.

## Task 6.1 — MatchesService + MatchesController (admin endpoints)

**Endpoints:**
- `GET /matches` (público): paginado, filtros `phase`, `status`, `from/to`
- `GET /matches/upcoming` (público): próximos 10 ordenados por kickoff
- `GET /admin/matches/:id`
- `PUT /admin/matches/:id` (admin): puede editar `kickoffAt`, `venue`, `homeTeamId`, `awayTeamId`. Si `kickoffAt` cambia, recompute `predictionsLockAt = kickoffAt - 10min`. Audit log `match.kickoff_updated` o `match.team_assigned`.
- `POST /admin/matches/:id/postpone` (admin): status → POSTPONED

**Test:** integration tests por endpoint.

**Commit:** `feat(backend/matches): CRUD endpoints + admin update`

---

## Task 6.2 — Cron auto-lock matches

**Files:** `backend/src/modules/matches/matches.cron.ts`

`@Cron('* * * * *')` (cada minuto):
```typescript
await prisma.match.updateMany({
  where: { status: 'SCHEDULED', predictionsLockAt: { lte: new Date() } },
  data: { status: 'LOCKED' },
});
```

**Commit:** `feat(backend/matches): cron auto-lock matches`

---

## Task 6.3 — Cron auto-lock SpecialPrediction al kickoff del match #1

```typescript
@Cron('* * * * *')
async lockSpecialPredictions() {
  const m1 = await prisma.match.findUnique({ where: { matchNumber: 1 } });
  if (m1.predictionsLockAt > new Date()) return;
  await prisma.specialPrediction.updateMany({
    where: { lockedAt: null },
    data: { lockedAt: new Date() },
  });
}
```

**Commit:** `feat(backend/matches): cron auto-lock SpecialPrediction at first match kickoff`

---

## Task 6.4 — Helper recomputeLockAt

**Files:** `backend/src/modules/matches/matches.service.ts`

```typescript
private recomputeLockAt(kickoffAt: Date): Date {
  return new Date(kickoffAt.getTime() - 10 * 60 * 1000);
}
```

Usado en update de match.

**Commit:** `feat(backend/matches): recomputeLockAt helper`

---

## Task 6.5 — Endpoint público GET /matches/by-phase/:phase

Devuelve los matches de una fase con sus equipos populados (incluye placeholders cuando aún no hay equipos asignados).

**Commit:** `feat(backend/matches): GET /matches/by-phase`

**End of Phase 6.** Commit: `feat(backend): phase 6 — match management complete`

---

# FASE 7 — Predictions

**Goal:** usuarios cargan predicciones de partidos y especiales con todas las validaciones server-side.

## Task 7.1 — PredictionsService: createOrUpdate

**Files:** `backend/src/modules/predictions/predictions.service.ts`

Lógica:
- Validar usuario existe (implícito por JwtAuthGuard)
- Validar match existe
- Validar `now() < match.predictionsLockAt`
- Validar score 0-99
- Upsert por `(userId, matchId)` único

**Test:** unit con mock prisma + integration con BD.

**Acceptance:**
- Cargar pre-lock funciona
- Cargar post-lock → `PredictionLockedException`

**Commit:** `feat(backend/predictions): create/update prediction with lock check`

---

## Task 7.2 — PredictionsController endpoints

- `POST /predictions/match/:matchId` con `@CurrentUser()`
- `PUT /predictions/match/:matchId`
- `GET /predictions/me` (paginado, filtro fase)
- `GET /predictions/me/match/:matchId`

**Commit:** `feat(backend/predictions): match prediction endpoints`

---

## Task 7.3 — SpecialPredictionsService + endpoints

- `POST /predictions/special`
- `PUT /predictions/special`
- `GET /predictions/special/me`

Validaciones:
- `lockedAt === null`
- Champion ≠ runnerUp ≠ thirdPlace
- `topScorerId` válido o `topScorerName` no vacío
- `totalGoals` > 0

**Commit:** `feat(backend/predictions): special prediction endpoints with cross-field validation`

---

## Task 7.4 — Audit hooks

`@Audit` decorator en POST/PUT predicciones (action `prediction.created` / `prediction.updated`).

**Commit:** `feat(backend/predictions): add audit logs to mutations`

---

## Task 7.5 — Public endpoint GET /matches/:matchId/predictions/count

Para mostrar "X usuarios ya predijeron este partido" en frontend (gamificación).

**Commit:** `feat(backend/predictions): public count endpoint for match`

---

## Task 7.6 — Cache: invalidar al cargar prediction

Después de POST/PUT, invalidar cache `user:${userId}:predictions:*`.

**Commit:** `feat(backend/predictions): invalidate cache on mutation`

---

## Task 7.7 — Tests E2E flujo completo de predicción

E2E: usuario logueado → POST predicción → GET /predictions/me incluye la predicción → match auto-locked → update falla.

**Commit:** `test(backend/predictions): E2E flows`

**End of Phase 7.**

---

# FASE 8 — Scoring + Match progression

**Goal:** admin carga resultado, puntos calculados, fase cierra automáticamente, equipos de fase siguiente populated.

## Task 8.1 — Función pura `classifyOutcome`

**Files:** `backend/src/modules/scoring/classify-outcome.ts`, `backend/src/modules/scoring/classify-outcome.spec.ts`

Implementación exacta del spec sección 6.3. Test exhaustivo:
- (2,1) vs (2,1) → EXACT
- (2,1) vs (3,2) → WINNER_AND_DIFF
- (2,1) vs (4,1) → WINNER_ONLY
- (1,1) vs (2,2) → DRAW_DIFFERENT
- (1,1) vs (1,1) → EXACT
- (0,0) vs (1,1) → DRAW_DIFFERENT
- (2,1) vs (0,0) → MISS
- (2,1) vs (1,2) → MISS

**Commit:** `feat(backend/scoring): classifyOutcome pure function`

---

## Task 8.2 — ScoringConfigService (cached)

Lee `ScoringRule` y `PhaseMultiplier` con cache 1h. Invalida en update.

**Commit:** `feat(backend/scoring): ScoringConfigService with cache`

---

## Task 8.3 — ScoringService.finishMatchAndScore

**Files:** `backend/src/modules/scoring/scoring.service.ts`

Implementación exacta del spec sección 6.3 (la versión actualizada con):
- Pre-checks fuera de TX (PhaseAlreadyPaidException si fase pagada)
- TX con `for...of` secuencial (NO Promise.all)
- `where: { id, status: { not: 'FINISHED' } }` en update del match
- `timeout: 30_000` explícito en `$transaction`
- POST-COMMIT: encolar `leaderboard.refresh` + `match-result` + `maybeClosePhase`

**Test:** integration con BD: precarga match + 5 predictions, llama `finishMatchAndScore`, verifica puntos.

**Commit:** `feat(backend/scoring): finishMatchAndScore service`

---

## Task 8.4 — POST /admin/matches/:id/finish endpoint

Body: `{ scoreHome, scoreAway }`. Llama a `scoringService.finishMatchAndScore`. Audit log `match.finished`.

**Commit:** `feat(backend/scoring): admin finish match endpoint`

---

## Task 8.5 — ScoringService.recalculateMatch

Análogo a finish pero permite cambiar score si match ya está FINISHED. Bloqueado si `phaseWinner.prizeStatus === 'PAID'`. Audit log `match.recalculated` con before/after.

**Commit:** `feat(backend/scoring): recalculateMatch with phase-paid guard`

---

## Task 8.6 — POST /admin/matches/:id/recalculate endpoint

**Commit:** `feat(backend/scoring): admin recalculate match endpoint`

---

## Task 8.7 — PhaseService.maybeClosePhase + computePhaseWinner

**Files:** `backend/src/modules/scoring/phase.service.ts`

Lógica del spec sección 6.4. Idempotente (si PhaseWinner existe, no-op). Computa ganador con desempates (exact_count → hits_count → champion_pick → null).

**Commit:** `feat(backend/scoring): maybeClosePhase service`

---

## Task 8.8 — MatchProgressionService

**Files:** `backend/src/modules/scoring/match-progression.service.ts`

Métodos:
- `populateRound32Matches()`: lee tabla de cada grupo, determina los 32 clasificados según FIFA 2026 rules, asigna `homeTeamId/awayTeamId` a los 16 matches de ROUND_32, setea `predictionsOpenAt = now()`
- `populateRound16Matches()`: análogo
- `populateQuarterMatches()`, `populateSemiMatches()`, `populateFinalMatches()`

Cada uno se llama desde `maybeClosePhase` post-cierre.

**Test:** integration con seed de matches finalizados → assertion sobre teams asignados.

**Commit:** `feat(backend/scoring): MatchProgressionService for elimination rounds`

---

## Task 8.9 — Worker `leaderboard.refresh`

**Files:** `backend/src/modules/leaderboard/leaderboard.processor.ts`

```typescript
@Processor('notifications')
class LeaderboardRefreshProcessor extends WorkerHost {
  async process(job: Job) {
    if (job.name !== 'leaderboard.refresh') return;
    await this.prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
  }
}
```

**Test:** integration: cargar predictions, llamar finish, esperar 2s, query MV → puntos reflejados.

**Commit:** `feat(backend/leaderboard): refresh worker for materialized view`

**End of Phase 8.** Commit: `feat(backend): phase 8 — scoring + progression complete`

---

# FASE 9 — Leaderboard

**Goal:** endpoints públicos del leaderboard con paginación.

## Task 9.1 — LeaderboardRepository (raw queries)

Queries tipadas sobre la MV:
- `getGlobal(page, pageSize)`: top + paginado
- `getGlobalAroundUser(userId, n)`: posición del user + N arriba/abajo
- `getByPhase(phase, page, pageSize)`: agregación on-the-fly de `predictions` filtrando por phase

**Commit:** `feat(backend/leaderboard): repository with typed raw queries`

---

## Task 9.2 — LeaderboardService + cache

Cache `leaderboard:global:page:${n}` con TTL 60s. Invalidar en evento post-scoring.

**Commit:** `feat(backend/leaderboard): service with Redis cache`

---

## Task 9.3 — Endpoints

- `GET /leaderboard/global?page=N`
- `GET /leaderboard/phase/:phase?page=N`
- `GET /leaderboard/me/around` (auth)
- `GET /leaderboard/league/:leagueId` (auth, miembros only)

**Commit:** `feat(backend/leaderboard): public + authed endpoints`

---

## Task 9.4 — Test E2E: cambio post-scoring

E2E: predicciones cargadas → admin finish match → wait 3s → leaderboard refleja nuevos puntos.

**Commit:** `test(backend/leaderboard): E2E refresh after scoring`

---

## Task 9.5 — Healthcheck refresh job

Endpoint admin `POST /admin/leaderboard/refresh` para forzar manual.

**Commit:** `feat(backend/leaderboard): admin manual refresh endpoint`

**End of Phase 9.**

---

# FASE 10 — Mini-leagues

**Goal:** usuarios crean y se unen a mini-ligas.

## Task 10.1 — generateInviteCode helper

```typescript
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin O,0,1,I,L
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}
```

Reintenta si colisiona (max 5 veces).

**Commit:** `feat(backend/leagues): inviteCode generator`

---

## Task 10.2 — POST /leagues + GET /leagues/me

Crear mini-liga (auto-añade owner como member).

**Commit:** `feat(backend/leagues): create + list own leagues`

---

## Task 10.3 — POST /leagues/join

Body `{ inviteCode }`. Valida liga existe, no llena, user no es ya miembro.

**Commit:** `feat(backend/leagues): join via invite code`

---

## Task 10.4 — GET /leagues/:id/leaderboard

Reutiliza LeaderboardRepository filtrando por miembros de la liga.

**Commit:** `feat(backend/leagues): per-league leaderboard`

**End of Phase 10.**

---

# FASE 11 — Crons + delayed jobs

**Goal:** todos los recordatorios y tareas programadas activos.

## Task 11.1 — Match reminders cron

`@Cron('*/15 * * * *')`: detecta matches que arrancan en ~2hs, encola WhatsApp a usuarios sin predicción (con dedup `match-reminder:${userId}:${matchId}`).

**Commit:** `feat(backend/notifications): cron match reminders`

---

## Task 11.2 — Token cleanup cron

`@Cron('0 4 * * *', tz=ART)`: borra `RefreshToken` y `PasswordReset` con `expiresAt < now()` o `revokedAt < now() - 7d`.

**Commit:** `feat(backend/auth): cron daily token cleanup`

---

## Task 11.3 — Match result notifications

Worker `match-result`: lee predictions del match recién finalizado, encola WhatsApp resumen a usuarios con `whatsappOptIn=true`.

Decisión: solo a usuarios que SUMARON puntos (no spamear a todos los que erraron).

**Commit:** `feat(backend/notifications): match-result notifications`

---

## Task 11.4 — Phase winner notification

Worker `phase-winner`: WhatsApp al ganador de la fase + email opcional.

**Commit:** `feat(backend/notifications): phase-winner notification`

---

## Task 11.5 — Outbox safety net cron

`@Cron('*/5 * * * *')`: encuentra `Notification { status: PENDING, createdAt: lt: now-5min }` y re-encola.

**Commit:** `feat(backend/notifications): outbox safety-net cron`

**End of Phase 11.**

---

# FASE 12 — Hardening

**Goal:** rate limiting, CORS, helmet, Turnstile, Sentry, prod-ready.

## Task 12.1 — @nestjs/throttler con storage Redis

```bash
cd backend && pnpm add @nestjs/throttler @nest-lab/throttler-storage-redis
```

Configurar throttlers diferenciados por endpoint según tabla del spec sección 8.3.

**Commit:** `feat(backend): rate limiting with Redis storage`

---

## Task 12.2 — Helmet + CORS

```bash
cd backend && pnpm add helmet
```

```typescript
app.use(helmet({ contentSecurityPolicy: { ... } }));
app.enableCors({ origin: env.FRONTEND_URL, credentials: true });
```

**Commit:** `feat(backend): helmet + CORS`

---

## Task 12.3 — Cloudflare Turnstile validator

**Files:** `backend/src/common/guards/turnstile.guard.ts`

Guard que llama a `https://challenges.cloudflare.com/turnstile/v0/siteverify` con el token recibido en header. Aplicar a `/payments/init`.

**Commit:** `feat(backend/security): Turnstile guard for /payments/init`

---

## Task 12.4 — Sentry init

```bash
cd backend && pnpm add @sentry/node @sentry/profiling-node
```

`main.ts`: `Sentry.init({ dsn: env.SENTRY_DSN, environment: NODE_ENV, tracesSampleRate: 0.1 })`. `GlobalExceptionFilter` llama `Sentry.captureException(err)` para 5xx + invoca AdminAlerts.notify.

**Commit:** `feat(backend): Sentry + admin alerts on 5xx`

---

## Task 12.5 — Pino logger global

```bash
cd backend && pnpm add nestjs-pino pino-http pino-pretty
```

Config con redactor `password`, `*.token`, `*.cardNumber`, `*.cvv`. Request-id automático.

**Commit:** `feat(backend): nestjs-pino structured logging with redactor`

---

## Task 12.6 — Graceful shutdown

```typescript
app.enableShutdownHooks();
```

Hooks en services críticos para drenar BullMQ jobs antes de exit.

**Commit:** `feat(backend): graceful shutdown for prod deploys`

**End of Phase 12.**

---

# FASE 13 — E2E test suite

**Goal:** 5 flujos E2E del spec sección 10 cubiertos.

## Task 13.1 — Test helper: app factory + Testcontainers

**Files:** `backend/test/helpers/app.ts`

Boot completo de la app con Postgres en Testcontainer + Redis ephemeral. Limpieza entre tests.

**Commit:** `test(backend): E2E test infra with Testcontainers`

---

## Task 13.2 — E2E flujo 1: registro público completo

Init payment → mock webhook approved → completar registro → login.

**Commit:** `test(backend): E2E public registration flow`

---

## Task 13.3 — E2E flujo 2: predicción + scoring

Usuario predice → admin finish match → puntos calculados → leaderboard refleja.

**Commit:** `test(backend): E2E prediction + scoring`

---

## Task 13.4 — E2E flujo 3: cierre de fase

Todos matches FINISHED → PhaseWinner creado → notificación encolada.

**Commit:** `test(backend): E2E phase close`

---

## Task 13.5 — E2E flujo 4 + 5: admin manual + recálculo

- Admin crea User manual → User logea → carga predicción
- Admin recalcula match → audit log con before/after

**Commit:** `test(backend): E2E admin flows + recalculation`

**End of Phase 13.**

---

# FASE 14 — Deployment

**Goal:** containerizar y desplegar a staging via Dokploy.

## Task 14.1 — Dockerfile multi-stage

**Files:** `backend/Dockerfile`

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm exec prisma generate && pnpm exec nest build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Argentina/Buenos_Aires
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY package.json pnpm-lock.yaml prisma.config.ts ./
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

**Acceptance:**
- `docker build -t prode-backend backend/` builds sin errores
- `docker run --env-file backend/.env -p 3001:3001 prode-backend` levanta y responde /health

**Commit:** `feat(backend): production Dockerfile`

---

## Task 14.2 — Migration en startup (entrypoint)

**Files:** `backend/scripts/start.sh`

```bash
#!/bin/sh
set -e
pnpm exec prisma migrate deploy
exec node dist/main.js
```

Update CMD: `CMD ["sh", "scripts/start.sh"]`.

**Commit:** `feat(backend): apply migrations on container start`

---

## Task 14.3 — Dokploy compose file

**Files:** `dokploy/docker-compose.yml`

Servicios: postgres con volumen persistente, redis, prode-backend con env vars.

**Commit:** `chore(deploy): Dokploy compose definition`

---

## Task 14.4 — Configurar dominio + SSL en Dokploy

(Acción manual en panel Dokploy.)

Subdominio `api.prode.tirofederal.com` → backend container puerto 3001. Let's Encrypt automático.

Configurar webhook URL en panel MercadoPago: `https://api.prode.tirofederal.com/payments/webhook`.

**Verification:**
```bash
curl -s https://api.prode.tirofederal.com/health
# Expected: {"status":"ok","db":true,...}
```

**Commit:** `docs(deploy): production deployment notes`

**End of Phase 14.**

---

# Integration Tests (post-implementación)

```bash
cd backend && pnpm test           # all unit tests passing
cd backend && pnpm test:e2e       # all E2E flows passing
cd backend && pnpm test:integration  # all integration tests passing
```

# Manual Verification (post-deploy)

1. Admin login con DNI/password del seed → recibe access token
2. Admin crea match con kickoff cercano (5 min al futuro)
3. Cron auto-lock cambia status a LOCKED tras 5 min
4. Admin pone scoreHome/scoreAway, hits POST /admin/matches/:id/finish
5. ~3s después, leaderboard refleja
6. Curl /payments/init → recibo initPoint MP de prueba
7. Click en initPoint, paga con TC de test, MP redirige
8. Completar registro → access token, login funciona
9. Admin recibe WhatsApp si pago queda 2hs sin completar registro

# Rollback Plan

Si algo crítico se rompe en producción:

```bash
# Revertir el último commit problemático
cd /Users/nicolasvelazquez/Desktop/dev/prode
git log --oneline -5         # identificar commit a revertir
git revert <hash>            # crea commit reverso
git push origin main         # Dokploy redeploy automático

# Si la migración rompió la BD, restaurar desde backup B2
# (procedimiento documentado en spec sección 12)
```

Para fallar gracefully ante crisis durante el Mundial:
- Cache de leaderboard sigue sirviendo aunque MV refresh falle
- WhatsApp degradado: notificaciones quedan en `notifications` con status=FAILED, retry manual
- Scoring funciona sin cache (degradación al hit Postgres directo)

# Notas finales

- **Checkpoint sugerido entre fases:** después de cada fase, correr toda la suite de tests + commit + push. Si algo se rompe, cortar y revisar.
- **Coordinar con frontend:** desde Fase 5 en adelante, el frontend puede empezar a integrar en paralelo. Endpoints estables: `POST /payments/init`, `POST /auth/complete-registration`, `POST /auth/login`.
- **Datos del Mundial 2026:** la lista oficial de matches y groups se actualiza con FIFA. Validar el JSON de seed contra la fuente al momento del seedeo final.
- **No olvidar:** test de integración del round-trip de `metadata` en MP cuando se construya el `MercadoPagoCheckoutProvider` (recomendación del revisor).
