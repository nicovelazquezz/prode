# Prode Mundial 2026 — Design Doc del Backend

**Fecha:** 2026-05-04
**Estado:** Aprobado por el cliente, listo para fase de plan de implementación
**Autor:** Brainstorming colaborativo entre cliente y asistente

---

## 1. Contexto y objetivos

Plataforma web mobile-first para gestionar un Prode (pronósticos deportivos) del Mundial de Fútbol 2026, con el objetivo de recolectar fondos para el Club Tiro Federal de Bahía Blanca.

- **Evento:** Copa Mundial de la FIFA 2026 (USA, México, Canadá), 11 de junio a 19 de julio de 2026
- **Volumen esperado:** menos de 200 usuarios, ~104 partidos × 200 = ~20.000 predicciones
- **Idioma:** español (Argentina)
- **Zona horaria del usuario:** America/Argentina/Buenos_Aires (UTC-3)

Este documento describe **únicamente el backend**. El frontend (Next.js 15) tendrá su propio design doc.

## 2. Stack técnico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | 22 LTS |
| Framework | NestJS | 11+ |
| Lenguaje | TypeScript ESM | 5.7+ |
| ORM | Prisma + adapter-pg | 7+ |
| BD | PostgreSQL | 16 |
| Cache + queue broker | Redis | 7+ |
| Jobs | BullMQ | 5+ |
| Auth | jsonwebtoken + bcrypt | — |
| Validación HTTP | class-validator + class-transformer | — |
| Validación externa (env, webhooks) | Zod | 3+ |
| Logging | nestjs-pino | — |
| Pagos | mercadopago SDK v2 (vía interface agnóstica) | — |
| Observabilidad | Sentry | — |
| Testing | Jest + Supertest + Testcontainers | — |
| Deploy | Dokploy en VPS propio | — |

**Prisma 7 trae cambios importantes:** ESM-only, generator `prisma-client` (no más `prisma-client-js`), output path explícito requerido, driver adapter requerido (`@prisma/adapter-pg`), config en `prisma.config.ts` con `dotenv` manual.

## 3. Arquitectura de capas

```
┌─────────────────────────────────────────────────┐
│  HTTP Layer (Controllers + Guards + Pipes)      │
│  Recibe requests, valida DTOs, llama al service │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Application Layer (Services)                    │
│  Lógica de negocio, orquestación, transacciones │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Data Access (PrismaService directo)             │
│  Excepciones: LeaderboardRepository,             │
│  MatchProgressionRepository (queries complejas)  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Infrastructure (Prisma, Redis, BullMQ, MP)      │
└─────────────────────────────────────────────────┘
```

**Decisión deliberada:** sin Repository pattern obligatorio. Prisma ya provee la abstracción y los services testean perfecto mockeando `PrismaService`. La capa de Repository solo aparece donde realmente paga (queries complejas reutilizables).

