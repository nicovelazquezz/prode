import { cn } from "@/lib/utils/cn";

interface PrizeRow {
  label: string;
  share: string;
  detail: string;
}

/**
 * Distribucion del pozo. Los porcentajes son ilustrativos para la
 * landing (la distribucion real se administra desde el panel admin
 * en `/admin/configuracion`). Cuando el cliente confirme valores
 * finales, ajustar estos textos.
 */
const PRIZES: PrizeRow[] = [
  {
    label: "1ro general",
    share: "40%",
    detail: "Mejor puntaje al final del Mundial",
  },
  {
    label: "2do general",
    share: "20%",
    detail: "Subcampeon de la tabla general",
  },
  {
    label: "3ro general",
    share: "10%",
    detail: "Tercer puesto del ranking final",
  },
  {
    label: "Mejor de cada fase",
    share: "25%",
    detail: "Repartido entre ganadores de Grupos, Octavos, Cuartos, Semis y Final",
  },
  {
    label: "Premios especiales",
    share: "5%",
    detail: "Campeon, goleador y total de goles aciertos",
  },
];

/**
 * Tabla de premios — fila por categoria, simple, mobile-first.
 * No requiere estado, asi que es un Server Component puro.
 */
export function LandingPrizes() {
  return (
    <section
      className="bg-[var(--color-prode-surface)] py-12 md:py-20"
      aria-labelledby="prizes-heading"
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <h2
          id="prizes-heading"
          className="font-display text-4xl md:text-6xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)] mb-3"
        >
          Premios
        </h2>
        <p className="max-w-2xl font-sans text-sm md:text-base text-[var(--color-prode-text-secondary)] mb-8 md:mb-10">
          El 100% de las inscripciones va al pozo. Se reparte entre el
          podio general, los mejores de cada fase y los premios especiales.
        </p>

        <ul className="flex flex-col rounded-md border border-[var(--color-prode-border)] bg-white overflow-hidden">
          {PRIZES.map((p, idx) => (
            <li
              key={p.label}
              className={cn(
                "flex flex-col gap-1 p-4 md:flex-row md:items-center md:justify-between md:gap-6 md:p-6",
                idx !== PRIZES.length - 1 &&
                  "border-b border-[var(--color-prode-border)]",
              )}
            >
              <div className="flex flex-col">
                <span className="font-display text-xl md:text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
                  {p.label}
                </span>
                <span className="font-sans text-xs md:text-sm text-[var(--color-prode-text-secondary)]">
                  {p.detail}
                </span>
              </div>
              <span
                className={cn(
                  "font-display font-black leading-none tabular-nums",
                  "text-3xl md:text-4xl",
                  "text-[var(--color-prode-accent)]",
                )}
              >
                {p.share}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
