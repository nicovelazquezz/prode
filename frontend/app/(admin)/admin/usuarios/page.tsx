"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Copy, MoreHorizontal, Plus, Search } from "lucide-react";
import {
  AdminDataTable,
  RowActionsCell,
} from "@/components/domain/admin-data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import {
  listUsers,
  resetUserPassword,
  updateUser,
  type AdminUser,
} from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE" | "BANNED";
type RoleFilter = "ALL" | "USER" | "ADMIN";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "ACTIVE", label: "Activos" },
  { value: "INACTIVE", label: "Inactivos" },
  { value: "BANNED", label: "Baneados" },
];

const ROLE_OPTIONS: Array<{ value: RoleFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "USER", label: "Usuario" },
  { value: "ADMIN", label: "Admin" },
];

/**
 * Lista de usuarios admin (spec §6.11). Tabla data-densa con filtros
 * por search/status/role y acciones por fila (DropdownMenu).
 *
 * Mobile: tabla con scroll horizontal (manejado por <AdminDataTable>).
 * Filtros se apilan en columna en mobile.
 */
export default function AdminUsuariosPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      page,
      pageSize: 50,
      search: search.trim() || undefined,
      status: status === "ALL" ? undefined : status,
      role: role === "ALL" ? undefined : role,
    }),
    [page, search, status, role],
  );

  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users.list(filters),
    queryFn: () => listUsers(filters),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<AdminUser, unknown>[]>(
    () => [
      {
        header: "DNI",
        accessorKey: "dni",
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.dni}</span>
        ),
      },
      {
        header: "Nombre",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--color-landing-text)]">
              {row.original.firstName} {row.original.lastName}
            </span>
            <span className="text-xs text-[var(--color-landing-text-muted)]">
              {row.original.whatsapp || "—"}
            </span>
          </div>
        ),
      },
      {
        header: "Rol",
        accessorKey: "role",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-block rounded-sm px-2 py-1 font-sans text-xs font-bold uppercase tracking-wider",
              row.original.role === "ADMIN"
                ? "bg-[var(--color-landing-green)] text-[var(--color-landing-text)]"
                : "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]",
            )}
          >
            {row.original.role}
          </span>
        ),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} />
        ),
      },
      {
        header: "Pago",
        cell: ({ row }) => (
          <span className="font-sans text-xs text-[var(--color-landing-text-muted)]">
            {formatDate(row.original.paidAt ?? null)}
          </span>
        ),
      },
      {
        header: "Predicciones",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatNumber(row.original.predictionsCount ?? 0)}
          </span>
        ),
      },
      {
        header: "Puntos",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums font-bold">
            {formatNumber(row.original.totalPoints ?? 0)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <RowActionsCell>
            <UserActionsMenu user={row.original} />
          </RowActionsCell>
        ),
      },
    ],
    [],
  );

  const total = usersQuery.data?.total ?? 0;
  const pageSize = usersQuery.data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">Padron</div>

          <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">

            <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">

              Usuarios

            </span>

          </h1>
          <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
            {formatNumber(total)} registrados
          </p>
        </div>
        <Link
          href="/admin/usuarios/nuevo"
          className="inline-flex items-center justify-center gap-2 h-12 px-6 bg-[var(--color-landing-red)] text-[var(--color-landing-text)] font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] rounded-sm transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo usuario
        </Link>
      </header>

      <AdminDataTable
        data={usersQuery.data?.data ?? []}
        columns={columns}
        loading={usersQuery.isLoading}
        emptyMessage="Sin usuarios para los filtros aplicados."
        ariaLabel="Tabla de usuarios"
        toolbar={
          <Toolbar
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            status={status}
            onStatusChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            role={role}
            onRoleChange={(v) => {
              setRole(v);
              setPage(1);
            }}
          />
        }
      />

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            Anterior
          </button>
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-landing-text-muted)]">
            Pagina {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  role,
  onRoleChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  status: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  role: RoleFilter;
  onRoleChange: (v: RoleFilter) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_180px]">
      <div className="relative">
        <Search
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-landing-text-muted)]"
        />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por DNI o nombre"
          aria-label="Buscar usuarios"
          className="pl-6"
        />
      </div>
      <SelectFilter
        ariaLabel="Filtrar por status"
        value={status}
        onChange={onStatusChange}
        options={STATUS_OPTIONS}
      />
      <SelectFilter
        ariaLabel="Filtrar por rol"
        value={role}
        onChange={onRoleChange}
        options={ROLE_OPTIONS}
      />
    </div>
  );
}

