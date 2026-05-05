import { cn } from "@/lib/utils/cn";

/**
 * Variantes vibrantes para las cards "Como funciona" del landing.
 * Cada variante define background + colores de texto. Numero (01/02/03)
 * y titulo se renderizan con la familia display, descripcion en sans.
 */
export type CtaCardVariant = "cyan" | "accent" | "dark";

interface CtaCardProps {
  /** Numero del paso, ej "01" / "02". Se renderiza display gigante. */
  step: string;
  title: string;
  description: string;
  variant: CtaCardVariant;
  className?: string;
}

const VARIANT_STYLES: Record<
  CtaCardVariant,
  { container: string; step: string; title: string; description: string }
> = {
  cyan: {
    // Cyan vibrante (similar al token #4bd7e6 del DESIGN.md), dark text
    container: "bg-[#4bd7e6] text-[var(--color-prode-near-black)]",
    step: "text-[var(--color-prode-near-black)]/15",
    title: "text-[var(--color-prode-near-black)]",
    description: "text-[var(--color-prode-near-black)]/80",
  },
  accent: {
    container: "bg-[var(--color-prode-accent)] text-white",
    step: "text-white/20",
    title: "text-white",
    description: "text-white/85",
  },
  dark: {
    container: "bg-[var(--color-prode-near-black)] text-white",
    step: "text-white/15",
    title: "text-white",
    description: "text-white/75",
  },
};

/**
 * Card "Como funciona" — usado en el landing page con horizontal scroll
 * snap en mobile y grid en desktop.
 *
 * Aspecto: numero gigante semi-translucido en background, titulo display
 * uppercase 32-40px, descripcion sans 14-16px.
 */
export function CtaCard({
  step,
  title,
  description,
  variant,
  className,
}: CtaCardProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <article
      className={cn(
        "relative flex flex-col justify-between overflow-hidden",
        "rounded-md p-6 md:p-8",
        "min-h-[280px] md:min-h-[340px] h-full",
        // Hover lift + transicion suave (desktop). Mobile: sin hover,
        // las cards estan en scroll-snap horizontal y no necesitan lift.
        "transition-transform duration-300 ease-out",
        "md:hover:-translate-y-1 motion-reduce:hover:translate-y-0",
        styles.container,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-2 -right-2 select-none leading-none",
          "font-display font-black",
          "text-[140px] md:text-[180px]",
          styles.step,
        )}
      >
        {step}
      </span>
      <div className="relative flex flex-col gap-3 md:gap-4">
        <span
          className={cn(
            "font-sans text-[10px] md:text-xs font-bold uppercase tracking-wider",
            styles.description,
          )}
        >
          Paso {step}
        </span>
        <h3
          className={cn(
            "font-display font-black uppercase leading-tight tracking-wide",
            "text-3xl md:text-4xl",
            styles.title,
          )}
        >
          {title}
        </h3>
      </div>
      <p
        className={cn(
          "relative font-sans text-sm md:text-base mt-6",
          styles.description,
        )}
      >
        {description}
      </p>
    </article>
  );
}
