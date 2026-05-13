/**
 * Paginador shared usado por las páginas de leaderboard (global, liga)
 * y por la sección de predicciones del admin. Antes vivía duplicado
 * como función local en cada página; centralizado acá para tener un
 * solo lugar donde ajustar copy, accesibilidad o estilos.
 *
 * Se auto-oculta cuando `totalPages <= 1` — el caller no tiene que
 * pensar si renderizar o no.
 */

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (totalPages <= 1) return null;

  const navBtn =
    "rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={navBtn}
      >
        ← Anterior
      </button>
      <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
        Página {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={navBtn}
      >
        Siguiente →
      </button>
    </div>
  );
}
