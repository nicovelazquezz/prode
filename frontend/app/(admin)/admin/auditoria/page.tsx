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
        <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">Trazabilidad</div>

        <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">

          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">

            Auditoria

          </span>

        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-landing-text-muted)]">
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

      <div className="overflow-x-auto rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)]">
        <table className="w-full border-collapse" aria-label="Tabla de auditoria">
          <thead className="border-b border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)]">
            <tr>
              <th
                scope="col"
                className="w-10 px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              />
              <th
                scope="col"
                className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Fecha
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Entity
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Action
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                User
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
              >
                Entity ID
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
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
                    className="mx-auto h-4 w-32 animate-pulse rounded bg-[var(--color-landing-surface)]"
                  />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center font-sans text-sm text-[var(--color-landing-text-muted)]"
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
          "border-b border-[var(--color-landing-line-strong)]",
          "cursor-pointer transition-colors hover:bg-[var(--color-landing-surface)]",
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
              className="h-4 w-4 text-[var(--color-landing-text-muted)]"
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="h-4 w-4 text-[var(--color-landing-text-muted)]"
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
        <td className="px-4 py-3 align-middle font-mono text-xs text-[var(--color-landing-text-muted)]">
          {entry.userId ?? "—"}
        </td>
        <td className="px-4 py-3 align-middle font-mono text-xs text-[var(--color-landing-text-muted)]">
          {entry.entityId ?? "—"}
        </td>
        <td className="px-4 py-3 align-middle font-mono text-xs text-[var(--color-landing-text-muted)]">
          {entry.ipAddress ?? "—"}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)]">
          <td colSpan={7} className="px-4 py-5">
            <ChangesViewer changes={entry.changes} />
            {entry.userAgent ? (
              <p className="mt-3 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
                <span className="text-[var(--color-landing-gold)]">UA:</span>{" "}
                {entry.userAgent}
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
      <p className="font-sans text-xs italic text-[var(--color-landing-text-muted)]">
        Sin diff registrado.
      </p>
    );
  }
  const hasBeforeAfter =
    typeof changes === "object" &&
    changes !== null &&
    ("before" in changes || "after" in changes);

  const codeBlockBase =
    "max-h-64 overflow-auto rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-bg)] p-3 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text)]";

  const labelBase =
    "font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em]";

  if (hasBeforeAfter) {
    const obj = changes as { before?: unknown; after?: unknown };
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className={cn(labelBase, "text-[var(--color-landing-red)]")}>
            Before
          </p>
          <pre className={cn(codeBlockBase, "mt-1 [border-left-color:var(--color-landing-red)] border-l-[3px]")}>
            {JSON.stringify(obj.before ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <p className={cn(labelBase, "text-[var(--color-landing-green)]")}>
            After
          </p>
          <pre className={cn(codeBlockBase, "mt-1 [border-left-color:var(--color-landing-green)] border-l-[3px]")}>
            {JSON.stringify(obj.after ?? null, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <pre className={codeBlockBase}>
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