## 4. Estructura de carpetas

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── modules/
│   │   ├── auth/                    # login, refresh, complete-registration, password recovery
│   │   ├── users/                   # CRUD admin de usuarios
│   │   ├── teams/                   # 48 selecciones
│   │   ├── players/                 # jugadores destacados (autocomplete goleador)
│   │   ├── matches/                 # 104 partidos + carga de resultados
│   │   ├── predictions/             # de partidos + especiales
│   │   ├── scoring/                 # motor de cálculo de puntos
│   │   ├── leaderboard/             # tabla general + por fase + mini-ligas
│   │   ├── leagues/                 # mini-ligas
│   │   ├── payments/                # registro de pagos (provider-agnostic)
│   │   ├── notifications/           # cola WhatsApp + email + plantillas
│   │   ├── admin/                   # acciones específicas del panel admin
│   │   ├── audit/                   # AuditLog cross-cutting (interceptor + decorator)
│   │   └── config/                  # ScoringRule, PhaseMultiplier, AppConfig
│   ├── common/
│   │   ├── guards/                  # JwtAuthGuard, RolesGuard, ThrottlerGuard
│   │   ├── decorators/              # @Roles, @CurrentUser, @Public, @Audit
│   │   ├── filters/                 # PrismaExceptionFilter, GlobalExceptionFilter
│   │   ├── interceptors/            # LoggingInterceptor, AuditInterceptor
│   │   ├── pipes/                   # ZodValidationPipe (cuando hace falta)
│   │   └── exceptions/              # excepciones de dominio
│   ├── shared/
│   │   ├── prisma/                  # PrismaModule + PrismaService (con driver adapter v7)
│   │   ├── redis/                   # RedisModule (cache + bull connection)
│   │   ├── bullmq/                  # configuración global de colas
│   │   ├── checkout/                # CheckoutProvider interface + Mercadopago + Mock
│   │   ├── whatsapp/                # WhatsappService (wrapper backend existente)
│   │   ├── email/                   # EmailService (para magic links)
│   │   └── admin-alerts/            # AdminAlertsService (WhatsApp al admin)
│   ├── config/                      # env validation con Zod
│   └── main.ts
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docker-compose.yml               # postgres + redis para dev local
├── Dockerfile
├── prisma.config.ts                 # Prisma 7 config
├── .env.example
├── tsconfig.json                    # ESM config
└── package.json                     # "type": "module"
```

**Cada módulo de dominio tiene la misma estructura interna:**

```
modules/predictions/
├── dto/
│   ├── create-prediction.dto.ts
│   ├── update-prediction.dto.ts
│   └── special-prediction.dto.ts
├── entities/                        # tipos derivados de Prisma + value objects
├── exceptions/                      # PredictionLockedException, etc.
├── predictions.controller.ts
├── predictions.service.ts
├── predictions.module.ts
└── predictions.service.spec.ts
```

## 5. Modelo de datos

### 5.1 Cambios respecto a `04-modelo-datos.md` original

| # | Cambio | Justificación |
|---|--------|---------------|
| 1 | Quito `User.isPaid`, `User.paidAt`, `User.paidMethod`, `User.paidAmount` | Si un User existe en BD = ya pagó. Redundante. |
| 2 | `Payment.userId` ahora nullable | Flujo público: el pago existe antes que el usuario |
| 3 | Agrego en `Payment`: `payerEmail`, `completionToken`, `tokenExpiresAt`, `completedAt` | Captura del email de MP + token para magic link |
| 4 | NO uso `PendingRegistration` separado | El propio `Payment` con `userId=null` lo cubre |
| 5 | Reemplazo `AppConfig` key-value por `ScoringRule`, `PhaseMultiplier`, `SpecialPrizeRule` | Flexibilidad A: estructurado, editable desde admin con UI tipada |
| 6 | `AppConfig` queda solo para escalares (precio, fechas, distribución del pozo) | Sigue siendo útil |
| 7 | Agrego `OutcomeType` enum y `Prediction.outcomeType` | Auditoría del cálculo + desempates por exactos acertados |
| 8 | Índices ajustados | Para queries de leaderboard, próximos partidos, idempotencia |
| 9 | Materialized view `leaderboard_global` | Performance para tabla consultada con frecuencia |
| 10 | `User.email` eliminado | Solo trabajamos con `payerEmail` interno y `whatsapp` del usuario |

### 5.2 Schema Prisma completo

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ────────────────────────────────────────────────

enum Role {
  USER
  ADMIN
}

enum UserStatus {
  ACTIVE
  INACTIVE
  BANNED
}

enum PaymentStatus {
  PENDING
  APPROVED
  REJECTED
  REFUNDED
  ORPHANED
}

enum PaymentMethod {
  MERCADOPAGO
  CASH
  TRANSFER
}

enum Phase {
  GROUPS
  ROUND_32
  ROUND_16
  QUARTERS
  SEMIS
  THIRD_PLACE
  FINAL
}

enum MatchStatus {
  SCHEDULED
  LOCKED
  IN_PROGRESS
  FINISHED
  POSTPONED
  CANCELLED
}

enum Confederation {
  CONMEBOL
  UEFA
  CONCACAF
  AFC
  CAF
  OFC
}

enum OutcomeType {
  EXACT
  WINNER_AND_DIFF
  DRAW_DIFFERENT
  WINNER_ONLY
  MISS
}

enum NotificationType {
  PAYMENT_CONFIRMED
  REGISTRATION_PENDING_RECOVERY
  MATCH_REMINDER
  MATCH_RESULT
  PHASE_WINNER
  PASSWORD_RESET
  ADMIN_BROADCAST
}

enum NotificationChannel {
  WHATSAPP
  EMAIL
  IN_APP
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

enum PrizeStatus {
  PENDING
  PAID
}

// ─── USUARIOS Y AUTENTICACIÓN ─────────────────────────────

model User {
  id                  String              @id @default(cuid())
  dni                 String              @unique
  firstName           String
  lastName            String
  whatsapp            String              @unique
  passwordHash        String
  role                Role                @default(USER)
  status              UserStatus          @default(ACTIVE)
  whatsappOptIn       Boolean             @default(true)

  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  lastLoginAt         DateTime?

  predictions         Prediction[]
  specialPrediction   SpecialPrediction?
  payments            Payment[]
  refreshTokens       RefreshToken[]
  passwordResets      PasswordReset[]
  phaseWins           PhaseWinner[]
  leaguesOwned        League[]            @relation("LeagueOwner")
  leagueMemberships   LeagueMembership[]
  notifications       Notification[]
  auditLogs           AuditLog[]

  @@index([dni])
  @@index([whatsapp])
  @@index([status])
  @@map("users")
}

model RefreshToken {
  id          String    @id @default(cuid())
  tokenHash   String    @unique  // sha256 del token; el plano solo vive en cookie
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  userAgent   String?
  ipAddress   String?

  @@index([userId])
  @@map("refresh_tokens")
}

model PasswordReset {
  id          String    @id @default(cuid())
  tokenHash   String    @unique  // sha256 del token; el plano solo viaja en WhatsApp
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt   DateTime
  usedAt      DateTime?
  createdAt   DateTime  @default(now())

  @@index([userId])
  @@map("password_resets")
}

// ─── SELECCIONES Y JUGADORES ──────────────────────────────

model Team {
  id              String              @id @default(cuid())
  fifaCode        String              @unique
  name            String
  shortName       String
  flagUrl         String
  confederation   Confederation
  groupCode       String?
  fifaRanking     Int?

  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  matchesAsHome   Match[]             @relation("HomeTeam")
  matchesAsAway   Match[]             @relation("AwayTeam")
  championPicks   SpecialPrediction[] @relation("ChampionPick")
  runnerUpPicks   SpecialPrediction[] @relation("RunnerUpPick")
  thirdPlacePicks SpecialPrediction[] @relation("ThirdPlacePick")
  players         Player[]

  @@index([groupCode])
  @@map("teams")
}

model Player {
  id              String              @id @default(cuid())
  fullName        String
  teamId          String?
  team            Team?               @relation(fields: [teamId], references: [id])
  position        String?

  topScorerPicks  SpecialPrediction[] @relation("TopScorerPick")

  @@index([teamId])
  @@index([fullName])
  @@map("players")
}

// ─── PARTIDOS ─────────────────────────────────────────────

model Match {
  id                 String        @id @default(cuid())
  matchNumber        Int           @unique
  phase              Phase
  groupCode          String?

  homeTeamId         String?
  homeTeam           Team?         @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeamId         String?
  awayTeam           Team?         @relation("AwayTeam", fields: [awayTeamId], references: [id])

  homeTeamLabel      String?
  awayTeamLabel      String?

  kickoffAt          DateTime
  predictionsLockAt  DateTime
  predictionsOpenAt  DateTime?

  status             MatchStatus   @default(SCHEDULED)

  scoreHome          Int?
  scoreAway          Int?
  finishedAt         DateTime?

  venue              String?
  city               String?
  country            String?

  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  predictions        Prediction[]

  @@index([phase, status])
  @@index([kickoffAt])
  @@index([status, kickoffAt])
  @@index([homeTeamId])
  @@index([awayTeamId])
  @@map("matches")
}

// ─── CONFIGURACIÓN DE PUNTOS (FLEXIBILIDAD A) ─────────────

model ScoringRule {
  id              String        @id @default(cuid())
  outcomeType     OutcomeType   @unique
  basePoints      Int
  description     String
  updatedAt       DateTime      @updatedAt
  updatedBy       String?

  @@map("scoring_rules")
}

model PhaseMultiplier {
  id              String        @id @default(cuid())
  phase           Phase         @unique
  multiplier      Decimal       @db.Decimal(3, 1)
  updatedAt       DateTime      @updatedAt
  updatedBy       String?

  @@map("phase_multipliers")
}

model SpecialPrizeRule {
  id              String        @id @default(cuid())
  key             String        @unique
  points          Int
  description     String
  updatedAt       DateTime      @updatedAt
  updatedBy       String?

  @@map("special_prize_rules")
}

// ─── PREDICCIONES ─────────────────────────────────────────

model Prediction {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  matchId         String
  match           Match         @relation(fields: [matchId], references: [id], onDelete: Cascade)

  scoreHome       Int
  scoreAway       Int

  outcomeType     OutcomeType?
  basePoints      Int           @default(0)
  multiplier      Decimal       @default(1) @db.Decimal(3, 1)
  pointsEarned    Int           @default(0)
  evaluatedAt     DateTime?

  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([userId, matchId])
  @@index([matchId])
  @@index([userId, evaluatedAt])
  @@map("predictions")
}

model SpecialPrediction {
  id                  String   @id @default(cuid())
  userId              String   @unique
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  championTeamId      String?
  championTeam        Team?    @relation("ChampionPick", fields: [championTeamId], references: [id])
  runnerUpTeamId      String?
  runnerUpTeam        Team?    @relation("RunnerUpPick", fields: [runnerUpTeamId], references: [id])
  thirdPlaceTeamId    String?
  thirdPlaceTeam      Team?    @relation("ThirdPlacePick", fields: [thirdPlaceTeamId], references: [id])

  topScorerId         String?
  topScorer           Player?  @relation("TopScorerPick", fields: [topScorerId], references: [id])
  topScorerName       String?

  totalGoals          Int?

  championPoints      Int      @default(0)
  runnerUpPoints      Int      @default(0)
  thirdPlacePoints    Int      @default(0)
  topScorerPoints     Int      @default(0)
  totalGoalsPoints    Int      @default(0)
  totalPoints         Int      @default(0)
  evaluatedAt         DateTime?

  lockedAt            DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([championTeamId])
  @@index([runnerUpTeamId])
  @@index([thirdPlaceTeamId])
  @@index([topScorerId])
  @@map("special_predictions")
}

// ─── GANADORES POR FASE ──────────────────────────────────

model PhaseWinner {
  id              String       @id @default(cuid())
  phase           Phase        @unique
  userId          String
  user            User         @relation(fields: [userId], references: [id])
  pointsEarned    Int
  prizeAmount     Decimal?     @db.Decimal(10, 2)
  prizeStatus     PrizeStatus  @default(PENDING)
  prizePaidAt     DateTime?
  awardedAt       DateTime     @default(now())
  notes           String?

  @@index([userId])
  @@map("phase_winners")
}

// ─── PAGOS ────────────────────────────────────────────────

model Payment {
  id                  String          @id @default(cuid())

  userId              String?
  user                User?           @relation(fields: [userId], references: [id])

  amount              Decimal         @db.Decimal(10, 2)
  method              PaymentMethod
  status              PaymentStatus   @default(PENDING)

  mpPreferenceId      String?
  mpPaymentId         String?         @unique
  mpExternalReference String?
  mpRawData           Json?

  payerEmail              String?
  payerName               String?

  // Magic link para completar registro post-pago
  completionTokenHash     String?     @unique  // sha256; el plano viaja en email/url
  tokenExpiresAt          DateTime?            // TTL = 7 días desde APPROVED
  completedAt             DateTime?

  receivedBy              String?
  notes                   String?

  paidAt                  DateTime?
  refundedAt              DateTime?
  createdAt               DateTime    @default(now())
  updatedAt               DateTime    @updatedAt

  @@index([userId])
  @@index([status])
  @@index([completionTokenHash])
  @@index([mpPreferenceId])
  @@map("payments")
}

// ─── MINI-LIGAS ───────────────────────────────────────────

model League {
  id              String              @id @default(cuid())
  name            String
  description     String?
  inviteCode      String              @unique
  ownerId         String
  owner           User                @relation("LeagueOwner", fields: [ownerId], references: [id])
  isPublic        Boolean             @default(false)
  maxMembers      Int                 @default(50)
  createdAt       DateTime            @default(now())

  members         LeagueMembership[]

  @@index([ownerId])
  @@map("leagues")
}

model LeagueMembership {
  id              String      @id @default(cuid())
  leagueId        String
  league          League      @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  joinedAt        DateTime    @default(now())

  @@unique([leagueId, userId])
  @@index([userId])
  @@map("league_memberships")
}

// ─── NOTIFICACIONES ───────────────────────────────────────

model Notification {
  id              String              @id @default(cuid())
  userId          String?
  user            User?               @relation(fields: [userId], references: [id], onDelete: Cascade)
  toAddress       String?             // null si MP no devolvió email del payer; service decide fallback
  type            NotificationType
  title           String
  message         String              @db.Text
  channel         NotificationChannel
  status          NotificationStatus  @default(PENDING)
  attempts        Int                 @default(0)
  sentAt          DateTime?
  failureReason   String?
  metadata        Json?
  dedupKey        String?             @unique
  createdAt       DateTime            @default(now())

  @@index([userId])
  @@index([status, channel])
  @@map("notifications")
}

// ─── CONFIGURACIÓN GLOBAL (escalares) ─────────────────────

model AppConfig {
  key             String      @id
  value           String      @db.Text
  description     String?
  updatedAt       DateTime    @updatedAt
  updatedBy       String?

  @@map("app_config")
}

// ─── AUDITORÍA ────────────────────────────────────────────

model AuditLog {
  id              String      @id @default(cuid())
  userId          String?
  user            User?       @relation(fields: [userId], references: [id])
  action          String
  entity          String
  entityId        String?
  changes         Json?
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime    @default(now())

  @@index([action])
  @@index([entity, entityId])
  @@index([userId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### 5.3 Invariantes de dominio (no expresadas en el schema)

Estas reglas se enforzan en services + tests, no en la BD:

- `Match.predictionsLockAt = Match.kickoffAt - 10 min`. Si `kickoffAt` se actualiza, `predictionsLockAt` se recomputa en el mismo update (helper `recomputeLockAt(match)`).
- `Prediction.evaluatedAt !== null ⇒ Prediction.outcomeType !== null`. Validado en service y test unitario.
- `SpecialPrediction.lockedAt`: se setea cuando `now() ≥ predictionsLockAt` del `Match.matchNumber=1` (kickoff inaugural). Cron de auto-lock (cada 1 min) detecta esa condición y lockea **todas** las `SpecialPrediction` existentes en una sola UPDATE. Después de eso, cualquier intento de update tira `SpecialPredictionLockedException`.
- `Payment.tokenExpiresAt = paidAt + 7 días`. Después de eso, el cron de orphan cleanup marca como `ORPHANED`.
- `League.inviteCode`: 6 caracteres alfanuméricos (regex `[A-Z0-9]{6}`), generado con `crypto.randomBytes` + base32. Helper `generateInviteCode()` en `LeaguesService`. Reintenta si colisiona.
- `RefreshToken.tokenHash`, `PasswordReset.tokenHash`, `Payment.completionTokenHash`: el plano se genera con `crypto.randomBytes(32).toString('hex')`, se manda al destinatario, y solo el `sha256(plano)` queda en BD.

### 5.4 Materialized view de leaderboard

```sql
-- prisma/migrations/xxx_leaderboard_view/migration.sql

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

