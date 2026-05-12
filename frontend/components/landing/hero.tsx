import Link from "next/link";
import { Info, MessageCircle } from "lucide-react";
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

interface HeroProps {
  daysToKickoff: number;
}

/**
 * Hero principal: eyebrow live (rojo pulsante), H1 a dos líneas
 * con underline verde en la segunda, lede, doble CTA y mini-meta
 * con info de pago.
 */
export function Hero({ daysToKickoff }: HeroProps) {
  const { hero } = LANDING;
  const [titleFirst, titleSecond] = hero.h1Lines;
  return (
    <section
      className="px-8 pb-12 pt-10 md:pt-[70px]"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(62,84,137,0.18) 0%, transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-3 whitespace-nowrap font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.04em] text-[var(--color-landing-red)] sm:text-[11px] sm:tracking-[0.22em]">
        <span className="landing-pulse h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--color-landing-red)] shadow-[0_0_12px_var(--color-landing-red)]" />
        <span>
          {hero.eyebrowPrefix} {daysToKickoff} {hero.eyebrowSuffix}
        </span>
      </div>
      <h1 className="mb-5 font-[family-name:var(--font-landing-display)] text-[64px] uppercase leading-[0.85] tracking-[-0.025em] md:text-[96px]">
        {titleFirst}
        <br />
        {hero.underlineSecondLine ? (
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
            {titleSecond}
          </span>
        ) : (
          titleSecond
        )}
      </h1>
      <p className="mb-7 max-w-[540px] text-base leading-relaxed text-[var(--color-landing-text-muted)]">
        {inlineBold(hero.lede)}
      </p>
      <div className="mb-3.5 flex flex-wrap gap-3">
        <div className="flex gap-3">
          <Link
            href={hero.primaryHref}
            className="rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
          >
            {hero.primaryCta}
          </Link>
          <a
            href="#como-funciona"
            aria-label="Cómo funciona"
            title="Cómo funciona"
            className="inline-flex shrink-0 items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] p-[18px] text-[var(--color-landing-text-muted)] transition-colors hover:border-[var(--color-landing-text)] hover:text-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
          >
            <Info aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          </a>
        </div>
        <a
          href={hero.secondaryHref}
          target={"secondaryExternal" in hero && hero.secondaryExternal ? "_blank" : undefined}
          rel={"secondaryExternal" in hero && hero.secondaryExternal ? "noopener noreferrer" : undefined}
          className="inline-flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] px-7 py-[18px] text-xs font-semibold uppercase tracking-[0.12em] whitespace-nowrap text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          {"secondaryIcon" in hero && hero.secondaryIcon === "whatsapp" ? (
            <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          ) : null}
          {hero.secondaryCta}
        </a>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-[family-name:var(--font-landing-mono)] text-[11px] tracking-[0.1em] text-[var(--color-landing-text-muted)]">
        <strong className="text-[var(--color-landing-gold)]">{hero.miniMeta}</strong>
        <span>{hero.paymentMethods}</span>
      </div>
      </div>
    </section>
  );
}
