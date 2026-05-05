/**
 * Placeholder del dashboard admin — la implementacion con metricas
 * llega en Phase 7. Por ahora solo confirma que el (admin) layout
 * monta, la sidebar se ve, y el guard de role=ADMIN funciona.
 */
export default function AdminDashboardPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
        Dashboard
      </h1>
      <p className="mt-3 font-sans text-sm text-[var(--color-prode-text-secondary)]">
        En construcción — Phase 7 agrega metricas (usuarios, recaudacion,
        predictions cargadas, proximo partido).
      </p>
    </div>
  );
}