**Refresh:** se ejecuta **fuera de la transacción de scoring**, encolado como BullMQ job `leaderboard.refresh` con `dedupKey="leaderboard:refresh"` (si hay uno pendiente, no se duplica). El worker corre `REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global` en su propia conexión. Justificación: meterlo en la TX del scoring tiene tres problemas — (a) Postgres acquiere `SHARE UPDATE EXCLUSIVE` lock sobre la MV durante todo el TX, serializando refrescos concurrentes; (b) `prisma.$transaction` tiene timeout default de 5s; (c) si la TX rollbackea, el refresh también queda al medio. Para volumen <200 users, el delay de 1-2s entre commit y refresh es aceptable.

**Acceso desde Prisma:** raw query tipada (`prisma.$queryRaw`), no es modelo Prisma.

### 5.5 Resumen de índices estratégicos

| Tabla | Índice | Para |
|-------|--------|------|
| `users` | `dni` (único) | Login |
| `users` | `whatsapp` (único) | Recovery + dedup |
| `users` | `status` | Listar activos en leaderboard |
| `matches` | `(phase, status)` | "Partidos finalizados de cuartos" |
| `matches` | `kickoffAt` | "Próximos partidos" |
| `matches` | `(status, kickoffAt)` | Cron de auto-lock |
| `predictions` | `(userId, matchId)` único | Upsert |
| `predictions` | `matchId` | Calcular puntos al cargar resultado |
| `predictions` | `(userId, evaluatedAt)` | "Mis predicciones evaluadas" |
| `payments` | `mpPaymentId` único | Búsqueda por id de MP |
| `payments` | `mpPreferenceId` | Lookup desde webhook |
| `payments` | `completionTokenHash` único | Magic link |
| `payments` | `status` | Admin: ver pendientes/huérfanos |
| `audit_logs` | `(entity, entityId)` | "Quién tocó este partido" |
| `audit_logs` | `createdAt` | Time-series de eventos |

