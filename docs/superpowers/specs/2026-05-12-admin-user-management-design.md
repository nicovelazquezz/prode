# Admin user management: edit, hard delete, autocomplete

Date: 2026-05-12
Status: approved (pending spec review loop + user review of this doc)

## Context

The prode is in closed beta (~10 expected initial users, ~500 for the
World Cup). The admin panel today can list users, change their status
(activate/inactivate/ban), and create them manually. It cannot edit
their `firstName / lastName / whatsapp`, cannot delete them, and the
"send direct WhatsApp notification" page requires the operator to type
a UUID — which they obviously do not memorise.

Three coupled features are needed to unblock the smoke test of the
notification flow and let the operator manage users sanely:

1. **Search/autocomplete users by DNI or name** in the notifications
   page (replaces the UUID input).
2. **Edit user (firstName, lastName, whatsapp)** from the user list, via
   a modal.
3. **Hard delete** a user, with a confirmation that surfaces the impact
   (entries / predictions / payments / leagues owned).

## Decisions (informed by exploring `backend/prisma/schema.prisma`,
`backend/src/modules/admin/admin-users.controller.ts`, and
`backend/src/modules/leaderboard/leaderboard.repository.ts`)

- **Hard delete over soft delete.** The operator's use case is: a user
  bricks their predictions, asks to "start over". Soft delete via
  `status=INACTIVE` already exists and already filters from the
  leaderboard, but it does not free the DNI for re-registration. The
  operator wants the DNI back. Trade-off accepted: payments associated
  to the deleted user become orphaned (`userId=null`) but remain in the
  ledger for accounting. The operator re-associates manually if a
  re-registered user "paid before".
- **Edit via modal, not separate page.** Five fields, no need for a
  full detail page. Status/role keep their existing inline dropdowns;
  the modal handles firstName, lastName, whatsapp.
- **Autocomplete reuses the existing `GET /admin/users?search=`
  endpoint** (case-insensitive against firstName, lastName, dni). New
  reusable component `<UserCombobox />`.

## 1. Data model (Prisma)

The hard delete needs Prisma to know what to cascade and what to set
to NULL when a user row is deleted. The current schema is half-spec'd
(some FKs declare `onDelete: Cascade`, others rely on Prisma's
implicit `NoAction` default, which would BLOCK the delete on the first
non-cascaded child row).

Audited FKs that point to `User`:

| FK                          | Today                  | Action                                              |
| --------------------------- | ---------------------- | --------------------------------------------------- |
| `RefreshToken.userId`       | `Cascade`              | unchanged — sessions die with the user              |
| `PasswordReset.userId`      | `Cascade`              | unchanged                                            |
| `Entry.userId`              | `Cascade`              | unchanged (cascades further to predictions, etc.)   |
| `Notification.userId` *(nullable)* | `Cascade`        | **change to `SetNull`** — preserve notification log |
| `Payment.userId` *(nullable)* | unspecified (NoAction) | **change to `SetNull`** explicit (accounting trail) |
| `AuditLog.userId` *(nullable)* | unspecified           | **change to `SetNull`** explicit (audit trail)      |
| `League.ownerId`            | unspecified            | **change to `Restrict`** — block delete if owner    |

Migration: one `2026XXXXXXXXXX_cascade_user_relations` that ALTERs the
4 FK constraints. No data rewrites, no downtime.

The DNI uniqueness constraint stays as-is. After hard delete the row
is gone, the unique index is free, the DNI can be reused for a new
registration.

## 2. Backend endpoints

### 2.1 `DELETE /admin/users/:id` (new)

Hard delete with safety guards.

Flow:

1. `RolesGuard` requires `role=ADMIN`.
2. Lookup target by id. 404 if not found.
3. **Guard: self-delete.** If `target.id === authenticatedAdmin.id` →
   `400 "no podés borrarte a vos mismo"`.
