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
 * Las columnas se pasan como ColumnDef estandar. Si una columna requiere
 * un menu de acciones, el componente helper `<RowActionsCell>` ayuda a
 * detener propagacion para que `onRowClick` no se dispare al abrir el menu.
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
      <div className="overflow-x-auto rounded-md border border-[var(--color-prode-border)] bg-white">
        <table
          className="w-full border-collapse"
          aria-label={ariaLabel}
        >
          <thead className="border-b border-[var(--color-prode-border)] bg-[var(--color-prode-surface)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    scope="col"
                    className="px-4 py-3 text-left font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]"
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
                  className="border-b border-[var(--color-prode-border)]"
                >
                  {Array.from({ length: skeletonCount }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full max-w-[120px] animate-pulse rounded bg-[var(--color-prode-surface)]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center font-sans text-sm text-[var(--color-prode-text-secondary)]"
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
        "border-b border-[var(--color-prode-border)] last:border-b-0",
        interactive &&
          "cursor-pointer transition-colors hover:bg-[var(--color-prode-surface)]",
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
          className="px-4 py-3 align-middle font-sans text-sm text-[var(--color-prode-near-black)]"
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