## 6. Flujos críticos del dominio

### 6.1 Registro público vía MercadoPago

**Endpoints involucrados:**

```
POST /payments/init                  # pública, sin auth — crea preferencia MP
POST /payments/webhook                # pública, valida firma MP
GET  /payments/by-token/:token       # pública, valida token + estado del pago
POST /auth/complete-registration     # pública, crea User + JWT
```

**Pasos:**

1. Usuario ve landing → click "Pagar inscripción"
2. `POST /payments/init` (sin auth) → backend crea `Payment{userId: null, status: PENDING, completionToken}` y preferencia MP
3. Backend devuelve `initPoint`, frontend redirige a MP
4. Usuario paga (solo tarjeta o dinero en cuenta MP — Pago Fácil/Rapipago excluidos)
5. MP envía webhook con firma HMAC-SHA256
6. Backend valida firma, marca `Payment.status=APPROVED`, captura `payerEmail/payerName`, encola notificación de email con magic link
7. MP redirige usuario a `/completar-registro?token=xxx`
8. Usuario completa form (DNI, nombre, apellido, WhatsApp, password)
9. `POST /auth/complete-registration` valida token, crea User en TX, vincula Payment, emite JWT

**Configuración de la preferencia MP:**

```typescript
payment_methods: {
  excluded_payment_types: [
    { id: 'ticket' },  // Pago Fácil/Rapipago
    { id: 'atm' },
  ],
  installments: 1,
}
```

**Validaciones al completar registro:**
- `Payment.status === APPROVED`
- `Payment.completedAt === null`
- `Payment.tokenExpiresAt > now()`
- `Payment.userId === null`
- DNI no existe
- WhatsApp no existe
- Si DNI/WhatsApp duplicado → 409, audit log, alerta WhatsApp al admin

### 6.2 Registro manual del admin

Para socios del club que pagan en efectivo o por transferencia bancaria a la cuenta del club.

```
Admin                 Backend
  │  POST /admin/users
  │  { dni, firstName, lastName, whatsapp, password,
  │    paymentMethod: 'CASH'|'TRANSFER', amount, notes }
  │
  │  Backend en TX:
  │    1. Validar DNI/whatsapp libres
  │    2. hashPass = bcrypt(password)
  │    3. Crear User
  │    4. Crear Payment {
  │         userId, method, amount,
  │         status: APPROVED,
  │         receivedBy: admin.id,
  │         paidAt: now()
  │       }
  │    5. AuditLog action="user.created_manually"
  │
  │  Admin pasa la password por WhatsApp al usuario manualmente
```

### 6.3 Cálculo de puntos al cargar resultado

**Trigger:** admin marca match como FINISHED y carga el score.

```typescript
async finishMatchAndScore(matchId, scoreHome, scoreAway, adminUserId) {
  // Pre-checks fuera de TX
  const matchPrev = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  if (matchPrev.status === 'FINISHED') {
    throw new MatchAlreadyFinishedException();
  }
  // Si la fase del match ya tiene premio pagado, no se permite escribir
  const phaseWinner = await prisma.phaseWinner.findUnique({ where: { phase: matchPrev.phase } });
  if (phaseWinner?.prizeStatus === 'PAID') {
    throw new PhaseAlreadyPaidException();
  }

  const rules = await this.scoringConfigService.getRules();
  const multipliers = await this.scoringConfigService.getMultipliers();

  await prisma.$transaction(async (tx) => {
    // 1. Update match con guard de status (bloquea concurrentes)
    const match = await tx.match.update({
      where: { id: matchId, status: { not: 'FINISHED' } },
      data: { scoreHome, scoreAway, status: 'FINISHED', finishedAt: new Date() },
    });

    // 2. Cargar predictions del match
    const predictions = await tx.prediction.findMany({ where: { matchId } });

    // 3. Recorrer secuencial (NO Promise.all — Prisma TX comparte 1 conn)
    for (const p of predictions) {
      const outcomeType = classifyOutcome(p, scoreHome, scoreAway);
      const basePoints = rules[outcomeType];
      const multiplier = multipliers[match.phase];
      const pointsEarned = Math.round(basePoints * multiplier);
      await tx.prediction.update({
        where: { id: p.id },
        data: { outcomeType, basePoints, multiplier, pointsEarned, evaluatedAt: new Date() },
      });
    }

    // 4. Audit
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'match.finished',
        entity: 'match',
        entityId: matchId,
        changes: { score: { home: scoreHome, away: scoreAway }, predictionsScored: predictions.length },
      },
    });
  }, { timeout: 30_000 }); // explicit timeout: ~200 predictions max

  // 5. POST-COMMIT: refresh MV async + invalidar cache + cierre de fase + notifs
  await this.notificationsQueue.add(
    'leaderboard.refresh',
    {},
    { jobId: 'leaderboard:refresh', removeOnComplete: true } // dedup automático
  );
  await this.cacheService.invalidate('leaderboard:*');
  await this.notificationsQueue.add('match-result', { matchId });
  await this.phaseService.maybeClosePhase(matchPrev.phase);  // único trigger de cierre de fase
}
```