4. **Guard: last admin.** If `target.role === 'ADMIN'` and
   `User.count({ where: { role: 'ADMIN', id: { not: targetId } } }) === 0` →
   `400 "tiene que quedar al menos un admin"`.
5. **Guard: leagues owned.** If the target owns any league, `409` with
   the list (the operator must transfer or delete those leagues
   first — enforced by FK `Restrict`).
6. Build the audit payload **before** delete (target won't exist
   afterwards): `{ targetDni, targetFirstName, targetLastName,
   entriesCount, paymentsCount }`.
7. `prisma.user.delete({ where: { id } })`. Prisma cascades entries
   (→ predictions, → phase winners), refresh tokens, password resets;
   sets `userId=null` on notifications, payments, audit logs.
8. Write the audit log row with `userId=admin.id`,
   `action='admin.user_deleted'`, `entity='user'`,
   `entityId=targetId`, `changes={ ...payload }`.

Response: `200 { id: string, dni: string, deletedAt: string }`.

### 2.2 `GET /admin/users/:id/deletion-impact` (new)

Read-only summary used by the frontend confirm modal. Computes counts
without mutating.

```ts
type DeletionImpact = {
  entriesCount: number;
  predictionsCount: number;
  paymentsCount: number;
  leaguesOwnedCount: number;
  leaguesOwned: Array<{ id: string; name: string }>;
  canDelete: boolean;
  blockers: string[]; // human-readable reasons when canDelete=false
};
```

`canDelete=false` only when `leaguesOwnedCount > 0` (the
self-delete and last-admin guards run at delete-time because they
depend on who is calling).

### 2.3 `PATCH /admin/users/:id` (existing, no change)

Already accepts `firstName | lastName | whatsapp | status | role`. The
`whatsapp` field already runs through the `@Transform` normaliser
landed earlier today (`normalizeArgentinePhone`). The modal calls this
endpoint.

### 2.4 `GET /admin/users?search=` (existing, no change)

Already case-insensitive against firstName, lastName, dni. Reused by
the autocomplete.

### 2.5 Backend tests to add

`admin-users.controller.integration.spec.ts`:

- `DELETE`: happy path (no entries), with entries (cascades verified),
  with payments (orphaned to `userId=null`), self-delete blocked,
  last-admin blocked, league-owner blocked, 404 on missing.
- `deletion-impact`: counts correct in empty/loaded states, blockers
  populated when owner of league.

Existing tests stay green because the migration only changes ON DELETE
behaviour, not the read API.

## 3. UI flows (frontend)

### 3.1 `<UserCombobox />` — reusable autocomplete

New: `frontend/components/admin/user-combobox.tsx`.

Props:

```ts
type UserComboboxProps = {
  value: AdminUserOption | null;
  onSelect: (user: AdminUserOption | null) => void;
  placeholder?: string;
};

type AdminUserOption = {
  id: string;
  dni: string;
  firstName: string;
  lastName: string;
};
```

Behaviour:

- Input with 300 ms debounce.
- Hits `GET /admin/users?search=<q>&pageSize=10` only when `q.length >= 2`
  (via `useQuery` with `enabled: q.length >= 2`).
- Dropdown lists rows as `<dni> · <firstName> <lastName>`.
- Empty result → "Sin resultados".
- `value` shown as a chip with `×` clear; `onSelect(null)` on clear.

Headless implementation (no new dependency); style with existing Tailwind
tokens used elsewhere in the admin.

### 3.2 `/admin/notificaciones` (existing page, refactored)

- Remove the freeform "User ID" input.
- Replace with `<UserCombobox value={selected} onSelect={setSelected} />`.
- Submit button disabled until `selected !== null && title && message`.
- POST body builds `{ userId: selected.id, title, message, channel: 'WHATSAPP' }`.

### 3.3 Edit modal in `/admin/usuarios`

- New row action "Editar" (inside a "⋮" dropdown to keep the row tidy).
- Modal with `react-hook-form` + `zod`:

  ```ts
  const schema = z.object({
    firstName: z.string().min(2).max(100),
    lastName: z.string().min(2).max(100),
    whatsapp: z.string().min(10),
  });
  ```

