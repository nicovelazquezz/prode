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
  token       String    @unique
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
  token       String    @unique
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
  id              String      @id @default(cuid())
  phase           Phase       @unique
  userId          String
  user            User        @relation(fields: [userId], references: [id])
  pointsEarned    Int
  prizeAmount     Decimal?    @db.Decimal(10, 2)
  prizeStatus     String      @default("pending")
  prizePaidAt     DateTime?
  awardedAt       DateTime    @default(now())
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

  payerEmail          String?
  payerName           String?

  completionToken     String?         @unique
  tokenExpiresAt      DateTime?
  completedAt         DateTime?

  receivedBy          String?
  notes               String?

  paidAt              DateTime?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  @@index([userId])
  @@index([status])
  @@index([completionToken])
  @@index([mpPaymentId])
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
  toAddress       String
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

### 5.3 Materialized view de leaderboard

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

**Refresh:** `REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global` dentro de la transacción que carga el resultado de un partido.

**Acceso desde Prisma:** raw query tipada (`prisma.$queryRaw`), no es modelo Prisma.

### 5.4 Resumen de índices estratégicos

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
| `payments` | `mpPaymentId` único | Idempotencia webhook |
| `payments` | `completionToken` único | Magic link |
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
  await prisma.$transaction(async (tx) => {
    const rules = await this.scoringConfigService.getRules(); // cacheado
    const multipliers = await this.scoringConfigService.getMultipliers();

    const match = await tx.match.update({
      where: { id: matchId },
      data: { scoreHome, scoreAway, status: 'FINISHED', finishedAt: new Date() },
    });

    const predictions = await tx.prediction.findMany({ where: { matchId } });

    const updates = predictions.map(p => {
      const outcomeType = classifyOutcome(p, scoreHome, scoreAway);
      const basePoints = rules[outcomeType];
      const multiplier = multipliers[match.phase];
      const pointsEarned = Math.round(basePoints * multiplier);
      return tx.prediction.update({
        where: { id: p.id },
        data: { outcomeType, basePoints, multiplier, pointsEarned, evaluatedAt: new Date() },
      });
    });
    await Promise.all(updates);

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'match.finished',
        entity: 'match',
        entityId: matchId,
        changes: { score: { home: scoreHome, away: scoreAway } },
      },
    });

    await tx.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
  });

  await this.cacheService.invalidate('leaderboard:*');
  await this.notificationsQueue.enqueue('match-result', { matchId });
  await this.phaseService.maybeClosePhase(match.phase);
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

**Recálculo:** endpoint admin `POST /admin/matches/:id/recalculate`. Bloqueado si `PhaseWinner.prizePaidAt` ya está seteado para la fase del match.

### 6.4 Transición entre fases (eliminatorias)

Lógica **semi-automática** con override del admin.

**Al cierre de una fase:**

1. Cron / trigger detecta que todos los matches de la fase están FINISHED
2. Calcula ganador de la fase (mayor sum de `pointsEarned` en matches de esa fase)
3. Crea `PhaseWinner` y notifica al ganador
4. Si la fase alimenta a otra (GROUPS → ROUND_32), populate los matches siguientes asignando `homeTeamId`/`awayTeamId` según resultados
5. Setea `predictionsOpenAt = now()` en los matches recién pobladas → habilita carga en frontend

**Override del admin:** endpoint `PUT /admin/matches/:id` para asignar equipos manualmente si la lógica falla (ej: criterio raro de FIFA, descalificación).

### 6.5 Webhook MP con idempotencia

```typescript
@Public()
@Post('webhook')
async handleWebhook(
  @Body() body: any,
  @Headers('x-signature') signature: string,
  @Headers('x-request-id') requestId: string,
) {
  this.checkoutProvider.verifyWebhookSignature(signature, requestId, body);
  if (body.type !== 'payment') return { received: true };

  const mpPayment = await this.checkoutProvider.getPayment(body.data.id);

  await prisma.$transaction(async (tx) => {
    const local = await tx.payment.findFirst({
      where: { mpPreferenceId: mpPayment.preferenceId },
    });
    if (!local) {
      this.logger.error({ mpId: body.data.id }, 'Payment not found locally');
      return;
    }

    if (['APPROVED', 'REJECTED', 'REFUNDED'].includes(local.status)) {
      return; // idempotente
    }

    const newStatus = MP_STATUS_MAP[mpPayment.status];

    await tx.payment.update({
      where: { id: local.id },
      data: {
        status: newStatus,
        mpPaymentId: String(mpPayment.id),
        mpRawData: mpPayment,
        payerEmail: mpPayment.payer?.email,
        payerName: mpPayment.payer?.first_name,
        paidAt: newStatus === 'APPROVED' ? new Date() : null,
      },
    });

    if (newStatus === 'APPROVED') {
      await tx.notification.create({
        data: {
          toAddress: mpPayment.payer.email,
          type: 'REGISTRATION_PENDING_RECOVERY',
          title: 'Tu inscripción está casi lista',
          message: `Completá tu registro: ${env.FRONTEND_URL}/completar-registro?token=${local.completionToken}`,
          channel: 'EMAIL',
          dedupKey: `recovery:${local.id}`,
        },
      });

      // Schedule delayed alert (2hs después)
      await this.notificationsQueue.add('admin-orphan-alert', { paymentId: local.id }, { delay: 2 * 3600 * 1000 });
    }

    // Refund/chargeback: NO desactivar User automáticamente, solo alertar al admin
    if (newStatus === 'REFUNDED') {
      await this.adminAlertsService.notify({
        type: 'CHARGEBACK',
        message: `Chargeback recibido: payment ${local.id}, monto $${local.amount}`,
      });
    }
  });

  return { received: true };
}
```

**Interface agnóstica del provider de checkout:**

```typescript
// shared/checkout/checkout.provider.ts
export interface CheckoutProvider {
  createPreference(params: CreatePreferenceParams): Promise<{ id: string; initPoint: string }>;
  getPayment(externalId: string): Promise<ProviderPayment>;
  verifyWebhookSignature(signature: string, requestId: string, body: unknown): void;
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

Una cola: `notifications`. Workers procesan según `channel`.

```typescript
{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
```

Outbox simplificado: la `Notification` se crea en la TX del evento de dominio. Worker la lee, manda, actualiza status.

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

### 8.6 Excepciones de dominio

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
- `match.finished`, `match.recalculated`, `match.team_assigned`
- `phase.closed`, `phase_winner.created`, `prize.paid`
- `user.created_manually`, `user.banned`, `user.password_reset`
- `payment.confirmed_manually`, `payment.marked_orphaned`
- `config.updated` (cualquier cambio de scoring/phase/app config)

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
8. **Admin tipea password manualmente** y la pasa por WhatsApp (decisión explícita del cliente, "es solo un prode")
9. **Materialized view refrescada en TX del scoring** (volumen chico justifica consistencia inmediata)
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
