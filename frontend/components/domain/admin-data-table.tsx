"use client";

import { type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils/cn";

interface AdminDataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  /**
   * Si se pasa, se usa para invocar `onClick(row)` cuando el user
   * clickea en una fila (no celda). Ideal para abrir un drawer de
   * detalle. Si las columnas tienen acciones (botones), esas paran
   * la propagacion para no disparar el row click.
   */
  onRowClick?: (row: TData) => void;
  loading?: boolean;
  /** Mensaje cuando data esta vacio. */
  emptyMessage?: string;
  /** Slot opcional encima de la tabla (filtros, search). */
  toolbar?: ReactNode;
  /**
   * Numero de columnas a mostrar como skeleton mientras carga
   * (igual a columns.length). Si no se pasa lo deduce.
   */
  skeletonRows?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Tabla generica para el panel admin construida sobre @tanstack/react-table.
 * Mobile: scroll horizontal con sticky header. Desktop: layout normal.
 *
 * Visual: dark editorial. Header con bg surface y mono uppercase
 * tracked, filas separadas por border line, hover surface-2.
 */
export function AdminDataTable<TData>({
  data,
  columns,
  onRowClick,
  loading = false,
  emptyMessage = "Sin resultados.",
  toolbar,
  skeletonRows,
  className,
  ariaLabel,
}: AdminDataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const skeletonCount = skeletonRows ?? columns.length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {toolbar}
      <div className="overflow-x-auto rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)]">
        <table className="w-full border-collapse" aria-label={ariaLabel}>
          <thead className="border-b border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface-2)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    scope="col"
                    className="px-4 py-3 text-left font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
                  >
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr
                  key={`sk-${i}`}
                  className="border-b border-[var(--color-landing-line)]"
                >
                  {Array.from({ length: skeletonCount }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full max-w-[120px] animate-pulse rounded-sm bg-[var(--color-landing-surface-2)]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <RowView
                  key={row.id}
                  row={row}
                  onRowClick={onRowClick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowView<TData>({
  row,
  onRowClick,
}: {
  row: Row<TData>;
  onRowClick?: (row: TData) => void;
}) {
  const interactive = Boolean(onRowClick);
  return (
    <tr
      className={cn(
        "border-b border-[var(--color-landing-line)] last:border-b-0",
        interactive &&
          "cursor-pointer transition-colors hover:bg-[var(--color-landing-surface-2)]",
      )}
      onClick={interactive ? () => onRowClick?.(row.original) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") onRowClick?.(row.original);
            }
          : undefined
      }
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className="px-4 py-3 align-middle font-sans text-sm text-[var(--color-landing-text)]"
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

/**
 * Wrapper para celdas de acciones que detiene la propagacion
 * para no disparar `onRowClick` cuando se abre el menu o se
 * presiona un boton dentro de la celda.
 */
export function RowActionsCell({ children }: { children: ReactNode }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center justify-end gap-2"
    >
      {children}
    </div>
  );
}
