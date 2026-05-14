# Bracket Builder + Knockout Tiebreakers — Design

**Fecha:** 2026-05-14
**Autor:** Nicolás + Claude
**Estado:** Aprobado por el dueño (pendiente review automático)

## 1. Contexto

Cuando termina la fase de grupos (último de los 72 partidos finalizado), `PhaseService.maybeClosePhase` corre y dispara `MatchProgressionService.populateRound32Matches`. Hoy ese populador no hace nada útil: solo manda un admin alert pidiendo cargar a mano los 16 cruces de R32. El admin tiene que entrar a `/admin/partidos/[id]` 16 veces, una por cruce.

Las fases siguientes (R32 → R16 → QF → SF → F + 3er puesto) sí se auto-llenan por pairing secuencial (ganador de #73 + ganador de #74 → home/away de #89, etc.). Excepción única: si una eliminatoria termina empatada, `pickTeam()` devuelve null porque el schema **no modela penales**. El admin queda con un partido 1-1 sin forma de decir "pasó Argentina" — tiene que ir a editar el match de la siguiente fase a mano.

Adicionalmente, la pantalla `/admin/fases` actual tiene piezas obsoletas:

- Botón "Cerrar fase" que pega a `POST /admin/phases/:phase/close` (endpoint que nunca se implementó → 404).
- Dialog con copy *"cerrar la fase dispara la notificación al ganador (si tiene opt-in WhatsApp)"* — falso desde commit `d993f0f` (spec [2026-05-14-wa-limit-mass-sends-design.md](./2026-05-14-wa-limit-mass-sends-design.md)).
- Botón "Marcar pagado" que pega a `POST /admin/prizes/:id/pay` (no existe → 404).
- Tipos `GENERAL_FIRST/SECOND/THIRD` definidos en el frontend que nunca se crean en backend.

## 2. Objetivos

1. Una sola pantalla para armar las 6 fases eliminatorias, con referencia visual (tabla de grupos para R32, cruces previos con ganador para R16+).
2. Resolver empates de eliminatoria sin romper el sistema de puntos.
3. Limpiar `/admin/fases` de botones y copy que no funcionan.

## 3. Decisiones clave y por qué

### 3.1 Sistema de puntos no se toca

`classifyOutcome(prediction, result)` (backend/src/modules/scoring/classify-outcome.ts) decide los puntos mirando **únicamente** `scoreHome` / `scoreAway`. No sabe nada de fase, ni de ganadores por penales. Esto es **convención estándar de prodes argentinos** (Olé, Quiniela Mundial, Prode FIFA, Mundialito): se premia el **score reglamentario** (90 minutos).

Ejemplo: usuario predijo 1-1, partido fue 1-1 y Argentina pasó por penales 4-3.
- Puntos del prode: 5 (EXACT) × 2.0 (multiplier R16) = **10 pts**. Correcto.
- Progresión del bracket: necesita saber que pasó Argentina → es lo que el campo nuevo resuelve, **sin tocar `classifyOutcome`**.

### 3.2 `winnerTeamId` opcional en `Match`

Un solo campo nuevo. `null` el 99% del tiempo. Solo se setea cuando `phase != GROUPS` y `scoreHome === scoreAway`.

- `classifyOutcome` lo ignora → puntos intactos.
- `pickTeam()` lo usa como fallback cuando los scores son iguales.
- Vista pública lo muestra como *"Pasa Argentina"* abajo del 1-1.

**Alternativas descartadas:**

- **Modelar penales explícitos** (`scoreHomePenalties` / `scoreAwayPenalties`). Más fiel al fútbol pero no aporta a puntos (no premiamos predicciones de penales). YAGNI.
- **No persistir y resolverlo solo en el builder de la siguiente fase**. Pierde la info histórica: si después borrás o regenerás el siguiente match, se evapora quién pasó.

### 3.3 Builder universal vs solo R32

El alcance final es **las 6 fases eliminatorias** (ROUND_32, ROUND_16, QUARTERS, SEMIS, THIRD_PLACE, FINAL — las dos últimas comparten pantalla porque ambas vienen de las 2 semis).

**Por qué universal:**

- Una sola UI mental para "armar siguiente fase". No hay que recordar "en R32 uso el builder, en R16 voy a /admin/partidos/[id]".
- El código del builder es 90% el mismo entre fases — lo único que varía es la fuente de la referencia.
- Para R16+ el auto-pairing actual sigue corriendo dentro de `maybeClosePhase` y pre-llena los matches. El builder solo te muestra el estado y te deja confirmar o corregir.
- Resuelve el caso "me olvidé de cargar `winnerTeamId` al finalizar el empate": el builder de la siguiente fase muestra el cruce como incompleto y vos asignás ahí.

### 3.4 Cleanup va en el mismo spec

Cuando agreguemos el link "Armar cruces" en las cards de fase eliminatoria, vamos a tocar `frontend/app/(admin)/admin/fases/page.tsx`. Sacar los botones rotos y el copy obsoleto mientras estamos ahí es ~30 minutos y evita el efecto raro de *"agregué un botón que funciona al lado de tres que tiran 404"*.

### 3.5 Empates de grupo en tiebreakers más allá de PTS/DG/GF

FIFA usa head-to-head y fair play como criterios adicionales. **No los implementamos**: requieren modelar tarjetas, partidos head-to-head, etc. Si dos equipos quedan exactamente iguales en PTS/DG/GF, **el builder muestra la situación de empate y el admin decide qué equipo poner en cada slot manualmente** (que es lo que terminaría haciendo igual).

## 4. Modelo

### 4.1 Schema — `Match` recibe un campo

```prisma
model Match {
  // ... campos existentes
  winnerTeamId String?
  winnerTeam   Team?   @relation("MatchWinner", fields: [winnerTeamId], references: [id], onDelete: SetNull)
}

model Team {
  // ... campos existentes
  matchesAsWinner Match[] @relation("MatchWinner")
}
```

**Regla de integridad:** el campo solo tiene sentido cuando el match está FINISHED, los scores son iguales, y la fase no es GROUPS. No la enforzamos a nivel DB (un CHECK haría falta dependencia entre columnas que Postgres maneja mal con FK); se valida en backend (sección 5.2).

### 4.2 Migration

Una sola, additive, sin rewrite:

```sql
ALTER TABLE matches
ADD COLUMN winner_team_id TEXT;

ALTER TABLE matches
ADD CONSTRAINT matches_winner_team_id_fkey
FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL;
```

No agregamos índice — no se filtra por este campo, solo se lee junto con el resto del match.

## 5. Backend

### 5.1 GroupStandingsService (nuevo)

**Ubicación:** `backend/src/modules/scoring/group-standings.service.ts`

**API pública:**

```typescript
interface GroupStanding {
  teamId: string;
  teamName: string;
  teamShortName: string;
  teamFlagUrl: string;
  pj: number;   // partidos jugados (FINISHED)
  pg: number;   // partidos ganados
  pe: number;   // empates
  pp: number;   // perdidos
  gf: number;   // goles a favor
  gc: number;   // goles en contra
  dg: number;   // diferencia (gf - gc)
  pts: number;  // pg*3 + pe*1
  position: number; // 1..4 dentro del grupo, según orden
}

class GroupStandingsService {
  async getGroupStandings(groupCode: string): Promise<GroupStanding[]>;
  async getAllGroupStandings(): Promise<Record<string, GroupStanding[]>>;
}
```

**Lógica:**

- Lee partidos donde `phase === 'GROUPS'`, `groupCode === <code>`, `status === 'FINISHED'`.
- Para cada equipo del grupo: cuenta PJ, suma goles, calcula PG/PE/PP.
- Ordena: `PTS DESC → DG DESC → GF DESC`.
- Equipos sin partidos jugados aparecen igual con todo en 0 (para que el builder los muestre desde el día 1).

**Cache:** 60s TTL en Redis con key `groups:standings:all`. Invalidar desde `scoring.service.ts` cuando se finaliza un match de GROUPS.

### 5.2 `FinishMatchDto` extensión

**Ubicación:** `backend/src/modules/scoring/dto/finish-match.dto.ts`

Agregar campo opcional:

```typescript
export class FinishMatchDto {
  @IsInt() @Min(0) scoreHome: number;
  @IsInt() @Min(0) scoreAway: number;
  @IsOptional() @IsString() winnerTeamId?: string;
}
```

**Validación en servicio** (no en DTO porque depende del match cargado de DB):

En `ScoringService.finishMatchAndScore`, antes de abrir la TX:

```typescript
if (matchPrev.phase !== 'GROUPS' && scoreHome === scoreAway) {
  if (!winnerTeamId) {
    throw new BadRequestException('winnerTeamId requerido para empate en eliminatoria');
  }
  if (winnerTeamId !== matchPrev.homeTeamId && winnerTeamId !== matchPrev.awayTeamId) {
    throw new BadRequestException('winnerTeamId debe ser uno de los equipos del partido');
  }
}
```

Si scores son distintos, `winnerTeamId` se ignora (no se persiste, queda null). Si fase es GROUPS, idem (los grupos no tienen ganador por penales).

**Idéntica validación para `recalculateMatch`** — el admin puede corregir el ganador después.

### 5.3 `MatchProgressionService.pickTeam` actualizado

```typescript
private pickTeam(match: Match, fromLoser: boolean): string | null {
  if (match.scoreHome === null || match.scoreAway === null) return null;
  if (match.scoreHome === match.scoreAway) {
    // Empate: usar winnerTeamId si está seteado, si no abortar como antes.
    if (!match.winnerTeamId) return null;
    if (fromLoser) {
      // El perdedor es el OTRO equipo.
      return match.winnerTeamId === match.homeTeamId
        ? match.awayTeamId
        : match.homeTeamId;
    }
    return match.winnerTeamId;
  }
  const homeWon = match.scoreHome > match.scoreAway;
  if (fromLoser) return homeWon ? match.awayTeamId : match.homeTeamId;
  return homeWon ? match.homeTeamId : match.awayTeamId;
}
```

GROUPS → R32 path sigue intacto (el populador de R32 sigue siendo "manda alerta admin, no hace nada"). El builder es el reemplazo de esa alerta.

### 5.4 Endpoints nuevos

**`GET /groups/standings`** (público)

- Sin auth.
- Throttle: el global del módulo (no throttle extra).
- Response: `Record<groupCode, GroupStanding[]>`.
- Cache HTTP: `Cache-Control: public, max-age=60`.

**`GET /admin/fases/builder/:phase`** (admin)

Devuelve el estado actual del builder más la referencia para la fase:

```typescript
interface BuilderState {
  phase: Exclude<Phase, 'GROUPS'>;
  // Los N matches de la fase (16, 8, 4, 2 o 2 — la última agrupa
  // THIRD_PLACE + FINAL si phase === 'FINAL').
  matches: Array<{
    matchId: string;
    matchNumber: number;
    label: string;           // ej. "Mejor R32 H1" del seed
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeTeamLabel: string | null;
    awayTeamLabel: string | null;
    kickoffAt: string;       // ISO
    venue: string | null;
  }>;
  reference: Reference;
}

type Reference =
  | {
      type: 'GROUPS';
      standings: Record<string, GroupStanding[]>;
    }
  | {
      type: 'PREVIOUS_ROUND';
      previousPhase: Phase;
      matches: Array<{
        matchNumber: number;
        homeTeam: { id: string; name: string; flagUrl: string };
        awayTeam: { id: string; name: string; flagUrl: string };
        scoreHome: number | null;
        scoreAway: number | null;
        winner: { id: string; name: string; flagUrl: string } | null;
        loser: { id: string; name: string; flagUrl: string } | null;
        status: MatchStatus;
      }>;
    };
```

**Para `phase === 'FINAL'`** la respuesta incluye los 2 matches (#103 3er puesto y #104 final). La referencia es `PREVIOUS_ROUND` con los 2 matches de SEMIS, y el builder lo trata como caso especial (mostrar `winner` para final y `loser` para 3er).

**`POST /admin/fases/builder/:phase`** (admin)

Recibe la lista completa de cruces a guardar:

```typescript
interface BuilderApplyDto {
  matches: Array<{
    matchId: string;
    homeTeamId: string | null;
    awayTeamId: string | null;
  }>;
}
```

**Validaciones:**

1. Cada `matchId` debe pertenecer a la fase requerida.
2. No repetir un equipo en dos cruces distintos de la fase (excluyendo nulls).
3. No `homeTeamId === awayTeamId` (excluyendo cuando ambos son null).
4. `homeTeamId` y `awayTeamId` (cuando no son null) deben ser equipos válidos (FK).

**Comportamiento:**

- Single transaction.
- Para cada match: si `homeTeamId` Y `awayTeamId` quedan no-null Y antes alguno era null → setea `predictionsOpenAt = now()`. Esto abre predicciones automáticamente.
- Si el match ya tenía sus equipos y se está sobreescribiendo, **no** se resetea `predictionsOpenAt` (el admin está corrigiendo, no inicializando).
- Audit log: `action: 'phase.builder.applied'`, `entity: 'phase'`, `entityId: <phase>`, `changes: { matches: [<antes/después por match>] }`.

Response: `{ ok: true, matchesUpdated: number }`.

### 5.5 Endpoints muertos del cliente

El frontend tiene `closePhase()` y `markPrizePaid()` en `frontend/lib/api/admin.ts` que pegan a endpoints inexistentes. Se borran del cliente (los endpoints nunca existieron, no hay nada para borrar en backend).

## 6. Frontend

### 6.1 `/admin/fases/builder/[phase]/page.tsx` (nuevo)

Ruta dinámica. Phase debe ser una de las 6 eliminatorias (validar en server component; si llega `GROUPS` → 404).

**Layout:**

- Desktop: split izquierdo (referencia, 40% ancho) / derecho (builder, 60% ancho).
- Mobile: pila vertical, referencia arriba.

### 6.2 Referencia — variantes

**`phase === 'ROUND_32'`** — 12 cards de grupos:

```
┌─────────────────────────────────────┐
│ Grupo A                             │
├──┬──────────────┬──┬──┬──┬──┬──┬───┤
│ #│ Equipo        │PJ│DG│GF│GC│PTS│   │
├──┼──────────────┼──┼──┼──┼──┼───┼───┤
│ 1│ Argentina    │ 3│+5│ 7│ 2│ 9 │ ✓ │
│ 2│ México       │ 3│+2│ 5│ 3│ 6 │ ✓ │
│ 3│ Polonia      │ 3│-1│ 3│ 4│ 3 │ ? │
│ 4│ A. Saudí     │ 3│-6│ 1│ 7│ 0 │   │
└──┴──────────────┴──┴──┴──┴──┴───┴───┘
```

El badge ✓ marca los 2 que clasifican directo (posiciones 1 y 2). El badge `?` marca al 3° como "candidato a mejor tercero". Bajo el listado de 12 grupos: un panel con los 12 terceros ordenados por PTS → DG → GF, marcando los **8 primeros** con ✓ (clasifican como "mejores terceros").

**`phase` ∈ `{ROUND_16, QUARTERS, SEMIS, FINAL}`** — lista de cruces previos:

```
┌─────────────────────────────────────┐
│ R32 — partido #73                   │
│ Argentina 2-1 México                │
│ ⮕ Pasa Argentina                    │
├─────────────────────────────────────┤
│ R32 — partido #74                   │
│ Brasil 1-1 Inglaterra               │
│ ⮕ Pasa Brasil (por penales)         │
└─────────────────────────────────────┘
```

Para `phase === 'FINAL'`, además de mostrar ganadores, mostrar perdedores (los del 3er puesto).

### 6.3 Builder — filas con dropdowns

```
Partido #73 · Mejor R32 H1 · Sábado 27/06
[Argentina ▾]  vs  [México ▾]              [✓ Asignado]

Partido #74 · Mejor R32 V1 · Sábado 27/06
[Brasil ▾]  vs  [— elegir — ▾]             [Incompleto]
```

- Selectors usan el `TeamPicker` existente (ya filtra equipos).
- Para R16+, el pre-llenado viene del auto-pairing; el admin solo confirma.
- Para R32, todo arranca vacío.
- Badge a la derecha: "Asignado" (verde) si ambos están, "Incompleto" (amarillo) si falta uno.

**Validación cliente en tiempo real:**

- Si seleccionás un equipo que ya está en otro cruce → toast warning + el select se vuelve rojo. No bloquea (el admin puede estar reorganizando) pero el botón "Guardar" se deshabilita.
- `home === away` → mismo tratamiento.

**Botón "Guardar cruces"** al final, fijo en el footer del card. Disabled si hay conflictos. Loading state mientras espera el POST.

**Onsuccess:** toast `"X cruces guardados"` + invalidar queries `queryKeys.admin.matches.*` + redirect opcional a `/admin/partidos?phase=<phase>`.

### 6.4 Form de "Finalizar partido" — extender

**Archivo:** el componente que renderiza el form de finish dentro de `frontend/app/(admin)/admin/partidos/[id]/page.tsx` (o donde esté hoy).

- Cuando `phase != GROUPS` y `watch('scoreHome') === watch('scoreAway')` y ambos son números:
  - Renderizar select **"Ganador (definición por penales/decisión)"**.
  - Opciones: los dos equipos del match.
  - Required, no se puede submit sin él.
- Pasar `winnerTeamId` en el body del POST.

Cuando `scoreHome !== scoreAway` o fase es `GROUPS`, el select se oculta y `winnerTeamId` se omite del body.

### 6.5 `/admin/fases` cleanup

**Sacar:**

- Componente `ClosePhaseDialog` entero.
- Botón "Cerrar fase" en `PhaseCard`.
- Botón "Marcar pagado" en `PrizesList`.
- Mutaciones `closeMutation` y `payMutation`.
- Import y uso de `closePhase`, `markPrizePaid` desde `@/lib/api/admin`.
- Definiciones de `closePhase` y `markPrizePaid` en `frontend/lib/api/admin.ts`.
- Tipos `GENERAL_FIRST`, `GENERAL_SECOND`, `GENERAL_THIRD` de `AdminPrize` y del `PRIZE_LABELS` (no se generan en backend, son ruido).
- El copy *"cerrar la fase dispara la notificacion al ganador..."* obviamente sale junto con el dialog.

**Agregar:**

- En cada `PhaseCard` cuya fase sea eliminatoria, un link/botón **"Armar cruces"** que lleva a `/admin/fases/builder/[phase]`.
  - Habilitado si la fase anterior está cerrada (PhaseWinner row existe), o si phase === 'ROUND_32' y GROUPS está cerrada.
  - Si está deshabilitado, tooltip *"Esperá a que cierre la fase anterior"*.
- El badge "Cerrada" sigue mostrándose como hoy cuando hay PhaseWinner row.

**Lo que queda en la página:** vista read-only del progreso de cada fase, top 5, ganador propuesto/registrado, lista de premios (PhaseWinner rows con su monto cuando esté seteado — hoy queda en 0 porque nadie lo setea, pero la sección queda como está para no perder la vista).

### 6.6 Vista pública del partido empatado

**Archivos a tocar** (a identificar durante implementación; lo más probable):

- `frontend/components/match-card.tsx` o equivalente que renderiza un partido.
- `frontend/app/(app)/partidos/[id]/page.tsx` si existe el detalle.

Cuando `match.status === 'FINISHED'` y `match.winnerTeamId !== null`:

```
Argentina  1 — 1  Polonia
           Pasa Argentina
```

Solo eso. Sin "(por penales)" — no modelamos penales explícitos. El campo `winnerTeam` ya viene resuelto desde backend en la response de `/matches/:id`.

## 7. Tests

### 7.1 Unit

**`group-standings.service.spec.ts`** (nuevo):

- Cálculo correcto de PJ/PG/PE/PP/GF/GC/DG/PTS sobre fixture de 6 partidos.
- Orden por PTS → DG → GF.
- Grupo con 0 partidos finalizados → 4 equipos en cero, orden alfabético o por seed.
- Grupo con 3 de 6 partidos finalizados → parcial correcto.
- Empate exacto en PTS/DG/GF entre dos equipos → quedan adyacentes, el orden interno no se garantiza (admin desempata).

**`pick-team.spec.ts` o extensión de `match-progression.service.integration.spec.ts`:**

- Scores 2-1, `winnerTeamId` null → devuelve home.
- Scores 1-2, `winnerTeamId` null → devuelve away.
- Scores 1-1, `winnerTeamId` = home → devuelve home (caso `pickFromLoser=false`).
- Scores 1-1, `winnerTeamId` = home, `fromLoser=true` → devuelve away.
- Scores 1-1, `winnerTeamId` null → devuelve null (alert, comportamiento legacy).

**`finish-match.dto.spec.ts` o validación en service:**

- Phase=R16, scores 1-1, sin `winnerTeamId` → BadRequest.
- Phase=R16, scores 1-1, `winnerTeamId` que no es home ni away → BadRequest.
- Phase=R16, scores 1-1, `winnerTeamId = home` → OK.
- Phase=GROUPS, scores 1-1, sin `winnerTeamId` → OK (no aplica).
- Phase=R16, scores 2-1, con `winnerTeamId` → OK pero el campo se ignora (no se persiste).

### 7.2 Integration

**Builder POST happy path:**

- Llamar `POST /admin/fases/builder/ROUND_32` con 16 cruces válidos.
- Verificar que los 16 matches tienen home/awayTeamId seteados.
- Verificar que `predictionsOpenAt` se seteó para los que pasaron de null a non-null.
- Verificar audit log.

**Builder POST validación de equipo repetido:**

- Llamar con un equipo X en dos cruces distintos → 400 con mensaje claro.
- DB queda intacta (TX rolled back).

**`GET /groups/standings`:**

- Sin partidos finalizados → 12 grupos con equipos en cero.
- Con todos los partidos → 12 grupos con clasificación calculada.

### 7.3 E2E

**Flujo: empate en eliminatoria + progresión:**

1. Setup: R32 #73 con scoreHome=scoreAway=1.
2. POST /admin/matches/#73/finish con winnerTeamId=home.
3. Verificar match guarda winnerTeamId.
4. (Implícito: el resto de R32 también termina.)
5. Verificar que cuando cierra R32, R16 se popula correctamente, y el equipo home de #73 aparece en el R16 que lo recibe.

**Flujo: builder R32:**

1. Setup: GROUPS finalizado.
2. POST /admin/fases/builder/ROUND_32 con 16 cruces.
3. Verificar matches actualizados + predictionsOpenAt + audit log.
4. Usuario hace una predicción en uno de esos R32 → OK (predicciones abiertas).

## 8. Plan de rollout

1. **Migration** (additive, sin downtime). Aplicada con dokploy normal.
2. **Backend:**
   - `GroupStandingsService` + endpoint público.
   - `pickTeam` actualizado + validación en finish/recalculate.
   - Endpoints del builder.
3. **Frontend:**
   - Página builder.
   - Select "Ganador" en form de finish.
   - Cleanup de /admin/fases + link al builder.
4. **Vista pública:** línea "Pasa X" en match.
5. **Smoke test en staging** con fixture de torneo terminado.

Ordening: la migration y el backend deben mergearse antes del frontend para que las llamadas no fallen.

## 9. YAGNI (explícitos)

- **No modelamos penales con scoreline** (4-3). No aporta puntos.
- **No implementamos head-to-head ni fair play** como tiebreakers de grupo. Admin desempata en builder.
- **No reimplementamos `close-phase` ni `mark-prize-paid`**. Los borramos del cliente.
- **No tocamos el sistema de puntos.** Sigue premiando score reglamentario.
- **No agregamos cron ni job**. Todo es manual desde admin.
- **No agregamos notificaciones** al armar cruces. Las predicciones se abren con `predictionsOpenAt`, lo cual no dispara WA. El flag `WA_MASS_NOTIFS_ENABLED` (spec previo) sigue OFF.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Admin asigna en R32 un equipo que NO clasificó (ej. un 4° de grupo) | El builder no valida "ese equipo clasificó". Confiamos en el criterio del admin (la referencia ya muestra la tabla). |
| Admin se olvida de cargar `winnerTeamId` en un empate de eliminatoria | El builder de la fase siguiente muestra el cruce como "Incompleto" y el admin asigna ahí. Backend bloquea con BadRequest si intenta finalizar empate sin winnerTeamId. |
| Cache de standings desincronizada | Invalidación explícita en `scoring.service.ts` cuando se finaliza/recalcula un match de GROUPS. TTL de 60s como red de seguridad. |
| Builder POST con TX larga | 16 updates como máximo (R32) → trivial. |

## 11. Referencias

- Spec previo relacionado: [2026-05-14-wa-limit-mass-sends-design.md](./2026-05-14-wa-limit-mass-sends-design.md) — el flag WA_MASS_NOTIFS_ENABLED y la decisión de no notificar automáticamente a ganadores de fase.
- Plan de backend Mundial (fase 8): [docs/superpowers/plans/2026-05-04-prode-backend-plan.md](../plans/2026-05-04-prode-backend-plan.md) — describe el populador GROUPS → R32 como "manual, con AdminAlert" (lo que este spec reemplaza con el builder).