- WhatsApp field shows a live preview below: "Se va a guardar como:
  +54 9 291 520 5236" (uses `normalizeArgentinePhone` from
  `frontend/lib/utils/normalize-phone.ts`).
- Submit → `PATCH /admin/users/:id` with the changed fields → toast
  success → `qc.invalidateQueries(queryKeys.admin.users.list())`.
- Backend 409 (whatsapp/dni duplicate) → toast with backend message.

### 3.4 Delete confirm modal in `/admin/usuarios`

- New row action "Borrar" (red destructive button in the "⋮" dropdown).
- Click opens modal; modal immediately calls
  `GET /admin/users/:id/deletion-impact`.

States:

- **Loading**: spinner.
- **Case A — empty user** (entries=0): "Este usuario no tiene
  predicciones ni entries." + `[Cancelar] [Borrar definitivamente]`.
- **Case B — has predictions**:

  ```
  ⚠️ Atención: se perderá información permanentemente
  - {entriesCount} entry(s)
  - {predictionsCount} predicciones
  - {paymentsCount} pagos quedarán huérfanos
  El DNI quedará liberado para re-registro.
  Esta acción NO se puede deshacer.
  ```

  Buttons: `[Cancelar] [Sí, borrar definitivamente]`.

- **Case C — blocked** (`canDelete=false`): lists blockers, only
  `[Cerrar]` button (no destructive action).

- On confirm → `DELETE /admin/users/:id` → toast + invalidate list +
  close modal.
- Network/race error (P2025 "record not found") → toast "El usuario ya
  fue eliminado" + invalidate.

### 3.5 Row actions consolidation

Today the row shows inline buttons for status changes. After this change:

- Move all per-row actions into a `⋮` dropdown:
  - **Editar** (modal 3.3)
  - **Activar / Desactivar / Banear** (existing logic)
  - **Borrar** (modal 3.4, visually separated, destructive style)

### 3.6 Frontend tests to add

- `<UserCombobox />` component test: debounce, min-chars, select,
  clear.
- Edit modal: form prefilled, normalised preview, submit calls
  `updateUser`, cancel is a noop.
- Delete modal: mocks for cases A / B / C, confirm path, blocked path.

## 4. Migration and rollout

1. Land Prisma schema change + migration in `backend/prisma/`.
2. Add `DELETE` and `deletion-impact` endpoints + tests.
3. Add `<UserCombobox />`, refactor `/admin/notificaciones`.
4. Add edit + delete modals to `/admin/usuarios`.
5. Push to `main`. Dokploy auto-deploys both backend and frontend; the
   backend `start.sh` runs `prisma migrate deploy` on boot, applying
   the FK change before the server starts.
6. Manual smoke test on prod (see 4.4 below).

The migration is FK-only (no data rewrite, no downtime). Backwards
compatibility: existing API contracts are unchanged; the only new
behaviour is that `prisma.user.delete()` will now succeed where before
it would have failed with FK violations.

## 4.1 Manual smoke test (post-deploy)

1. Edit Matias' lastName → persists in DB.
2. Delete Matias → disappears from listing.
3. Re-register a user with DNI `39149431` → succeeds (DNI freed).
4. Open `/admin/notificaciones`, type "matias" or "39149" in the
   combobox, pick the user, send a notification → arrives on WhatsApp.

## 5. Out of scope

- Bulk delete / bulk edit.
- Transferring league ownership from inside the user delete modal
  (operator handles it manually for now; the modal just blocks with a
  clear message).
- Restoring a hard-deleted user (none, by design — the action is
  irreversible).
- Soft-delete reintroduction (not needed; `INACTIVE` already covers
  the "pause this user" case).
- Search by whatsapp in the autocomplete (the existing endpoint
  doesn't index it for search; could be added later if useful).
- Detail page `/admin/usuarios/[id]` (deferred; modal covers the
  current need).