function SelectFilter<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-12 w-full rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] px-3 font-sans text-sm text-[var(--color-landing-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-landing-gold)] focus:ring-offset-2"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ status }: { status: AdminUser["status"] }) {
  const styles =
    status === "ACTIVE"
      ? "bg-[var(--color-landing-green)] text-[var(--color-landing-text)]"
      : status === "BANNED"
        ? "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]"
        : "bg-[var(--color-landing-surface)] text-[var(--color-landing-text-muted)]";
  const label =
    status === "ACTIVE" ? "Activo" : status === "BANNED" ? "Baneado" : "Inactivo";
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-2 py-1 font-sans text-xs font-bold uppercase tracking-wider",
        styles,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Menú de acciones por fila. Gestiona 4 mutaciones:
 *  - Activar / Reactivar     → updateUser({status: "ACTIVE"})
 *  - Desactivar              → updateUser({status: "INACTIVE"})
 *  - Banear                  → updateUser({status: "BANNED"})
 *  - Reset password          → resetUserPassword() → modal con password
 *
 * Las acciones de status muestran toast directo (operación rápida).
 * Reset password abre un modal con el password generado + botón
 * "Copiar" porque es info que el admin necesita comunicar al user
 * por fuera del sistema (WhatsApp).
 *
 * Invalidación: lista de users (`admin.users.list`). El optimistic
 * update no aplica acá porque la lista viene paginada — un refetch es
 * más simple y rápido.
 */
function UserActionsMenu({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null,
  );

  const statusMutation = useMutation({
    mutationFn: (status: "ACTIVE" | "INACTIVE" | "BANNED") =>
      updateUser(user.id, { status }),
    onSuccess: (_data, status) => {
      const verb =
        status === "ACTIVE"
          ? "reactivado"
          : status === "INACTIVE"
            ? "desactivado"
            : "baneado";
      toast.success(`${user.firstName} ${user.lastName} ${verb}`);
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.users.list(),
      });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos actualizar el usuario");
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetUserPassword(user.id),
    onSuccess: ({ password }) => {
      setGeneratedPassword(password);
      setResetOpen(true);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos resetear el password");
    },
  });

  const isActive = user.status === "ACTIVE";
  const isInactive = user.status === "INACTIVE";
  const isBanned = user.status === "BANNED";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Acciones para ${user.firstName} ${user.lastName}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm hover:bg-[var(--color-landing-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-landing-gold)]"
          disabled={statusMutation.isPending || resetMutation.isPending}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem asChild>
            <Link href={`/admin/usuarios/${user.id}`}>Ver detalle</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isInactive || isBanned ? (
            <DropdownMenuItem
              onSelect={() => statusMutation.mutate("ACTIVE")}
              className="text-[var(--color-landing-green)]"
            >
              Reactivar
            </DropdownMenuItem>
          ) : null}
          {isActive ? (
            <DropdownMenuItem onSelect={() => statusMutation.mutate("INACTIVE")}>
              Desactivar
            </DropdownMenuItem>
          ) : null}
          {!isBanned ? (
            <DropdownMenuItem
              onSelect={() => statusMutation.mutate("BANNED")}
              className="text-[var(--color-landing-red)]"
            >
              Banear
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => resetMutation.mutate()}>
            Reset password
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ResetPasswordDialog
        open={resetOpen}
        onOpenChange={(o) => {
          setResetOpen(o);
          if (!o) setGeneratedPassword(null);
        }}
        userName={`${user.firstName} ${user.lastName}`}
        password={generatedPassword}
      />
    </>
  );
}

/**
 * Modal post-reset. Muestra el password generado UNA SOLA VEZ con
 * un botón de copiar al portapapeles. El backend rota refresh tokens
 * activos del user, así que esta password queda firme hasta que el
 * user la cambie. El admin la comunica por WhatsApp.
 */
function ResetPasswordDialog({
  open,
  onOpenChange,
  userName,
  password,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  password: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No pudimos copiar al portapapeles");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          <span className="inline-block border-b-[3px] border-[var(--color-landing-green)] pb-1">
            Password reseteado
          </span>
        </DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          Nuevo password para <strong>{userName}</strong>. Compartilo por
          WhatsApp — solo se muestra una vez.
        </DialogDescription>
        {password ? (
          <div className="mt-3 flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)] p-3">
            <code className="flex-1 font-[family-name:var(--font-landing-mono)] text-base tracking-wider text-[var(--color-landing-gold)]">
              {password}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-3 py-1.5 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)]"
              aria-label="Copiar password"
            >
              <Copy className="h-3 w-3" aria-hidden />
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)]"
          >
            Listo
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
