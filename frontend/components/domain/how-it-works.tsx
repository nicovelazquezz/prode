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
      "Te inscribís en 2 minutos. Pago seguro por MercadoPago o coordinás por WhatsApp con la comisión. Acceso al toque.",
    variant: "cyan" as const,
  },
  {
    step: "02",
    title: "Predeci los 104 partidos",
    description:
      "Cargás tus pronósticos antes de cada kickoff y vas viendo tu posición en la tabla en vivo. Acertar el resultado paga más que acertar solo el ganador.",
    variant: "accent" as const,
  },
  {
    step: "03",
    title: "Gana",
    description:
      "Premiamos al podio general, al mejor de cada fase y a los especiales: campeón del Mundial, goleador y total de goles. Los detalles del pozo se publican antes del kickoff.",
    variant: "dark" as const,
  },
];

/**
 * Seccion "Como funciona" del landing.
 *
 * Mobile: scroll horizontal con snap (`snap-x snap-mandatory`).
 * Desktop: grid 3 columnas con la card del medio levemente mas alta
 * (-12px translate) para romper la simetria sin afectar el flujo.
 *
 * Decision intencional: en mobile, el scroll horizontal es mas claro
 * que un stack vertical (que rompe el ritmo del landing).
 */
export function HowItWorks({ className }: HowItWorksProps) {
  return (
    <section
      className={cn(
        "py-16 md:py-24 bg-[var(--color-landing-bg)]",
        className,
      )}
      aria-labelledby="how-it-works-heading"
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <div className="mb-10 md:mb-14">
          <span className="font-sans text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-landing-red)] block mb-3">
            Tres pasos
          </span>
          <h2
            id="how-it-works-heading"
            className="font-display font-black uppercase tracking-tight text-[var(--color-landing-text)] leading-[0.9]"
            style={{
              fontSize: "clamp(40px, 7vw, 80px)",
            }}
          >
            Como funciona
          </h2>
        </div>

        {/* Mobile scroll-snap, desktop grid con stagger vertical */}
        <div
          className={cn(
            "flex md:grid md:grid-cols-3 md:gap-6 md:items-stretch",
            "-mx-4 px-4 md:mx-0 md:px-0",
            "gap-4 overflow-x-auto md:overflow-visible",
            "snap-x snap-mandatory md:snap-none",
            "scroll-pl-4 md:scroll-pl-0",
            "scrollbar-thin",
          )}
        >
          {STEPS.map((s, idx) => (
            <div
              key={s.step}
              className={cn(
                "flex-none w-[85%] sm:w-[70%] md:w-auto snap-start",
                // Card del medio sube 12px en desktop (stagger sutil)
                idx === 1 && "md:-translate-y-3",
              )}
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
