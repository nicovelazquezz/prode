# 04 — Modelo de Datos

## Esquema Prisma completo

A continuación el `schema.prisma` listo para copiar y pegar en `prisma/schema.prisma`.

```prisma
// This is your Prisma schema file
// Learn more: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
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
}

enum PaymentMethod {
  MERCADOPAGO
  CASH
  TRANSFER
}

enum Phase {
  GROUPS
  ROUND_32        // 16avos de Final (nuevo en 2026)
  ROUND_16        // Octavos
  QUARTERS
  SEMIS
  THIRD_PLACE
  FINAL
}

enum MatchStatus {
  SCHEDULED       // programado, predicciones abiertas
  LOCKED          // cierre de predicciones, partido por iniciar
  IN_PROGRESS     // en juego (informativo)
  FINISHED        // finalizado, resultado cargado, puntos calculados
  POSTPONED       // pospuesto (raro)
  CANCELLED       // cancelado (rarísimo)
}

enum Confederation {
  CONMEBOL
  UEFA
  CONCACAF
  AFC
  CAF
  OFC
}

// ─── USUARIOS Y AUTENTICACIÓN ─────────────────────────────

model User {
  id                  String              @id @default(cuid())
  dni                 String              @unique
  firstName           String
  lastName            String
  whatsapp            String              // formato: 5492914xxxxxxx
  email               String?             @unique
  passwordHash        String
  role                Role                @default(USER)
  status              UserStatus          @default(ACTIVE)
  
  // Pago de inscripción
  isPaid              Boolean             @default(false)
  paidAt              DateTime?
  paidMethod          PaymentMethod?
  paidAmount          Decimal?            @db.Decimal(10, 2)
  
  // Notificaciones
  whatsappOptIn       Boolean             @default(true)
  
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  lastLoginAt         DateTime?
  
  // Relaciones
  predictions         Prediction[]
  specialPrediction   SpecialPrediction?
  payments            Payment[]
  refreshTokens       RefreshToken[]
  passwordResets      PasswordReset[]
  phaseWins           PhaseWinner[]
  leaguesOwned        League[]            @relation("LeagueOwner")
  leagueMemberships   LeagueMembership[]
  notifications       Notification[]
  
  @@index([dni])
  @@index([whatsapp])
  @@index([isPaid])
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
  @@index([token])
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
  
  @@index([token])
  @@map("password_resets")
}

// ─── SELECCIONES Y JUGADORES ──────────────────────────────

model Team {
  id              String          @id @default(cuid())
  fifaCode        String          @unique     // ARG, BRA, USA, MEX, etc
  name            String                      // "Argentina", "Brasil"
  shortName       String                      // "ARG", "BRA"
  flagUrl         String                      // URL al SVG de la bandera
  confederation   Confederation
  groupCode       String?                     // "A", "B", ... "L" (en grupos)
  
  // Stats opcionales para mostrar
  fifaRanking     Int?
  
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  
  matchesAsHome   Match[]         @relation("HomeTeam")
  matchesAsAway   Match[]         @relation("AwayTeam")
  championPicks   SpecialPrediction[] @relation("ChampionPick")
  runnerUpPicks   SpecialPrediction[] @relation("RunnerUpPick")
  thirdPlacePicks SpecialPrediction[] @relation("ThirdPlacePick")
  
  @@index([groupCode])
  @@index([fifaCode])
  @@map("teams")
}

model Player {
  id              String      @id @default(cuid())
  fullName        String
  teamId          String?
  team            Team?       @relation(fields: [teamId], references: [id])
  position        String?     // "Forward", "Midfielder", etc
  
  topScorerPicks  SpecialPrediction[] @relation("TopScorerPick")
  
  @@index([fullName])
  @@map("players")
}

// El modelo Player se usa solo para el goleador del torneo.
// Si querés simplificar al máximo, se puede usar un campo string libre en
// SpecialPrediction y resolverlo manualmente, pero tener una tabla 
// permite autocomplete en el frontend.

// ─── PARTIDOS ─────────────────────────────────────────────

model Match {
  id              String          @id @default(cuid())
  matchNumber     Int             @unique     // 1 a 104, número oficial FIFA
  phase           Phase
  groupCode       String?                     // "A".."L" si es de grupos
  
  homeTeamId      String?                     // null si aún no se conoce (etapa eliminatoria)
  homeTeam        Team?           @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeamId      String?
  awayTeam        Team?           @relation("AwayTeam", fields: [awayTeamId], references: [id])
  
  // Placeholders para etapas eliminatorias
  homeTeamLabel   String?                     // "Ganador 1ro Grupo A"
  awayTeamLabel   String?                     // "Mejor 3ro 1"
  
  kickoffAt       DateTime                    // fecha y hora del partido
  predictionsLockAt DateTime                  // cuándo se cierran las predicciones (kickoff - 10 min)
  
  status          MatchStatus     @default(SCHEDULED)
  
  // Resultado (al terminar el partido)
  scoreHome       Int?
  scoreAway       Int?
  finishedAt      DateTime?
  
  // Sede
  venue           String?
  city            String?
  country         String?
  
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  
  predictions     Prediction[]
  
  @@index([phase])
  @@index([status])
  @@index([kickoffAt])
  @@index([groupCode])
  @@map("matches")
}

// ─── PREDICCIONES ─────────────────────────────────────────

model Prediction {
  id              String          @id @default(cuid())
  userId          String
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  matchId         String
  match           Match           @relation(fields: [matchId], references: [id], onDelete: Cascade)
  
  scoreHome       Int
  scoreAway       Int
  
  // Cálculo de puntos (poblado al cerrar el partido)
  pointsEarned    Int             @default(0)
  basePoints      Int             @default(0)         // antes de multiplicador
  multiplier      Decimal         @default(1) @db.Decimal(3, 1)
  evaluatedAt     DateTime?
  
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  
  @@unique([userId, matchId])
  @@index([userId])
  @@index([matchId])
  @@index([userId, matchId])
  @@map("predictions")
}

model SpecialPrediction {
  id              String          @id @default(cuid())
  userId          String          @unique
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  championTeamId      String?
  championTeam        Team?       @relation("ChampionPick", fields: [championTeamId], references: [id])
  runnerUpTeamId      String?
  runnerUpTeam        Team?       @relation("RunnerUpPick", fields: [runnerUpTeamId], references: [id])
  thirdPlaceTeamId    String?
  thirdPlaceTeam      Team?       @relation("ThirdPlacePick", fields: [thirdPlaceTeamId], references: [id])
  
  topScorerId         String?
  topScorer           Player?     @relation("TopScorerPick", fields: [topScorerId], references: [id])
  topScorerName       String?     // fallback si no se quiere FK
  
  totalGoals          Int?        // pronóstico de cantidad total de goles
  
  // Puntos
  championPoints      Int         @default(0)
  runnerUpPoints      Int         @default(0)
  thirdPlacePoints    Int         @default(0)
  topScorerPoints     Int         @default(0)
  totalGoalsPoints    Int         @default(0)
  totalPoints         Int         @default(0)
  evaluatedAt         DateTime?
  
  lockedAt            DateTime?   // se setea al primer kickoff
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt
  
  @@map("special_predictions")
}

// ─── PREMIOS Y GANADORES ─────────────────────────────────

model PhaseWinner {
  id              String          @id @default(cuid())
  phase           Phase
  userId          String
  user            User            @relation(fields: [userId], references: [id])
  pointsEarned    Int                                 // puntos ganados solo en esa fase
  prizeAmount     Decimal?        @db.Decimal(10, 2)
  prizeStatus     String          @default("pending") // "pending", "paid"
  prizePaidAt     DateTime?
  awardedAt       DateTime        @default(now())
  notes           String?
  
  @@unique([phase])
  @@index([userId])
  @@map("phase_winners")
}

// ─── PAGOS ────────────────────────────────────────────────

model Payment {
  id                  String          @id @default(cuid())
  userId              String
  user                User            @relation(fields: [userId], references: [id])
  
  amount              Decimal         @db.Decimal(10, 2)
  method              PaymentMethod
  status              PaymentStatus   @default(PENDING)
  
  // MercadoPago
  mpPreferenceId      String?
  mpPaymentId         String?         @unique
  mpExternalReference String?
  mpRawData           Json?           // payload completo del webhook
  
  // Manual
  receivedBy          String?         // ID del admin que confirmó
  notes               String?
  
  paidAt              DateTime?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  
  @@index([userId])
  @@index([mpPaymentId])
  @@index([status])
  @@map("payments")
}

// ─── MINI-LIGAS ───────────────────────────────────────────

model League {
  id              String              @id @default(cuid())
  name            String
  description     String?
  inviteCode      String              @unique  // 6 caracteres alfanuméricos
  ownerId         String
  owner           User                @relation("LeagueOwner", fields: [ownerId], references: [id])
  isPublic        Boolean             @default(false)
  maxMembers      Int                 @default(50)
  createdAt       DateTime            @default(now())
  
  members         LeagueMembership[]
  
  @@index([inviteCode])
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
  @@index([leagueId])
  @@map("league_memberships")
}

// ─── NOTIFICACIONES ───────────────────────────────────────

model Notification {
  id              String      @id @default(cuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  type            String      // "match_reminder", "phase_winner", "ranking_change", "payment_confirmed"
  title           String
  message         String
  channel         String      // "whatsapp", "in_app"
  status          String      @default("pending")  // "pending", "sent", "failed"
  sentAt          DateTime?
  metadata        Json?
  createdAt       DateTime    @default(now())
  
  @@index([userId])
  @@index([status])
  @@map("notifications")
}

// ─── CONFIGURACIÓN GLOBAL ─────────────────────────────────

model AppConfig {
  key             String      @id
  value           String      @db.Text
  description     String?
  updatedAt       DateTime    @updatedAt
}

// Ejemplos de keys:
// "inscripcion_precio" -> "5000"
// "inscripcion_cierre" -> "2026-06-11T19:00:00-03:00"
// "pozo_distribucion_top1" -> "0.25"
// "pozo_distribucion_top2" -> "0.12"
// "pozo_distribucion_top3" -> "0.08"
// "pozo_distribucion_fase" -> "0.05"
// "pozo_club" -> "0.20"
// "pozo_reserva" -> "0.05"

// ─── AUDITORÍA ────────────────────────────────────────────

model AuditLog {
  id              String      @id @default(cuid())
  userId          String?                                 // quien realizó la acción (null si es sistema)
  action          String                                  // "match.finished", "user.payment_confirmed", etc.
  entity          String                                  // "match", "user", "prediction"
  entityId        String?
  changes         Json?                                   // before/after
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime    @default(now())
  
  @@index([action])
  @@index([entity, entityId])
  @@index([userId])
  @@map("audit_logs")
}
```