**Worker `leaderboard.refresh`:**

```typescript
@Processor('notifications')
class LeaderboardRefreshProcessor {
  async process(job: Job<{}, void, 'leaderboard.refresh'>) {
    await this.prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
  }
}
```

**Recálculo de un resultado (admin se equivocó):**

```typescript
async recalculateMatch(matchId, scoreHome, scoreAway, adminUserId) {
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  if (match.status !== 'FINISHED') throw new MatchNotFinishedException();
  const phaseWinner = await prisma.phaseWinner.findUnique({ where: { phase: match.phase } });
  if (phaseWinner?.prizeStatus === 'PAID') throw new PhaseAlreadyPaidException();
  // ... lógica análoga a finishMatchAndScore con audit antes/después
}
```

**Función pura `classifyOutcome` (testeable):**

```typescript
function classifyOutcome(p: { scoreHome: number, scoreAway: number },
                        rh: number, ra: number): OutcomeType {
  if (p.scoreHome === rh && p.scoreAway === ra) return 'EXACT';
  const predDiff = p.scoreHome - p.scoreAway;
  const realDiff = rh - ra;
  if (predDiff === 0 && realDiff === 0) return 'DRAW_DIFFERENT';
  if (Math.sign(predDiff) === Math.sign(realDiff)) {
    return predDiff === realDiff ? 'WINNER_AND_DIFF' : 'WINNER_ONLY';
  }
  return 'MISS';
}
```

**Recálculo:** endpoint admin `POST /admin/matches/:id/recalculate`. Bloqueado si `PhaseWinner.prizeStatus === 'PAID'` para la fase del match (fase ya cerrada con premio entregado = inmutable).

### 6.4 Transición entre fases (eliminatorias)

Lógica **semi-automática** con override del admin. **Único trigger:** `phaseService.maybeClosePhase(phase)` invocado al final de `finishMatchAndScore` (no hay cron paralelo). Esto evita la race condition de doble creación de `PhaseWinner`.

**`maybeClosePhase(phase)`:**

```typescript
async maybeClosePhase(phase: Phase) {
  const pending = await prisma.match.count({
    where: { phase, status: { not: 'FINISHED' } },
  });
  if (pending > 0) return;

  // Idempotente: si ya existe PhaseWinner, salir
  const existing = await prisma.phaseWinner.findUnique({ where: { phase } });
  if (existing) return;

  // Calcular ganador de la fase con criterios de desempate
  const winner = await this.computePhaseWinner(phase);

  await prisma.$transaction(async (tx) => {
    await tx.phaseWinner.create({
      data: { phase, userId: winner.userId, pointsEarned: winner.points },
    });
    await tx.auditLog.create({
      data: { action: 'phase.closed', entity: 'phase', entityId: phase, changes: { winner } },
    });
  });

  // Populate la siguiente fase
  if (phase === 'GROUPS')   await this.populateRound32Matches();
  if (phase === 'ROUND_32') await this.populateRound16Matches();
  // ... etc

  // Notificar al ganador
  await this.notificationsQueue.add('phase-winner', { phase, userId: winner.userId });
}
```

**`populateRound32Matches()`** (y análogos):
- Lee tabla de posiciones de cada grupo desde los `Match.score*`
- Determina los 32 clasificados según reglas FIFA 2026
- Asigna `homeTeamId`/`awayTeamId` a cada `Match` de `phase=ROUND_32`
- Setea `predictionsOpenAt = now()` → habilita carga en frontend

**Override del admin:** endpoint `PUT /admin/matches/:id` permite asignar equipos manualmente si la lógica falla (descalificación, criterio raro de FIFA). Queda en `audit_logs` con action `match.team_assigned`.

### 6.5 Webhook MP con idempotencia y firma

**Setup en `main.ts`:** la app se levanta con `rawBody: true` (NestJS expone `req.rawBody` como `Buffer`). El controller del webhook usa `@Req() req: RawBodyRequest<Request>` y pasa `req.rawBody` al verificador, NO el body parseado. Si la firma falla, devuelve 401 inmediatamente.

**Firma MP (esquema oficial):** el header `x-signature` viene como `ts=TIMESTAMP,v1=HEX_HASH`. El manifest es `id:DATA_ID;request-id:REQUEST_ID;ts:TIMESTAMP;` (no el body completo). HMAC-SHA256 con `MP_WEBHOOK_SECRET`. Comparación constant-time.

