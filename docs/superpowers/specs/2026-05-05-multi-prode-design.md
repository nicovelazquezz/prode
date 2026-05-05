# Multi-prode — Design Doc

**Fecha:** 2026-05-05
**Estado:** Borrador para review
**Tipo:** Feature v1.1 sobre el sistema base
**Backend spec previa (autoridad):** `docs/superpowers/specs/2026-05-04-prode-backend-design.md`
**Frontend spec previa (autoridad):** `docs/superpowers/specs/2026-05-05-prode-frontend-design.md`

---

## 1. Contexto y motivación

### Problema

El sistema actual restringe a un usuario a tener **un solo set de predicciones**. Aunque la tabla `Payment` permite múltiples pagos por usuario (`User.id (1) → (N) Payment`), las constraints únicas en `(userId, matchId)` de `Prediction` y en `userId` de `SpecialPrediction` impiden que un mismo usuario juegue múltiples "boletas" con predicciones distintas.

Pagar 2 veces con el mismo DNI hoy no agrega ningún valor: el segundo `Payment` queda como registro contable pero no genera más entradas al ranking.

### Oportunidad

En Prodes argentinos consolidados (Mi Bolada, Comunio, etc.) el patrón estándar es permitir **múltiples boletas por persona**, con motivos:
- Estrategias distintas (una boleta optimista, una conservadora, una "raro")
- Hedging (cubrirse pagando 2-3 escenarios)
- Familiares: una persona paga "la del marido", "la de la nuera"
- Más recaudación para el club (objetivo principal del Prode)

Estimación conservadora: si el 15% de los inscriptos paga una segunda entrada, **+15% de recaudación**.

### Alcance

- Permitir hasta **5 entradas por usuario** (configurable desde admin via `AppConfig.max_entries_per_user`)
- Cada entrada tiene su propio set independiente de predicciones de partidos + predicción especial
- Una entrada puede unirse a una mini-liga (no el usuario)
- El leaderboard rankea por entrada, no por usuario
- Los premios se asignan a la entrada ganadora; si una persona tiene 2 entradas y ambas están en el podio, gana 2 premios
- UX: selector arriba en el header del `(app)` con dropdown de entradas + CTA "Crear otro prode" que dispara el flujo de pago inline
- **Precio:** mismo que la primera entrada, leído de `AppConfig.inscripcion_precio` (hoy $10.000). NO hay precio escalonado.

### Fuera de alcance (post v1.1)

- Transferir entradas entre usuarios
- Renombrar entradas después de creadas (alias) más de N veces
- Comprar entradas para regalar a otra persona
- Distribuir el premio entre múltiples entradas del mismo usuario si ambas ganan (cada una se considera independiente)

---

## 2. Modelo de datos

### 2.1 Modelo nuevo: `Entry`

```prisma
model Entry {
  id                  String              @id @default(cuid())
  userId              String
  user                User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Vinculo 1-1 al pago que originó esta entry. NOT NULL en filas finales —
  // las entries se crean post-pago aprobado, nunca antes.
  // **Decisión consciente con plan de migración futura:** si en v1.2+
  // querés soportar múltiples Payments por Entry (refund + repay,
  // ajuste manual del admin), migrás a una tabla intermedia
  // `EntryPayment(entryId, paymentId, role)`. Hoy YAGNI.
  paymentId           String              @unique
  payment             Payment             @relation(fields: [paymentId], references: [id])

  // Estado de la entry. Reservado para v1.2+ donde podríamos anular
  // entries por chargeback/refund. Hoy todo es ACTIVE.
  status              EntryStatus         @default(ACTIVE)

  // Alias opcional para distinguir entradas en la UI ("Mi prode optimista",
  // "El de papá"). Null hasta que el usuario elija uno.
  alias               String?

  // Posición numérica del entry dentro del usuario, 1-N. Útil para UI
  // ("Mi prode #1", "Mi prode #2") sin tener que ordenar por createdAt.
  // Asignada al crear, monotónicamente creciente, no se reusa al borrar
  // (no soportamos borrado por ahora de todos modos).
  position            Int

  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  // Relaciones que antes estaban en User
  predictions         Prediction[]
  specialPrediction   SpecialPrediction?
  phaseWins           PhaseWinner[]
  leagueMemberships   LeagueMembership[]

  @@unique([userId, position])
  @@index([userId])
  @@map("entries")
}

enum EntryStatus {
  ACTIVE
  ANNULLED       // reservado para v1.2 (chargeback handling)
}
```

### 2.2 Cambios en modelos existentes

```prisma
model Prediction {
- userId          String
- user            User                @relation(...)
+ entryId         String
+ entry           Entry               @relation(fields: [entryId], references: [id], onDelete: Cascade)
  matchId         String
  match           Match               @relation(...)
  // ... resto sin cambios

- @@unique([userId, matchId])
+ @@unique([entryId, matchId])
- @@index([userId, evaluatedAt])
+ @@index([entryId, evaluatedAt])
}

model SpecialPrediction {
- userId          String              @unique
- user            User                @relation(...)
+ entryId         String              @unique
+ entry           Entry               @relation(fields: [entryId], references: [id], onDelete: Cascade)
  // ... resto sin cambios
}

model PhaseWinner {
- userId          String
- user            User                @relation(fields: [userId], references: [id])
+ entryId         String
+ entry           Entry               @relation(fields: [entryId], references: [id])
  // ... el premio se asigna a una Entry. PhaseWinner.entry.user da el dueño humano.
}

model LeagueMembership {
- userId          String
+ entryId         String
+ entry           Entry               @relation(fields: [entryId], references: [id], onDelete: Cascade)
  // ... una entry se une a una liga, no el user. Esto permite que un user
  // tenga su entry serio en la liga de la oficina y otra entry en la
  // liga de los amigos.
- @@unique([leagueId, userId])
+ @@unique([leagueId, entryId])
}

model User {
  // Sacamos las relaciones que migran a Entry. User retiene solo:
  predictions       // ELIMINAR
  specialPrediction // ELIMINAR
  phaseWins         // ELIMINAR
  leagueMemberships // ELIMINAR
+ entries           Entry[]
  // Conservamos: dni, firstName, etc., refreshTokens, passwordResets, payments,
  // notifications, auditLogs, leaguesOwned (sigue siendo del User no del Entry).
}

model Payment {
+ entry             Entry?    // 1-1 inverso al `paymentId @unique` en Entry.
                              // Null mientras Payment está PENDING; se setea
                              // cuando el flow lo promueve a Entry.
  // ... resto sin cambios
}
```