## Diagrama de relaciones (texto)

```
User ─┬─ predictions ───── Prediction ───── Match ─┬─ homeTeam ── Team
      │                                            └─ awayTeam ── Team
      ├─ specialPrediction ── SpecialPrediction
      ├─ payments ──── Payment
      ├─ phaseWins ─── PhaseWinner
      ├─ leaguesOwned ── League ── LeagueMembership ── User
      ├─ refreshTokens ─── RefreshToken
      ├─ passwordResets ── PasswordReset
      └─ notifications ─── Notification

Team ─── Player ── topScorerPicks ── SpecialPrediction
```

## Decisiones de diseño explicadas

### Por qué `dni` no es la PK

Aunque el DNI es único, usar `cuid()` como PK tiene ventajas:
- DNIs pueden cambiar (rarísimo, pero pasa)
- IDs en URLs no exponen datos personales
- Joins más eficientes con strings cortos
- Fácil migración futura si cambia la estrategia de identidad

### Por qué `Decimal` para montos

`Decimal(10, 2)` evita los problemas clásicos de `Float` con dinero. 10 dígitos totales, 2 decimales: hasta $99.999.999,99.

### Por qué `predictionsLockAt` separado de `kickoffAt`

Permite cerrar predicciones antes del kickoff (típicamente 10 minutos antes) sin tocar el horario del partido. Si la FIFA reprograma, basta actualizar `kickoffAt` y recalcular `predictionsLockAt`.