```typescript
@Public()
@Post('webhook')
async handleWebhook(
  @Req() req: RawBodyRequest<Request>,
  @Body() body: any,
  @Headers('x-signature') signature: string,
  @Headers('x-request-id') requestId: string,
) {
  // 1. Firma sobre dataId + requestId + ts (no sobre body)
  this.checkoutProvider.verifyWebhookSignature({
    signatureHeader: signature,
    requestId,
    dataId: body?.data?.id,
  });

  // 2. Solo procesamos type=payment
  if (body.type !== 'payment') return { received: true };

  // 3. Resolver el pago en MP
  const mpPayment = await this.checkoutProvider.getPayment(body.data.id);
  const newStatus = MP_STATUS_MAP[mpPayment.status];

  // 4. Update con guard atómico (resuelve race condition de webhooks dup)
  let didTransition = false;
  await prisma.$transaction(async (tx) => {
    const local = await tx.payment.findFirst({
      where: { mpPreferenceId: mpPayment.preferenceId },
    });
    if (!local) {
      this.logger.error({ mpId: body.data.id }, 'Payment not found locally');
      return;
    }

    // Update con condición de status — si race, el segundo update afecta 0 rows
    const result = await tx.payment.updateMany({
      where: {
        id: local.id,
        status: { in: ['PENDING'] }, // solo transicionar desde PENDING
      },
      data: {
        status: newStatus,
        mpPaymentId: String(mpPayment.id),
        mpRawData: mpPayment as unknown as Prisma.InputJsonValue,
        payerEmail: mpPayment.payer?.email ?? null,
        payerName: mpPayment.payer?.first_name ?? null,
        paidAt: newStatus === 'APPROVED' ? new Date() : null,
        refundedAt: newStatus === 'REFUNDED' ? new Date() : null,
      },
    });
    if (result.count === 0) return; // idempotente: ya transicionó
    didTransition = true;

    if (newStatus === 'APPROVED') {
      // Recuperar el token plano desde la metadata de la preferencia MP
      const tokenPlain = mpPayment.metadata?.completion_token as string | undefined;

      // Notification con upsert (no falla si ya existe por dedup)
      await tx.notification.upsert({
        where: { dedupKey: `recovery:${local.id}` },
        create: {
          toAddress: mpPayment.payer?.email ?? null,
          type: 'REGISTRATION_PENDING_RECOVERY',
          title: 'Tu inscripción está casi lista',
          message: tokenPlain
            ? `Completá tu registro: ${env.FRONTEND_URL}/completar-registro?token=${tokenPlain}`
            : 'Tu pago se confirmó pero hay un problema técnico para generar el link. Te contactará el admin del club.',
          channel: 'EMAIL',
          dedupKey: `recovery:${local.id}`,
        },
        update: {}, // no-op si ya existe
      });

      // Si MP no devolvió email del payer → alerta inmediata al admin (no podemos mandar magic link)
      if (!mpPayment.payer?.email) {
        await this.adminAlertsService.notify({
          type: 'PAYMENT_NO_EMAIL',
          message: `Pago ${local.id} aprobado sin email de payer. ID MP: ${mpPayment.id}. Contactá al usuario manualmente.`,
        });
      }
    }
  });

  // 5. POST-COMMIT (jobs y alertas que NO deben ser parte de la TX del webhook)
  if (didTransition && newStatus === 'APPROVED') {
    // Delayed alert: si en 2hs el payment.completedAt sigue null → WhatsApp al admin
    await this.notificationsQueue.add(
      'admin-orphan-alert',
      { paymentId: body.data.id },
      { delay: 2 * 3600 * 1000, jobId: `orphan-alert:${body.data.id}` },
    );
  }
  if (didTransition && newStatus === 'REFUNDED') {
    await this.adminAlertsService.notify({
      type: 'CHARGEBACK',
      message: `Chargeback/refund recibido: payment MP ${body.data.id}. Decidí qué hacer manualmente.`,
    });
  }

  return { received: true };
}
```

**Manejo del `completionToken` (plano vs hash):**

El token plano nunca queda persistido en nuestra BD. El mecanismo escogido es **embedderlo en `metadata.completion_token` de la preferencia MP** al crear el pago — esto lo hace roundtrippear hasta el webhook sin necesidad de Redis ni almacenamiento adicional.

Flujo concreto:

1. `POST /payments/init`:
   - `tokenPlain = crypto.randomBytes(32).toString('hex')`
   - `tokenHash = sha256(tokenPlain)`
   - Crea `Payment { completionTokenHash: tokenHash, tokenExpiresAt: now() + 7 días }`
   - Crea preferencia MP con:
     - `metadata: { completion_token: tokenPlain, payment_id: payment.id }`
     - `back_urls.success: ${FRONTEND_URL}/inscripcion/success?token=${tokenPlain}`
     - `external_reference: payment.id`
   - Devuelve `initPoint` al frontend
2. Usuario paga → MP redirige a `back_urls.success?token=...` con el plano en la URL
3. Si el usuario cierra el browser antes del redirect, el webhook llega y el handler lee el plano de `mpPayment.metadata.completion_token` para armar el email del magic link
4. `POST /auth/complete-registration` recibe el plano del frontend, calcula `sha256(plano)`, busca `Payment by completionTokenHash`

Riesgo asumido: el plano vive en los registros de MP (metadata visible en su dashboard). En el threat model esto es aceptable porque (a) la metadata está scoped al payment, (b) si alguien compromete la cuenta MP del club, el daño es ya mayor que un magic link, (c) la hash en BD es la única autoridad para validar el token.

**Interface agnóstica del provider de checkout:**

```typescript
// shared/checkout/checkout.provider.ts
export interface CheckoutProvider {
  createPreference(params: CreatePreferenceParams): Promise<{ id: string; initPoint: string }>;
  getPayment(externalId: string): Promise<ProviderPayment>;
  verifyWebhookSignature(params: { signatureHeader: string; requestId: string; dataId: string }): void;
}
```

Implementaciones:
- `MercadoPagoCheckoutProvider` (producción)
- `MockCheckoutProvider` (tests E2E)

## 7. Infraestructura

### 7.1 Cache (Redis vía `@nestjs/cache-manager`)

| Key | TTL | Invalidación |
|-----|-----|--------------|
| `leaderboard:global:page:{n}` | 60s | Al cargar resultado |
| `leaderboard:phase:{phase}:page:{n}` | 60s | Igual |
| `matches:upcoming` | 5 min | Al editar un match |
| `scoring:rules` | 1h | Al editar `ScoringRule`/`PhaseMultiplier` |
| `app-config` | 10 min | Al editar AppConfig |

Cache es aceleración, no verdad. Si Redis cae, queries van directo a Postgres.

### 7.2 Colas (BullMQ)

Una cola: `notifications`. Workers procesan según el job name.

```typescript
{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
```

**Patrón outbox event-driven (no polling):**

1. En la misma TX donde se crea la `Notification` (vía `tx.notification.create` o `upsert`), también se invoca `notificationsQueue.add('send-notification', { notificationId })` — pero **fuera del TX, después del commit**, vía un mecanismo `runOnCommit`. Si el commit falla, no se encola; si encolar falla después del commit, hay un cron de respaldo (cada 5 min) que detecta `Notification` con `status=PENDING` sin job pendiente y las re-encola.
2. El worker recibe el job, lee la `Notification` por id, intenta enviar (WhatsApp/email), y actualiza `status` a `SENT` o `FAILED`.
3. El uso de `dedupKey` único garantiza que llamadas duplicadas a `notification.upsert` no creen filas duplicadas.

Jobs principales:

| Job name | Payload | Trigger |
|----------|---------|---------|
| `send-notification` | `{ notificationId }` | Cualquier `Notification.create` |
| `leaderboard.refresh` | `{}` | Post-commit de `finishMatchAndScore` |
| `match-result` | `{ matchId }` | Post-commit de `finishMatchAndScore` |
| `phase-winner` | `{ phase, userId }` | `maybeClosePhase` |
| `admin-orphan-alert` | `{ paymentId }` | Webhook APPROVED, delayed 2hs |
| `match-reminders` | `{}` | Cron cada 15 min |
| `auto-lock-matches` | `{}` | Cron cada 1 min |
| `daily-orphan-summary` | `{}` | Cron diario 9am hora Argentina |
| `cleanup-expired-tokens` | `{}` | Cron diario 4am hora Argentina |