**Nota sobre `League.ownerId`:** Sigue siendo `userId`, no `entryId`. La liga es propiedad del usuario humano (puede crear con cualquier entry, aunque la entry que se une es una sola). Esto evita confusión: "Juan creó la liga" vs "el entry #2 de Juan creó la liga".

### 2.3 Configuración

```prisma
// AppConfig keys nuevas
"max_entries_per_user" → "5"     // cap de entradas por usuario
```

Editable desde `/admin/configuracion`. Default 5. Range razonable [1, 20]. Si se baja el cap a un valor menor que el de algún usuario existente, los entries existentes NO se borran — solo se previene la creación de nuevos.

### 2.4 Migración de datos (multi-fase, no atómica)

**Decisión clave:** la migración NO va en una sola TX porque (a) Prisma migrations en algunos drivers no garantizan atomicidad de DDL + DML grandes, (b) el rollback de tablas con muchas filas mantiene locks largos, (c) preferimos verificación manual entre pasos para abortar si algo huele mal.

**Pre-requisitos antes del deploy:**
1. Snapshot manual de la BD (además del backup diario automático).
2. Correr el **dry-run script** `scripts/multi-prode-migration-dryrun.ts` que reporta:
   - Conteo de Users con Payment APPROVED (se convertirán en 1 Entry cada uno)
   - Conteo de Users con múltiples Payments APPROVED (alerta: solo el más antiguo se usa para Entry #1)
   - Conteo de Predictions/SpecialPredictions/PhaseWinners/LeagueMemberships **huérfanas** (definición abajo)
   - Si alguno de los conteos huérfanos > 5 → ABORTAR y revisar manual.
3. **Backup de filas a borrar:** `INSERT INTO predictions_orphaned_backup_2026_05_XX SELECT * FROM predictions WHERE userId IN (...)`. Se preservan por 30 días.

**Definición de "huérfana":** una `Prediction`/`SpecialPrediction`/`PhaseWinner`/`LeagueMembership` cuyo `userId` no tiene **ningún Payment con `status = 'APPROVED'`**. En la práctica solo aplica al admin user (DNI 00000000) que no carga predicciones, pero validamos siempre.

**Pasos de la migración (cada uno en commit/migration separado para poder abortar):**

```
Migración M1 — additive (no rompe sistema actual):
  - CREATE TABLE entries (con userId, paymentId UNIQUE, position, alias, status, etc.)
  - CREATE INDEX, CREATE UNIQUE
  - ADD COLUMN entryId NULLABLE a predictions, special_predictions, phase_winners, league_memberships
  - Crear EntryStatus enum
```

```
Script de backfill (separado de la migration Prisma, idempotente, re-runnable):

  -- 1. Crear Entry #1 por cada user con Payment APPROVED (most-recent payment first)
  INSERT INTO entries (id, "userId", "paymentId", position, status, "createdAt", "updatedAt")
  SELECT gen_random_cuid(), p."userId", p.id, 1, 'ACTIVE', NOW(), NOW()
  FROM payments p
  WHERE p.status = 'APPROVED' AND p."userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM entries e WHERE e."userId" = p."userId")
  AND p.id = (
    SELECT id FROM payments p2
    WHERE p2."userId" = p."userId" AND p2.status = 'APPROVED'
    ORDER BY p2."createdAt" ASC LIMIT 1
  );

  -- 2. Backfill predictions.entryId
  UPDATE predictions pred
  SET "entryId" = (SELECT e.id FROM entries e WHERE e."userId" = pred."userId" LIMIT 1);

  -- 3. Análogo para special_predictions, phase_winners, league_memberships

  -- 4. Borrar huérfanas (con backup previo)
  CREATE TABLE IF NOT EXISTS predictions_orphaned_backup_2026_05_XX AS
    SELECT * FROM predictions WHERE "entryId" IS NULL;
  DELETE FROM predictions WHERE "entryId" IS NULL;
  -- (idem para los otros 3)

  -- 5. ASSERT (abortar si falla)
  DO $$ BEGIN
    IF (SELECT COUNT(*) FROM predictions WHERE "entryId" IS NULL) > 0 THEN
      RAISE EXCEPTION 'predictions con entryId NULL después de backfill';
    END IF;
  END $$;
```

```
Migración M2 — destructive (después de validar M1 + backfill OK):
  - ALTER COLUMN entryId SET NOT NULL en las 4 tablas
  - DROP CONSTRAINT (userId, matchId) en predictions
  - ADD CONSTRAINT (entryId, matchId) UNIQUE
  - DROP COLUMN userId en predictions, special_predictions, phase_winners, league_memberships
  - DROP/RECREATE materialized view leaderboard_global (ver §2.5)
```

**Rollback:** si abortamos entre M1 y M2: las 4 tablas quedan con userId + entryId nullable; sistema sigue funcionando con userId. M1 es idempotente.

Si abortamos después de M2: restore desde snapshot. La columna userId se perdió, no se puede recuperar sin restore.

### 2.5 Materialized view `leaderboard_global` — recreación

La MV existente referencia `predictions.user_id` y `special_predictions.user_id`. Después de M2 esas columnas no existen. La MV debe **dropearse y recrearse** como parte de M2:

```sql
-- Parte de M2
DROP MATERIALIZED VIEW IF EXISTS leaderboard_global;

CREATE MATERIALIZED VIEW leaderboard_global AS
SELECT
  e.id AS entry_id,
  e."userId" AS user_id,
  e.position AS entry_position,
  e.alias AS entry_alias,
  u.first_name,
  u.last_name,
  COALESCE(SUM(p."pointsEarned"), 0) +
    COALESCE(sp."totalPoints", 0) AS total_points,
  COUNT(p.id) FILTER (WHERE p."outcomeType" = 'EXACT') AS exact_count,
  COUNT(p.id) FILTER (WHERE p."outcomeType" IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT')) AS hits_count,
  sp."championTeamId" IS NOT NULL AS has_champion_pick
FROM entries e
INNER JOIN users u ON u.id = e."userId"
LEFT JOIN predictions p ON p."entryId" = e.id
LEFT JOIN special_predictions sp ON sp."entryId" = e.id
WHERE u.status = 'ACTIVE' AND e.status = 'ACTIVE'
GROUP BY e.id, e."userId", e.position, e.alias, u.first_name, u.last_name, sp."totalPoints", sp."championTeamId";

CREATE UNIQUE INDEX leaderboard_global_entry_id_idx ON leaderboard_global (entry_id);
CREATE INDEX leaderboard_global_total_points_idx
  ON leaderboard_global (total_points DESC, exact_count DESC, hits_count DESC);
CREATE INDEX leaderboard_global_user_id_idx ON leaderboard_global (user_id);

REFRESH MATERIALIZED VIEW leaderboard_global;
```

`LeaderboardRepository` se adapta: ahora cada row es un Entry, no un User. Filtros y orden idénticos.

### 2.6 Phase-winner job payload

El backend tiene un job BullMQ `phase-winner` con payload `{ phase, userId }`. Cambia a `{ phase, entryId }`. El processor (notifications) resuelve el user via `Entry.userId` para mandar el WhatsApp al dueño humano.

---

## 3. API contracts

### 3.1 Endpoints nuevos

```
POST   /entries                      # crear nuevo entry (auth + valida cap) — solo via /payments/init
GET    /entries/me                   # lista entries del current user
GET    /entries/:id                  # detalle de un entry específico (debe ser dueño)
PATCH  /entries/:id                  # update alias
```

**`POST /entries`** **NO se llama directamente desde el frontend** — es un endpoint interno usado por el webhook de pago. La creación de entries SIEMPRE pasa por el flujo `/payments/init` → MP/mock → webhook → crear Entry. Esto evita inconsistencias (entry sin pago).

**`GET /entries/me`** retorna:
```json
[
  {
    "id": "cuid_xxx",
    "position": 1,
    "alias": null,
    "createdAt": "...",
    "stats": {
      "predictionsCount": 7,
      "totalPoints": 12,
      "rank": 47,
      "specialPredictionLocked": false
    }
  },
  {
    "id": "cuid_yyy",
    "position": 2,
    "alias": "El de mis amigos",
    ...
  }
]
```

**`PATCH /entries/:id`** body `{ alias?: string | null }` — permite editar el alias hasta el inicio del Mundial. Después del kickoff inaugural el alias queda inmutable (audit razón).

### 3.2 Endpoints modificados

Todos los endpoints de predictions, leaderboard, leagues que antes operaban sobre `userId` ahora operan sobre `entryId`.

#### Predictions

```diff
- POST  /predictions/match/:matchId        body: { scoreHome, scoreAway }
+ POST  /entries/:entryId/predictions/match/:matchId  body: { scoreHome, scoreAway }

- GET   /predictions/me                    → todas las predictions del user
+ GET   /entries/:entryId/predictions      → predictions de UN entry específico

- POST  /predictions/special               body: { championTeamId, ... }
+ POST  /entries/:entryId/special          body: { championTeamId, ... }

- GET   /predictions/special/me
+ GET   /entries/:entryId/special

- GET   /matches/:matchId/predictions/count → cuenta total
+ GET   /matches/:matchId/predictions/count → sin cambios (público, agrega entries no users)
```

**Authorization:** todos los endpoints `/entries/:entryId/...` validan que el `entryId` pertenece al usuario autenticado. Si no, 403.

#### Leaderboard

```diff
- GET /leaderboard/global                  → top global por user
+ GET /leaderboard/global                  → top global por ENTRY
                                             (rows incluyen alias + nombre del user)
- GET /leaderboard/me/around                → mi posición + N alrededor
+ GET /leaderboard/entry/:entryId/around    → posición de UN entry + N alrededor

- GET /leaderboard/league/:leagueId         → ranking de los miembros (users)
+ GET /leaderboard/league/:leagueId         → ranking de los miembros (entries)
```

Los rows del leaderboard incluyen:
```json
{
  "entry_id": "...",
  "position": 1,
  "user_id": "...",          // dueño humano
  "first_name": "Juan",
  "last_name": "Pérez",
  "alias": "Mi prode optimista",  // o null
  "entry_position": 1,            // # del entry dentro del user
  "total_points": 87,
  "exact_count": 3,
  "hits_count": 12
}
```

**Display name lógica:**
- Si `alias`: mostrar `"{firstName} {lastName} · {alias}"`
- Si no tiene alias y user tiene >1 entry: mostrar `"{firstName} {lastName} (#{entry_position})"`
- Si user tiene 1 entry: mostrar `"{firstName} {lastName}"` (sin sufijo)

Esta lógica se computa en el cliente; el response del backend manda los campos crudos.

#### Leagues

```diff
- POST  /leagues                            → crea liga, owner = current user, auto-join con su (única) entry
+ POST  /leagues                            body: { ..., entryId }   → mismo, pero el entryId que se une se especifica
+                                              (si el user solo tiene 1 entry, el frontend lo manda automático)

- POST  /leagues/join                       body: { inviteCode }    → joinea con su user
+ POST  /leagues/join                       body: { inviteCode, entryId }  → joinea CON UN ENTRY ESPECÍFICO

- GET   /leagues/me                         → ligas donde soy miembro (como user)
+ GET   /leagues/me                         → ligas donde alguno de mis entries es miembro
                                              (incluye "entryId" del entry que está dentro)

- GET   /leagues/:id/leaderboard
+ GET   /leagues/:id/leaderboard            → sin cambios externos (entries miembros)
```

**Restricción:** un mismo entry NO puede unirse a la misma liga 2 veces. Pero un mismo USER puede tener 2 entries distintos en la misma liga (pagaron 2 veces, juegan los 2 prodes en el mismo grupo de amigos). El `LeagueMembership.unique([leagueId, entryId])` lo enforce.

#### Pagos — DOS endpoints separados

Decisión: separar en 2 endpoints para clarificar contratos, simplificar testing, y evitar el surface ambiguo de "auth opcional":

```diff
  POST /payments/init                         # PÚBLICO, anónimo, flow registro nuevo
                                              body: { turnstileToken }
                                              → crea Payment con userId=null
                                              → rate limit estricto (5/h por IP)
                                              → Turnstile required en prod

+ POST /entries/init-payment                  # AUTH required, flow "agregar otro prode"
+                                             body: { alias?: string }   # opcional
+                                             → valida user JWT + entries.count < cap (con SELECT FOR UPDATE)
+                                             → en MISMA TX: crea Payment con userId=current user, status=PENDING
+                                             → almacena `alias` en Payment.entryAlias (columna nueva)
+                                             → llama checkoutProvider con back_urls.success especial (ver §4.2)
+                                             → si lleno: 409 ENTRY_CAP_REACHED { current, cap }
+                                             → rate limit más laxo (20/h por user)
+                                             → Turnstile NO required (user ya autenticado)
```

**Race condition del cap:** el SELECT del count + INSERT del Payment van en la misma TX con `SELECT COUNT(*) FROM entries WHERE user_id = $1 FOR UPDATE` sobre los entries del user. Esto serializa peticiones concurrentes del mismo user. El webhook hace **re-check** del cap antes de crear la Entry final — defensa en profundidad.

**Webhook MP (cambios):** después de marcar Payment APPROVED, ejecuta:
- Si `Payment.userId IS NULL` → flow público (sin cambios respecto al sistema actual)
- Si `Payment.userId IS NOT NULL`:
  - Re-check `entries.count < max_entries_per_user` (race con admin que bajó el cap)
  - Si OK: crea `Entry` con `position = max(positions of user's entries) + 1`, `alias = Payment.entryAlias`, `paymentId = payment.id`. TX atómica con webhook update.
  - Si lleno: marca `Payment.status` a un nuevo estado `OVER_CAP` + AdminAlerts notify (admin decide refund manual)
  - Audit log `entry.created`

**Schema delta para soportar esto:**

```diff
  model Payment {
+   entryAlias  String?          # solo se usa en flow "agregar otro prode"
    // ... resto sin cambios
  }

  enum PaymentStatus {
    PENDING
    APPROVED
    REJECTED
    REFUNDED
+   OVER_CAP                     # raro: webhook llegó pero user ya está al cap
    ORPHANED
  }
```

#### Auth

```diff
  POST /auth/complete-registration          body: { token, dni, firstName, lastName, whatsapp, password }
                                            → ahora: crea User + Entry #1 + vincula Payment
                                            (antes: crea User + vincula Payment)

  GET /auth/me
+ retorna también el `entries: [...]` del user (resumen, igual que /entries/me)
```

### 3.3 Endpoints sin cambios

- `GET /matches`, `/matches/upcoming`, `/matches/by-phase/:phase` — son del torneo, no del usuario
- `GET /teams`, `/players`, `/stats/public`
- Todos los `/admin/*` (excepto los que listan usuarios — ver abajo)

### 3.4 Cambios en admin

```diff
  GET /admin/users                         → tabla de users
+   nuevo campo: `entriesCount` por user
+   filtro nuevo: `?minEntries=2` para ver users con multi-prode

  GET /admin/users/:id
+   incluye lista de entries del user con stats

  POST /admin/users                        → crear manual
                                              ya crea Payment con method=CASH/TRANSFER
+   ahora también crea Entry #1 al mismo tiempo

  GET /admin/payments                      → tabla de pagos
+   incluye campo `entryId` (qué entry generó este Payment)
+   payments con `entryId IS NULL` son flujos abandonados — el admin los puede ver

+ GET /admin/entries                       → tabla de TODAS las entries en el sistema
+                                            (filtros: userId, hasAlias, position)
+                                            útil para auditoría y soporte
```

---

## 4. Flujos críticos

### 4.1 Nuevo usuario (sin cambios visibles para el user)

```
1. Visitante click "Inscribirme · $10.000"
2. /inscripcion → POST /payments/init (sin auth) → backend crea Payment{userId: null}
3. Redirect a MP / mock-checkout
4. Pago aprobado → webhook actualiza Payment a APPROVED
5. /completar-registro → form
6. Submit → POST /auth/complete-registration:
   TX: crea User + Entry #1 + vincula Payment.userId = user.id, Entry.paymentId = payment.id
7. Auto-login → redirect /predicciones (a la entry recién creada, default seleccionada)
```

Para el user nuevo, todo es transparente: tiene 1 entry, no necesita saber que existe el concepto.

### 4.2 Usuario existente quiere otro prode (NUEVO flujo)

```
1. User logueado en /predicciones (con su entry actual)
2. Abre el selector de entries en el header
3. Click en "+ Crear otro prode" → modal NewEntryModal:
   - Input alias (opcional, max 60 chars)
   - Resumen: "Costo: ${precio}" (leído de AppConfig via /stats/public)
   - Botones: PAGAR CON MERCADOPAGO / Cancelar
4. Click PAGAR:
   → POST /entries/init-payment con body { alias } y JWT
   → Backend en TX: SELECT COUNT(*) FROM entries WHERE user_id=$1 FOR UPDATE
                    + crea Payment{userId, alias=Payment.entryAlias, completionTokenHash}
                    + crea preferencia MP con:
                      - metadata.completion_token: irrelevante (user ya está logueado)
                      - metadata.entry_alias: alias (para defensa en profundidad por si Payment.entryAlias se pierde)
                      - back_urls.success: ${FRONTEND_URL}/inscripcion/success?paymentId=${payment.id}&logged=1
                      - external_reference: payment.id
   → Si cap lleno: 409 ENTRY_CAP_REACHED, modal muestra mensaje
   → Si OK: devuelve initPoint
5. Redirect a MP / mock-checkout
6. Pago aprobado → webhook handler:
   - TX: update Payment a APPROVED
   - Re-check cap (race con admin que bajó el cap)
   - Si OK: crea Entry con position = max(...)+1, alias = Payment.entryAlias
   - Si lleno: Payment.status = OVER_CAP, AdminAlerts.notify, NO crea Entry
   - Audit log entry.created
   - NO encola email de recovery (user ya está logueado)
7. MP redirige a /inscripcion/success?paymentId=XXX&logged=1
   - Frontend detecta query `logged=1` → polling GET /entries/me hasta ver el nuevo entry (timeout 10s)
   - Cuando aparece → setActiveEntry(newEntryId) + redirect /predicciones?entry=newEntryId
   - Si timeout sin nuevo entry → mensaje "Tu pago se procesó pero el prode todavía no aparece. Refresca en 1 min." (caso webhook delay)
8. /predicciones con activeEntry = nuevo. Toast "✓ Nueva entrada creada"
```

**Diferencias clave entre flujo público y flujo logueado:**

| Aspecto | Público (registro nuevo) | Logueado (agregar prode) |
|---------|-------------------------|--------------------------|
| Endpoint init | POST /payments/init | POST /entries/init-payment |
| Auth | No required | JWT required |
| Turnstile | Required en prod | No required |
| Rate limit | 5/h por IP | 20/h por user |
| MP back_urls.success | `?token=PLAIN` | `?paymentId=ID&logged=1` |
| Cap check | N/A | SI, en TX con SELECT FOR UPDATE |
| Webhook crea Entry | No (espera /complete-registration) | Sí, automático |
| Después del pago | Va a /completar-registro | Va a /predicciones?entry=newId |
| Recovery email | Sí | No |

**El usuario logueado nunca ve `/completar-registro` en este flujo** — saltea directo a las predicciones.

### 4.3 Usuario con 2+ entries — UX

**Selector en el header del `(app)`:**

Dropdown en el `AppHeader`. Default: muestra el alias del entry o "Mi prode #N" si no hay alias. Hover/tap → expande:
- Lista de entries con stats inline (puntos · posición)
- Item resaltado: el activo
- CTA "+ Crear otro prode $10.000" abajo (deshabilitado si llegó al cap, con tooltip "Llegaste al máximo de N entradas")

**Selección persistente:** el `entryId` activo se guarda en `localStorage["prode.activeEntryId"]`. Al cargar la app:
1. Cargar `/entries/me`
2. Si `localStorage` tiene un `activeEntryId` válido (existe en la lista) → usar ese
3. Sino → usar el entry de menor `position` (el primero)
4. Persistir en localStorage

**Propagación del entry activo:** vía React Context (`<ActiveEntryProvider>` envuelve el `(app)/layout`). Hook `useActiveEntry()` retorna `{ entry, entries, setActiveEntry }`. Todas las queries de `/predictions`, `/leaderboard/me/around` usan `entry.id`.

**URLs:** soportan `?entry={id}` como query param para deep linking (compartir un prode específico). Si está, el provider lo respeta y persiste en localStorage.

### 4.4 Cap reached — UX del error

Backend devuelve 409 con código `ENTRY_CAP_REACHED` y body:
```json
{ "code": "ENTRY_CAP_REACHED", "message": "Llegaste al máximo de 5 entradas", "current": 5, "cap": 5 }
```

Frontend muestra toast informativo en el modal "+ Crear otro prode": "Ya tenés 5 entradas, que es el máximo configurado". El admin puede subir el cap si lo justifica.

### 4.5 Mini-ligas con multi-entry

Crear liga:
- Form pide nombre + descripción (sin cambios)
- Si user tiene >1 entry: pregunta cuál unir (default: la activa)
- Submit crea la liga con `ownerId = user.id` y autocrea `LeagueMembership { entryId, leagueId }`

Unirse:
- Input de código (sin cambios)
- Si user tiene >1 entry: pregunta cuál unir (default: la activa)
- Submit valida, crea `LeagueMembership`
- Constraint `(leagueId, entryId)` único bloquea duplicados

Una liga puede tener varios entries del MISMO user. Por ej: Juan tiene Mi prode #1 (estrategia) y Mi prode #2 (random), y los dos están en la liga "Familia García". En el ranking de la liga aparecen ambos como rows separados: "Juan Pérez · Mi prode" y "Juan Pérez · #2".

### 4.6 Cierre de fase con multi-entry

`PhaseService.maybeClosePhase` ya existía. Cambia: el query de "winner" agrupa por `entryId` no `userId`. El `PhaseWinner.entryId` apunta al entry ganador. Si el dueño humano tiene 2 entries y ambas terminan empatadas en la cima de la fase, el desempate se resuelve por los criterios estándar (exact_count > hits_count > random). **Una sola entry gana el premio**, aunque sean del mismo user.

### 4.7 Recálculo y refunds

Si el admin recalcula un match → el query update afecta `predictions WHERE matchId = ?` independientemente del entry → todos los entries del torneo recalculan correctamente.

Si MP envía un chargeback (REFUNDED) sobre un Payment que ya tenía Entry asociada:
- NO eliminamos automáticamente la Entry (es destructivo, perdería datos del user)
- AdminAlerts notifica al admin
- Admin decide: marcar Entry como "ANULLED" (estado nuevo a futuro), o ignorar (típicamente porque ya pasó la fase de refunds)

Para v1.1, NO implementamos auto-anulación. Solo logging + alerta. Edge case raro.

---

## 5. UX detallada del frontend

### 5.1 Active entry context

```typescript
// providers/active-entry-provider.tsx
interface ActiveEntryContextValue {
  entries: EntrySummary[];                  // todos los entries del user (puede tener 0+)
  activeEntry: EntrySummary | null;         // null solo en transición
  setActiveEntry: (entryId: string) => void;
  isLoading: boolean;                       // true durante el fetch inicial de /entries/me
  canCreateMore: boolean;                   // entries.length < max_entries_per_user
}
```

Hook: `useActiveEntry()`. Wrapper del provider envuelve el `(app)/layout`.

### 5.2 EntrySwitcher component

Ubicación: en el `<AppHeader>` desktop, entre el saludo y la nav central. En mobile, accesible vía un bottom-sheet trigger en el corner del header.

Estados visuales:
- **1 entry:** muestra "Mi prode" o el alias, sin dropdown (sólo display)
- **2+ entries:** dropdown abierto-able con la lista
- **Loading:** placeholder skeleton

Ejemplo desktop:
```
[ PRODE | Hola, Juan | ▼ Mi prode optimista (52 pts) | Predicciones · Especiales · Tabla · Ligas · Perfil | Salir ]
```

Click en el dropdown abre un menu shadcn Dropdown estilizado dark editorial:
```
┌─ Mis prodes ──────────────────────┐
│  ✓ Mi prode optimista             │
│    47 pts · pos 18                │
│    Mi prode #2                    │
│    32 pts · pos 51                │
│  ─────────────────────────────────│
│  + Crear otro prode  $10.000      │ ← deshabilitado si cap
└───────────────────────────────────┘
```

### 5.3 NewEntryModal

Modal que abre al click en "+ Crear otro prode". UI idéntica al spec sección 4.2 step 3. Submit dispara mutation hacia `/payments/init` y al success redirige a MP/mock-checkout.

Si MP devuelve error 409 cap:
- Cierra el modal
- Toast con el mensaje del backend
- El item del dropdown queda disabled hasta que el admin suba el cap

### 5.4 MatchCard / leaderboard / etc.

Todas las pages que actualmente fetchean por `useActiveEntry().activeEntry.id`:

```typescript
const { activeEntry } = useActiveEntry();
const predictionsQuery = useQuery({
  queryKey: queryKeys.entries.predictions(activeEntry?.id ?? ''),
  queryFn: () => getEntryPredictions(activeEntry!.id),
  enabled: !!activeEntry,
});
```

Cuando el user cambia de entry en el switcher, se invalida automáticamente el cache de `predictions`/`special` y se refetchea.

### 5.5 Cache key migration completa

Refactor de `lib/api/queryKeys.ts` (todos los cambios):

```diff
  predictions: {
-   me: () => ['predictions', 'me'] as const,
-   forMatch: (matchId: string) => ['predictions', 'me', 'match', matchId] as const,
-   special: () => ['predictions', 'special', 'me'] as const,
+   // Eliminado — se reemplaza por entries.*
  },
  leaderboard: {
    global: (page: number) => ['leaderboard', 'global', page] as const,
    phase: (phase: Phase, page: number) => ['leaderboard', 'phase', phase, page] as const,
-   around: () => ['leaderboard', 'me', 'around'] as const,
+   aroundEntry: (entryId: string) => ['leaderboard', 'entry', entryId, 'around'] as const,
    league: (id: string, page: number) => ['leaderboard', 'league', id, page] as const,
  },
+ entries: {
+   me: () => ['entries', 'me'] as const,
+   detail: (id: string) => ['entries', id] as const,
+   predictions: (entryId: string) => ['entries', entryId, 'predictions'] as const,
+   predictionForMatch: (entryId: string, matchId: string) => ['entries', entryId, 'predictions', matchId] as const,
+   special: (entryId: string) => ['entries', entryId, 'special'] as const,
+ },
```

**Política de invalidación al cambiar activeEntry:** el `setActiveEntry()` del provider hace:
```typescript
queryClient.invalidateQueries({ queryKey: ['entries'] });          // todos los entries.*
queryClient.invalidateQueries({ queryKey: ['leaderboard', 'entry'] }); // around específico
```

Esto fuerza refetch al cambiar entry, incluso si la page se quedó montada. Los caches de leaderboard global/phase/league NO se invalidan (son globales, no per-entry).

**Optimistic update con activeEntry mid-mutation:** el `useMutation` para `upsertPrediction` toma el snapshot `currentEntryId` en `onMutate`. Si el user cambia el activeEntry antes de que llegue la response:
- onSettled invalida `entries.predictions(currentEntryId)` (el entry de la mutation)
- El nuevo activeEntry queda inválido también vía la invalidation general al cambiar
- Toast clarificador: "Predicción guardada en {entry.alias || \`Mi prode #\${position}\`}"

### 5.6 Persistencia y deep links

Precedencia explícita al resolver activeEntry en mount:
1. **`?entry=ID` en URL** — si está y existe en la lista de `/entries/me`: usar (NO sobrescribir localStorage; respeta share link temporal)
2. **`localStorage["prode.activeEntryId"]`** — si existe y válido en la lista
3. **Entry con menor `position`** (fallback)

Si el `entryId` resuelto NO existe en la lista (ej: entry borrada, BD reseteada en dev): fallback al menor position + clean del localStorage + log warn.

XSS note: el `activeEntryId` no es secreto — un atacante con XSS puede leer qué entry estás viendo, pero el access token sigue solo en memoria de JS (variable de módulo per spec frontend §5.1). El daño de leer activeEntryId es despreciable.

### 5.5 PointsCelebration y leaderboard ranking

El leaderboard muestra rows de **entries**, no users. Si Juan tiene 2 entries:
- Row 1: "Juan Pérez · Mi prode optimista" — pos 18, 47 pts
- Row 2: "Juan Pérez · Mi prode #2" — pos 51, 32 pts

El highlight "VOS" del row destacado se aplica al row del entry ACTIVO actual (no a todos los del user).

Cuando el user cambia el entry activo, el highlight cambia y la tabla scrollea al nuevo "VOS".

### 5.6 Admin

`/admin/usuarios` muestra una columna nueva `entries`: count + sparkline de puntos totales si tiene >1 entry. Click en el row → drawer con detalle, incluye lista de entries con stats por separado.

`/admin/entries` (nuevo): tabla de todas las entries del sistema. Filtros: search por nombre user, alias, position. Útil para soporte ("usuario X dice que perdió un prode").

`/admin/configuracion`: nueva card "Multi-prode" con input numérico para `max_entries_per_user` (range 1-20).

---

## 6. Migración del flujo de implementación

Esto NO es feature-flag controlable: cuando se mergea, todo el sistema cambia atómicamente.

### Backend (~1.5 días)

1. **Schema migration** con backfill SQL custom (~half day testing en local con dump real)
2. **Servicios refactor:** PredictionsService, ScoringService, PhaseService, MatchProgressionService, LeaderboardRepository, LeaguesService — todos cambian de `userId` a `entryId`
3. **Endpoints nuevos:** /entries/me, /entries/:id, PATCH /entries/:id, GET /admin/entries
4. **Endpoints modificados:** /predictions/* → /entries/:entryId/predictions/*, /leagues operaciones con entryId
5. **Webhook handler:** crear Entry automáticamente cuando Payment APPROVED y userId NOT NULL
6. **`/payments/init` con auth opcional + cap check**
7. **Tests:** ~30-40 tests modificados, ~10-15 nuevos. Incluir test E2E del flujo "agregar otro prode"

### Frontend (~1 día)

1. **Active entry provider + hook** + persistencia localStorage
2. **EntrySwitcher** desktop + mobile
3. **NewEntryModal** con form alias + CTA pagar
4. **lib/api/entries.ts:** nuevo módulo
5. **lib/api/predictions.ts, leagues.ts:** refactor para usar entryId
6. **Pages:** propagación del entryId en queries (predicciones, especiales, leaderboard, ligas)
7. **Leaderboard rendering:** display name lógica (alias / #N / sin sufijo)
8. **Admin:** columna entries en /admin/usuarios, /admin/entries page, max_entries en /admin/configuracion
9. **Tests:** adaptación de los tests existentes + E2E "user agrega segundo prode"

### Total estimado: ~3.5 días

**Re-estimación realista** (era ~2.5 inicialmente):
- Backend: 1.5 días → **2 días** (la migración multi-fase + script de backfill + dry-run + tests es más laborioso de lo asumido)
- Frontend: 1 día → **1 día** (sin cambios mayores)
- Test refactor: NO estaba contado por separado → **0.5 día** (cualquier test que asume `User.predictions` o factories `prisma.prediction.create({ userId })` rompe; estimamos 80-120 tests modificados sobre los 344 existentes)

### Política de deploy

**Deploy atómico backend + frontend (NO desacoplado).**

Ningún feature flag, no hay aliases legacy. Backend y frontend cambian sus contratos en lockstep:
- Endpoint `/predictions/me` → `/entries/:entryId/predictions`
- Endpoint `/leaderboard/me/around` → `/leaderboard/entry/:entryId/around`
- Endpoints `/leagues` cambian shape de body
- queryKeys del frontend cambian shape

Procedimiento del release:
1. Mergear el PR multi-prode al main
2. CI buildea ambos containers
3. Manualmente desde Dokploy panel: stop frontend, deploy backend (corre M1 + backfill script + M2), restart frontend con nuevo build, verificar healthcheck
4. Total downtime estimado: ~5-10 minutos

Como el sistema todavía está pre-launch (no hay tráfico real), el downtime es invisible. Para lanzamientos post-Mundial, considerar deploy con feature flag o aliases legacy si se requiere zero-downtime.

---

## 7. Decisiones tomadas durante el design

1. **Entry como concepto explícito** (vs hackear con dni-suffix o multi-User) — más limpio, schema sano.
2. **Position 1-based** dentro de cada user — inmutable, monotónica creciente.
3. **Cap 5 default editable** — protege contra gaming, configurable.
4. **Alias opcional** — si no, "Mi prode #N" — UX simple cuando user tiene 1, descubrible cuando tiene 2+.
5. **Liga es del User, membership del Entry** — un user puede tener su entry "serio" en una liga y su entry "random" en otra.
6. **`/entries/:entryId/predictions/*` paths estilo REST** — más cacheable y más explícito que un header `X-Entry-Id`.
7. **`/payments/init` con auth opcional** — un endpoint, dos comportamientos según JWT.
8. **Webhook crea Entry automático** — el frontend nunca llama directo `/entries POST`.
9. **Persistencia del entry activo en localStorage** — sobrevive refresh, fácil de debuggear.
10. **Sin auto-anulación en chargeback** — admin manual, edge case raro.
11. **Backfill destruye predicciones huérfanas** — datos sin Payment APPROVED son basura.
12. **No se borran entries** — para v1.1, una vez creada queda. Si admin necesita borrar, vía SQL manual con audit.

---

## 8. Casos edge cubiertos

| Caso | Cómo se maneja |
|------|----------------|
| User llega al cap (5 entries) y intenta crear otra | 409 ENTRY_CAP_REACHED, modal muestra mensaje |
| Admin baja el cap a 3 cuando hay users con 5 entries | Existing entries no se tocan; nuevos /payments/init devuelven 409 |
| User cambia activeEntry mid-mutation de prediction | Optimistic update apunta al entry pre-cambio; queries se invalidan al cambiar; un toast confirma "Predicción guardada en {entry.alias}" |
| Webhook MP duplicado tras Entry ya creada | Idempotente: el `Entry.paymentId @unique` rechaza el segundo insert; logged y skipped |
| User logueado completa /entries/init-payment pero la session expira mid-flow | El JWT debe estar válido en el `init`. Si expira durante el redirect a MP, el webhook usa el `Payment.userId` ya guardado — la session expira no lo afecta. Cuando vuelve, el AuthProvider hace refresh y resuelve la nueva entry vía polling de /entries/me |
| Webhook llega después del cap bajado | Re-check en el webhook tira `OVER_CAP`. Payment queda en estado raro, AdminAlerts notifica, admin decide refund manual |
| Frontend renderea selector con 1 entry | Muestra display read-only del nombre/alias, sin dropdown. El "+ Crear otro" CTA aparece solo en hover/tap del display. |
| MockCheckoutProvider en E2E tests | Necesita actualizarse para soportar el flow logueado: aceptar JWT en headers + retornar `back_urls.success` con `?logged=1`. Test E2E "user agrega segundo prode" cubrirá el flow completo |
| User refresca la página post-pago antes de que el webhook procese | /predicciones?entry=newEntryId muestra "Cargando entradas..." (polling /entries/me cada 2s, max 10s). Si después del timeout no aparece: mensaje "Tu pago se procesó. Si en 1 min no aparece, contactá al admin" |
| Deploy atómico falla a mitad | Backend desplegado nuevo + frontend viejo: 500s en /entries/* (no existen aún en frontend); 404 en /predictions/me (ya no existe en backend). Mitigación: rollback rápido del backend al snapshot pre-M1 + frontend ya quedó. Probar en staging primero. |
| User logueado y abre flujo público en otra pestaña | Backend distingue por presencia de JWT; si la otra pestaña no tiene JWT, va por flow público (Payment.userId=null) — termina creando un User NUEVO con DNI distinto. Si quería crear "otro prode" del mismo user, debería usar el flujo logueado |
| User borra `localStorage["prode.activeEntryId"]` manualmente | El provider re-resuelve a entry de menor position |
| Liga con cap de members lleno + user con 2 entries quiere unir ambas | Cada `LeagueMembership` cuenta para el cap. Si el cap es 50 y hay 49 entries, sólo un entry de Juan puede unirse |
| Backup de BD pre-migración | Documentado en runbook deploy. Snapshot diario ya programado |
| Test suite que asume user-prediction 1:1 | Refactor: `Entry.predictions` reemplaza `User.predictions`. Tests existentes adaptados |
| Drawer "perfil público" de un user con multi-entries | Muestra estadísticas agregadas por user + breakdown de entries |

---

## 9. Lo que queda fuera de v1.1

- Borrado/anulación de entries por chargeback (manual por ahora)
- Renombrar entry alias después del kickoff (immutable)
- Transferir entry a otro user (no soportado)
- Comprar entry como regalo (no soportado)
- Mostrar todas las entries del user en el ranking simultáneamente con highlight conjunto

---

## 10. Próximos pasos

1. ✅ Spec doc escrita
2. → Spec review loop con `spec-document-reviewer` subagent
3. → Cliente revisa
4. → Plan de implementación detallado vía skill `writing-plans`
5. → Implementación: 2 fases (backend → frontend), ~2.5 días total