### Por qué `homeTeamId` y `awayTeamId` son nullable

Las etapas eliminatorias dependen del resultado de etapas anteriores. Al inicio del Mundial sabemos los partidos de grupos, pero no el "Argentina vs ¿?" en cuartos. Los campos `homeTeamLabel` y `awayTeamLabel` permiten mostrar el partido aunque los equipos aún no se conozcan ("Ganador Grupo C" vs "Mejor 3ro 4").

### Por qué guardar `basePoints`, `multiplier` y `pointsEarned` por separado

Permite auditar el cálculo y mostrar al usuario un desglose claro: "Acertaste el resultado exacto (5 pts) × multiplicador de cuartos (3x) = 15 pts".

### Por qué `AuditLog`

Cuando manejás dinero y premios, tener trazabilidad es crítico. Si alguien dice "yo cargué el resultado correcto", el `AuditLog` lo prueba o lo desmiente.

## Seeds iniciales

El archivo `prisma/seed.ts` debe poblar:

1. **48 selecciones**: con código FIFA, nombre, bandera, confederación, grupo (cuando se conozca el sorteo)
2. **104 partidos**: con número FIFA oficial, fase, fecha, hora, sede
3. **Configuración global** en `AppConfig`
4. **Usuario admin** inicial (con password seteado por env var)
5. **Jugadores destacados** para autocomplete del goleador (los top 100 mundiales según ranking)

