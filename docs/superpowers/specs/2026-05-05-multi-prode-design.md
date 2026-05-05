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
- UX: selector arriba en el header del `(app)` con dropdown de entradas + CTA "Crear otro prode +$10.000" que dispara el flujo de pago inline

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
  paymentId           String              @unique
  payment             Payment             @relation(fields: [paymentId], references: [id])

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

### 2.4 Migración de datos (backfill)

Una migración de Prisma con SQL custom que:

1. Crea la tabla `entries` con columnas y constraints.
2. **Backfill:** por cada `Payment` con `userId IS NOT NULL` y `status = 'APPROVED'`, crea una `Entry` con:
   - `userId = Payment.userId`
   - `paymentId = Payment.id`
   - `position = 1` (todos los users existentes tienen exactamente 1 entry post-backfill)
   - `alias = NULL`
3. Update `predictions.entryId` con el `Entry.id` correspondiente al `Prediction.userId` original.
4. Update `special_predictions.entryId` análogo.
5. Update `phase_winners.entryId` análogo (siempre que `Payment` exista).
6. Update `league_memberships.entryId` análogo.
7. Drop columnas `userId` de las 4 tablas + drop FKs viejas + recrear constraints únicos.

Si un user tiene **múltiples Payments APPROVED** (improbable hoy, pero defensa en profundidad): el backfill toma el más antiguo como Entry #1; los Payments adicionales quedan **sin Entry asociado**. Audit log warnings para que el admin los revise post-migración.

Si un user **no tiene ningún Payment APPROVED**: sus predicciones (si las tuviera) quedan huérfanas. El backfill las elimina. En la práctica esto solo aplica al admin (que no carga predicciones) — datos relevantes quedan intactos.

**La migración es destructiva sobre datos huérfanos.** Backup de BD obligatorio antes de correr en producción. Ya tenemos backup diario configurado.

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

#### Pagos

```diff
- POST /payments/init       body: {}                → crea Payment para el current user (o nuevo)
+ POST /payments/init       body: {}                → si user logueado:
+                                                       valida que tenga < max_entries_per_user
+                                                       si OK: crea Payment con userId=current user
+                                                       si lleno: 409 ENTRY_CAP_REACHED
+                                                     si no logueado: igual que antes (Payment con userId=null,
+                                                       flow público con completar-registro)
```

Auth ahora es **opcional** en `/payments/init`. Si el JWT está presente y válido → flujo "agregar otro prode". Si no → flujo público de registro nuevo. El backend distingue los dos casos.

**Webhook MP (sin cambios externos):** después de marcar Payment APPROVED, si `Payment.userId IS NOT NULL` (caso "agregar otro prode") → crea `Entry` automáticamente y lo vincula al Payment. Si `userId IS NULL` (caso público) → no crea Entry todavía; el flujo de `/auth/complete-registration` lo crea junto con el User.

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
2. En el header (desktop) o BottomNav (mobile), abre el selector de entries:
   ┌──────────────────────────────────┐
   │ ▼ Mi prode #1 (52 pts · pos 47)  │
   ├──────────────────────────────────┤
   │   Mi prode #1 (activo)           │
   │   ┌── + Crear otro prode $10.000 │
   └──────────────────────────────────┘
3. Click en "+ Crear otro prode" → abre modal:
   ┌──────────────────────────────────┐
   │ NUEVA ENTRADA AL PRODE            │
   │                                   │
   │ Costo: $10.000                    │
   │ Vas a tener un nuevo set de       │
   │ predicciones independiente del    │
   │ que ya jugás.                     │
   │                                   │
   │ Alias (opcional):                 │
   │ [ ej: Mi prode optimista       ]  │
   │                                   │
   │ [ PAGAR CON MERCADOPAGO ]         │
   │ [ Cancelar ]                      │
   └──────────────────────────────────┘
4. Click "PAGAR CON MERCADOPAGO":
   → POST /payments/init con body {} y JWT del user en headers
   → Backend valida: user existe, count(entries) < max_entries_per_user
   → Si OK: crea Payment{userId = user.id, status: PENDING, completionTokenHash}
   → Devuelve initPoint
5. Redirect a MP / mock-checkout
6. Pago aprobado → webhook handler:
   - Update Payment a APPROVED
   - **Crea Entry automáticamente:** position = max(positions) + 1, alias del Payment.notes (si lo guardamos), userId = Payment.userId
   - Vincula Payment.entryId = entry.id
   - Audit log entry.created
   - NO encola el email de recovery (no hace falta, user ya está)
7. MP redirige a /inscripcion/success → frontend detecta que el user ya está logueado → redirect a /predicciones?entry=newEntryId
8. Frontend selecciona el nuevo entry como activo. Toast "✓ Nueva entrada creada"
```

**El usuario nunca ve `/completar-registro` en este flujo** — saltea directo a las predicciones.

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

### Total: ~2.5 días

Ningún plan que cubra todo en menos tiempo es honesto.

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
| User logueado completa /payments/init pero la session expira mid-flow | El JWT debe estar válido en el `init`. Si expira durante el redirect a MP, el webhook usa el `Payment.userId` ya guardado — la session expira no lo afecta |
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
