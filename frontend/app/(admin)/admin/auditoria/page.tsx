"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAudit, type AuditEntry } from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * /admin/auditoria (spec §6.11). Tabla con filtros (entity, action,
 * userId, date range) + filas expandibles que muestran el JSON de
 * `changes: { before, after }` formateado.
 *
 * No usa AdminDataTable porque necesitamos rows expandibles con un
 * <tr> extra debajo de cada row clickeada.
 */
export default function AdminAuditoriaPage() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      page,
      pageSize: 50,
      entity: entity || undefined,
      action: action || undefined,
      userId: userId || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    [page, entity, action, userId, fromDate, toDate],
  );

  const auditQuery = useQuery({
    queryKey: queryKeys.admin.audit(filters),
    queryFn: () => listAudit(filters),
    placeholderData: (prev) => prev,
    retry: false,
  });

  const total = auditQuery.data?.total ?? 0;
  const pageSize = auditQuery.data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const items = auditQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Auditoria
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Bitacora de cambios en el sistema. Click en una fila para ver el
          diff completo.
        </p>
      </header>

      <section
        aria-label="Filtros"
        className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5"
      >
        <FilterField label="Entity">
          <Input
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setPage(1);
            }}
            placeholder="ej: User, Match"
          />
        </FilterField>
        <FilterField label="Action">
          <Input
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="ej: UPDATE, DELETE"
          />
        </FilterField>
        <FilterField label="User ID">
          <Input
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPage(1);
            }}
          />
        </FilterField>
        <FilterField label="Desde">
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
        </FilterField>
        <FilterField label="Hasta">
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </FilterField>
      </section>

      <div className="overflow-x-auto rounded-md border border-[var(--color-prode-border)] bg-white">
        <table className="w-full border-collapse" aria-label="Tabla de auditoria">
          <thead className="border-b border-[var(--color-prode-border)] bg-[var(--color-prode-surface)]">
            <tr>
              <th
                scope="col"
                className="w-10 px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              />
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              >
                Fecha
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              >
                Entity
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              >
                Action
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              >
                User
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              >
                Entity ID
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
              >
                IP
              </th>
            </tr>
          </thead>
          <tbody>
            {auditQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <div
                    role="status"
                    aria-busy="true"
                    className="mx-auto h-4 w-32 animate-pulse rounded bg-[var(--color-prode-surface)]"
                  />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center font-sans text-sm text-[var(--color-prode-text-secondary)]"
                >
                  Sin entradas para los filtros aplicados.
                </td>
              </tr>
            ) : (
              items.map((entry) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  expanded={expanded === entry.id}
                  onToggle={() =>
                    setExpanded((prev) => (prev === entry.id ? null : entry.id))
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-[var(--color-prode-border)] bg-white px-4 py-2 font-sans text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[var(--color-prode-surface)]"
          >
            Anterior
          </button>
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Pagina {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-[var(--color-prode-border)] bg-white px-4 py-2 font-sans text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[var(--color-prode-surface)]"
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <tr
        className={cn(
          "border-b border-[var(--color-prode-border)]",
          "cursor-pointer transition-colors hover:bg-[var(--color-prode-surface)]",
        )}
        onClick={onToggle}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter") onToggle();
        }}
      >
        <td className="px-4 py-3 align-middle">
          {expanded ? (
            <ChevronDown
              className="h-4 w-4 text-[var(--color-prode-text-secondary)]"
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="h-4 w-4 text-[var(--color-prode-text-secondary)]"
              aria-hidden
            />
          )}
        </td>
        <td className="px-4 py-3 align-middle font-sans text-xs">
          {formatDateTime(entry.createdAt)}
        </td>
        <td className="px-4 py-3 align-middle font-mono text-xs">
          {entry.entity}
        </td>
        <td className="px-4 py-3 align-middle font-sans text-sm">
          {entry.action}
        </td>
        <td className="px-4 py-3 align-middle font-mono text-xs text-[var(--color-prode-text-secondary)]">
          {entry.userId ?? "—"}
        </td>
        <td className="px-4 py-3 align-middle font-mono text-xs text-[var(--color-prode-text-secondary)]">
          {entry.entityId ?? "—"}
        </td>
        <td className="px-4 py-3 align-middle font-mono text-xs text-[var(--color-prode-text-secondary)]">
          {entry.ipAddress ?? "—"}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-[var(--color-prode-border)] bg-[var(--color-prode-surface)]">
          <td colSpan={7} className="px-4 py-4">
            <ChangesViewer changes={entry.changes} />
            {entry.userAgent ? (
              <p className="mt-3 font-mono text-xs text-[var(--color-prode-text-secondary)]">
                UA: {entry.userAgent}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function ChangesViewer({ changes }: { changes: unknown }) {
  if (!changes) {
    return (
      <p className="font-sans text-xs italic text-[var(--color-prode-text-secondary)]">
        Sin diff registrado.
      </p>
    );
  }
  const hasBeforeAfter =
    typeof changes === "object" &&
    changes !== null &&
    ("before" in changes || "after" in changes);

  if (hasBeforeAfter) {
    const obj = changes as { before?: unknown; after?: unknown };
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Before
          </p>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-[var(--color-prode-border)] bg-white p-3 font-mono text-xs">
            {JSON.stringify(obj.before ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            After
          </p>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-[var(--color-prode-border)] bg-white p-3 font-mono text-xs">
            {JSON.stringify(obj.after ?? null, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-[var(--color-prode-border)] bg-white p-3 font-mono text-xs">
      {JSON.stringify(changes, null, 2)}
    </pre>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
