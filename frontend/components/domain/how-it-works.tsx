import { CtaCard } from "./cta-card";
import { cn } from "@/lib/utils/cn";

interface HowItWorksProps {
  className?: string;
}

const STEPS = [
  {
    step: "01",
    title: "Registrate",
    description:
      "Pagas la inscripcion por MercadoPago o transferencia, completas tus datos y listo. Te llega el acceso por WhatsApp.",
    variant: "cyan" as const,
  },
  {
    step: "02",
    title: "Predeci los 104 partidos",
    description:
      "Cargas tus pronosticos antes de cada kickoff. Sumas puntos por acertar el resultado, la diferencia o el ganador.",
    variant: "accent" as const,
  },
  {
    step: "03",
    title: "Gana",
    description:
      "Los mejores rankings de cada fase y de la tabla general se llevan los premios del pozo. La final paga el podio entero.",
    variant: "dark" as const,
  },
];

/**
 * Seccion "Como funciona" del landing.
 *
 * Mobile: scroll horizontal con snap (`snap-x snap-mandatory`).
 * Desktop: grid 3 columnas.
 *
 * Decision intencional: en mobile, el scroll horizontal es mas claro
 * que un stack vertical (que rompe el ritmo del landing).
 */
export function HowItWorks({ className }: HowItWorksProps) {
  return (
    <section
      className={cn(
        "py-12 md:py-20 bg-[var(--color-prode-bg)]",
        className,
      )}
      aria-labelledby="how-it-works-heading"
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <h2
          id="how-it-works-heading"
          className="font-display text-4xl md:text-6xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)] mb-8 md:mb-12"
        >
          Como funciona
        </h2>
        {/* Mobile scroll-snap, desktop grid */}
        <div
          className={cn(
            "flex md:grid md:grid-cols-3 md:gap-6",
            "-mx-4 px-4 md:mx-0 md:px-0",
            "gap-4 overflow-x-auto md:overflow-visible",
            "snap-x snap-mandatory md:snap-none",
            "scroll-pl-4 md:scroll-pl-0",
            "scrollbar-thin",
          )}
        >
          {STEPS.map((s) => (
            <div
              key={s.step}
              className="flex-none w-[85%] sm:w-[70%] md:w-auto snap-start"
            >
              <CtaCard
                step={s.step}
                title={s.title}
                description={s.description}
                variant={s.variant}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