### 7.3 Cron tasks

| Tarea | Frecuencia | Descripción |
|-------|------------|-------------|
| Auto-lock matches | Cada 1 min | `status=LOCKED` para matches con `predictionsLockAt < now()` y status SCHEDULED |
| Match reminders | Cada 15 min | Detecta partidos que arrancan en ~2hs y encola WhatsApp a usuarios sin predicción |
| Orphan cleanup | Diario 3am | Marca como ORPHANED payments APPROVED + sin user + token expirado |
| Admin orphan summary | Diario 9am | WhatsApp al admin con resumen de huérfanos del día anterior |
| Token cleanup | Diario 4am | Borra `RefreshToken` y `PasswordReset` expirados |
| Recovery alert (delayed) | 2hs post-webhook | Si `payment.completedAt` sigue null → WhatsApp al admin |

## 8. Seguridad

### 8.1 Autenticación

| Aspecto | Decisión |
|---------|----------|
| Hash de password | bcrypt, `saltRounds=12` |
| Access token | JWT, 15 min, header `Authorization: Bearer` |
| Refresh token | JWT 7 días, cookie `httpOnly + Secure + SameSite=Strict` |
| Persistencia refresh | `refresh_tokens` con `revokedAt` para logout efectivo |
| Recovery password | Token en `password_resets`, mandado por WhatsApp del usuario, expira 30 min |
| Activación de usuarios manuales | Admin tipea password directamente (decisión explícita del cliente) |

### 8.2 Autorización

- `JwtAuthGuard` global; endpoints públicos marcados con `@Public()`
- `RolesGuard` con `@Roles('ADMIN')` en endpoints `/admin/*`
- **Reglas críticas:**
  - Solo admins cargan resultados de partidos
  - Solo admins marcan pagos manualmente
  - Solo el dueño modifica sus predicciones
  - Nadie modifica predicciones cuyo `predictionsLockAt` ya pasó (server-side)

### 8.3 Rate limiting (`@nestjs/throttler` con storage Redis)

| Endpoint | Límite |
|----------|--------|
| `POST /auth/login` | 5/min por IP, 5/15min por DNI |
| `POST /auth/forgot-password` | 3/h por IP |
| `POST /auth/complete-registration` | 5/h por IP |
| `POST /payments/init` | 5/h por IP |
| `POST /payments/webhook` | sin límite (gobernado por MP) |
| Resto | 100/min por IP |

### 8.4 Validación

- **DTOs HTTP:** class-validator + class-transformer + ValidationPipe global
- **Webhook MP body:** Zod (es payload externo, no DTO nuestro)
- **Env vars:** Zod en `config/env.ts`, falla rápido al startup

### 8.5 Headers y CORS

- Helmet con CSP configurado
- CORS solo permite `FRONTEND_URL`, `credentials: true`
- HSTS forzado en producción
- `NestFactory.create(AppModule, { rawBody: true })` para que el webhook MP pueda verificar firma sobre `req.rawBody`

### 8.6 Anti-bot en endpoint público

`POST /payments/init` es público y cada llamada pega contra MP API (consume rate limit de la cuenta del club). Defensa en capas:

- **Cloudflare Turnstile** (gratis, privacy-friendly) en el frontend antes del POST. El backend valida el token de Turnstile contra la API de Cloudflare como gate previo a cualquier acción.
- **Throttler** 5/h por IP como segunda barrera
- **Honeypot field** opcional en el form

Esto evita que un atacante consuma cuota MP del club spameando creación de preferencias.

### 8.7 Excepciones de dominio

```typescript
PredictionLockedException        // 400 — partido cerrado
MatchNotFinishedException        // 400 — recálculo sin resultado
PhaseAlreadyPaidException        // 409 — fase con premio pagado
DniAlreadyExistsException        // 409
WhatsappAlreadyExistsException   // 409
InvalidCompletionTokenException  // 404
PaymentNotApprovedException      // 400
```

## 9. Auditoría y observabilidad

### 9.1 Audit interceptor

Decorator `@Audit({ action, entity })` aplicado a endpoints sensibles. Interceptor inserta `AuditLog` async (no bloquea respuesta) con `before`/`after`.

**Acciones obligatoriamente auditadas:**

Cuentas y autenticación:
- `auth.login_success`, `auth.login_failed` (con DNI parcial enmascarado)
- `auth.password_reset_requested`, `auth.password_reset_completed`
- `auth.registration_completed` (flujo público post-pago)
- `user.created_manually` (alta manual del admin)
- `user.banned`, `user.unbanned`, `user.deactivated`
- `user.password_changed_by_admin`
- `user.promoted_to_admin`

Predicciones:
- `prediction.created`, `prediction.updated` (registro de cambios pre-lock)
- `special_prediction.created`, `special_prediction.updated`

Partidos y fases:
- `match.finished`, `match.recalculated`, `match.team_assigned`, `match.kickoff_updated`, `match.postponed`, `match.cancelled`
- `phase.closed`, `phase_winner.created`, `phase_winner.prize_paid`

Pagos:
- `payment.confirmed_manually`, `payment.marked_orphaned`, `payment.refund_received`

Configuración:
- `config.scoring_rule_updated`, `config.phase_multiplier_updated`, `config.special_prize_rule_updated`, `config.app_config_updated`

### 9.2 Logging

- Pino structured JSON con request-id
- Redactor de campos sensibles: `password`, `*.token`, `*.cardNumber`, `*.cvv`
- Niveles: `error` (Sentry), `warn`, `info`, `debug`

### 9.3 Errores

- `GlobalExceptionFilter` captura todo lo no controlado
- Sentry para 5xx, ignora 4xx esperados
- Healthcheck `GET /health` con check DB + Redis

### 9.4 Admin alerts (WhatsApp al admin)

`AdminAlertsService` invocado desde:

| Evento | Cuándo | Mensaje |
|--------|--------|---------|
| Pago sin registro completado | 2hs post-webhook (delayed job) | Email del pagador + ID de pago |
| Pagos huérfanos del día | Cron diario 9am | Resumen contable |
| Error backend crítico | GlobalExceptionFilter en endpoints sensibles | Sentry link |
| DNI duplicado al completar | Inmediato | DNI + ID de pago |
| Chargeback / refund | Webhook REFUNDED | Usuario + monto, sin auto-acción |