## Ejemplo de query típica

### Tabla de posiciones global

```typescript
const leaderboard = await prisma.user.findMany({
  where: { 
    isPaid: true,
    status: 'ACTIVE',
  },
  select: {
    id: true,
    firstName: true,
    lastName: true,
    predictions: {
      select: { pointsEarned: true },
    },
    specialPrediction: {
      select: { totalPoints: true },
    },
  },
  // Idealmente este cálculo va en una vista materializada o se computa
  // en application layer y se cachea
});

// Mejor: vista SQL pre-computada
// CREATE MATERIALIZED VIEW user_total_points AS
//   SELECT u.id, u.first_name, u.last_name,
//     COALESCE(SUM(p.points_earned), 0) + COALESCE(sp.total_points, 0) as total_points
//   FROM users u
//   LEFT JOIN predictions p ON p.user_id = u.id
//   LEFT JOIN special_predictions sp ON sp.user_id = u.id
//   WHERE u.is_paid = true AND u.status = 'ACTIVE'
//   GROUP BY u.id, sp.total_points;
```

### Cargar predicción

```typescript
// Validar que el partido no esté locked
const match = await prisma.match.findUnique({ 
  where: { id: matchId } 
});
if (new Date() >= match.predictionsLockAt) {
  throw new PredictionsLockedException();
}

// Upsert
await prisma.prediction.upsert({
  where: { 
    userId_matchId: { userId, matchId } 
  },
  update: { scoreHome, scoreAway },
  create: { userId, matchId, scoreHome, scoreAway },
});
```

## Migraciones

Usar siempre migraciones generadas (`prisma migrate dev`), nunca `prisma db push` en producción. Cada migración es una unidad versionada que se puede revisar y revertir.