`toAddress` es el WhatsApp del admin (env `ADMIN_WHATSAPP_NUMBER`).

## 10. Testing

| Capa | Herramienta | Cobertura |
|------|-------------|-----------|
| Unitarios | Jest | Funciones puras: `classifyOutcome`, `calculatePhaseWinner`, validators de SpecialPrediction, parsers de webhook |
| Integración | Jest + Testcontainers (Postgres real) | Services + repositorios contra BD real |
| E2E | Jest + Supertest + `MockCheckoutProvider` | Flujos críticos completos |

**Flujos E2E mínimos:**
1. Registro público completo: init payment → mock webhook → completar registro → login
2. Carga de predicción → admin marca match FINISHED → puntos calculados → leaderboard refleja
3. Cierre de fase: todos los matches FINISHED → PhaseWinner creado → notificación encolada
4. Admin crea usuario manual → usuario logea → carga predicción
5. Recálculo de resultado → audit log con before/after

## 11. Configuración por entorno

```typescript
// config/env.ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
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

  FRONTEND_URL: z.string().url(),
  API_URL: z.string().url(),

  SENTRY_DSN: z.string().url().optional(),
});
```

App falla rápido al startup si falta cualquier env crítica.

**Notas:**
- `MP_PUBLIC_KEY` no se usa en este backend (es para el frontend SDK), pero se valida acá por conveniencia operativa.
- **Zona horaria del proceso:** todos los cron specs (`'0 3 * * *'`, etc.) se interpretan en la TZ del proceso. El contenedor del backend corre con `TZ=America/Argentina/Buenos_Aires` (env var del Docker) para que "3am" signifique 3am hora Argentina, no UTC. Las fechas en BD siguen siendo UTC; solo los crons se interpretan en zona local.
- Falta opcional: `TURNSTILE_SECRET_KEY` para validar el captcha de Cloudflare en el endpoint `/payments/init`.

## 12. Deployment

- **Plataforma:** Dokploy en VPS propio
- **Servicios:**
  - `prode-api` (puerto 3001)
  - `prode-postgres` (con backup diario a Backblaze B2)
  - `prode-redis`
- **Single instance:** suficiente para <200 users
- **HTTPS:** Let's Encrypt automático
- **Dominio:** `api.prode.tirofederal.com`
- **Variables de entorno:** panel Dokploy, no en repo
- **Backups BD:** diario, retención 30 días en B2

## 13. Decisiones explícitas tomadas durante el brainstorming

1. **Lanzamiento 100% completo** — sin presión de tiempo, prioridad robustez sobre velocidad
2. **Sistema de puntos flexibilidad nivel A** — valores editables (`ScoringRule`/`PhaseMultiplier`), estructura fija
3. **Predicciones de eliminatorias se habilitan al asignar equipos** (no abstractas sobre placeholders)
4. **Sin Repository pattern obligatorio** — PrismaService directo en services, salvo Leaderboard y MatchProgression
5. **Sin auto-registro vía form clásico** — solo dos vías: MP público + admin manual
6. **MercadoPago solo con acreditación inmediata** — excluir Pago Fácil/Rapipago/ATM
7. **Sin email del usuario** — solo trabajamos con el `payerEmail` que da MP automáticamente
8. **Admin tipea password manualmente** y la pasa por WhatsApp (decisión explícita del cliente, *"es solo un prode"*). **Disclaimer asumido:** el cliente acepta el riesgo de que passwords transmitidas por WhatsApp queden en el historial del chat de ambas partes; las contraseñas no expiran ni fuerzan cambio en primer login.
9. **Materialized view refrescada async post-commit** vía BullMQ job dedupicado. La TX del scoring NO incluye el refresh — evita el lock `SHARE UPDATE EXCLUSIVE` y los problemas con timeout de Prisma TX.
10. **Transición entre fases semi-automática con override admin**
11. **`CheckoutProvider` interface agnóstica** del SDK de MP, con mock para tests
12. **WhatsApp al admin para eventos críticos** (orphans, errores, chargebacks, DNI dup)
13. **Sin lógica de auto-disable en refunds/chargebacks** — solo alerta al admin
14. **Auditoría obligatoria** en operaciones que mueven puntos / dinero / cuentas
15. **UTC en BD, conversión a `America/Argentina/Buenos_Aires` en frontend**
16. **Sin `User.isPaid`** — la existencia del User en BD es la prueba de pago
17. **Sin `PendingRegistration` separado** — `Payment` con `userId=null` cumple ese rol

## 14. Casos edge cubiertos

| Caso | Cómo se maneja |
|------|----------------|
| Webhook llega 2 veces (MP reintenta) | Idempotente por `mpPaymentId` + check de estado actual |
| Webhook llega antes que el redirect | OK — el redirect lee el payment ya APPROVED |
| Usuario cierra browser post-pago | Email al `payerEmail` con magic link + WhatsApp al admin a las 2hs |
| Pago aprobado, usuario nunca vuelve | Cron diario marca ORPHANED, admin resuelve manualmente |
| DNI duplicado al completar registro | 409, audit log, alerta WhatsApp al admin |
| Resultado cargado mal | Endpoint `recalculate` con audit log before/after |
| Resultado cambia post premio pagado | Bloqueado — requiere intervención manual con justificación |
| Refund desde MP / chargeback | Solo alerta al admin, sin auto-acción |
| Predicción justo en el lock | Validación server-side `now() < predictionsLockAt`, no se confía en frontend |
| Cron auto-lock falla | Defensa en profundidad: el check de `predictionsLockAt` en cada POST de prediction |
| MP envía webhooks que no son `payment` | Ignorados, devuelve 200 |
| Redis cae | Cache se saltea, queries directos a Postgres (degradación graceful) |

## 15. Lo que queda fuera de este design (futuro / post-MVP)

- 2FA para cuentas admin
- Permisos granulares (admin.users.read, admin.matches.write, etc.)
- Periodo de impugnación de 24hs entre admins al cargar resultado
- API automática de fixtures (Football-Data.org / API-Football)
- Múltiples instancias del backend con load balancer
- Generación de reportes PDF (Puppeteer)
- Endpoint para que el usuario solicite eliminación de sus datos (Ley 25.326)

Estos son extensiones razonables si el proyecto continúa post-Mundial.

## 16. Próximos pasos

1. ✅ Design doc aprobado por el cliente
2. → Spec review loop con `spec-document-reviewer` subagent
3. → Revisión final del cliente
4. → Generación del **plan de implementación detallado** (skill `writing-plans`) con tasks ordenadas
5. → Ejecución del plan: setup del repo, schema Prisma, módulos uno por uno
