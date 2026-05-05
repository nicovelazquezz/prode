import Link from "next/link";
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
      className="px-8 pb-12 pt-[70px]"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(62,84,137,0.18) 0%, transparent 60%)",
      }}
    >
      <div className="mb-6 flex items-center gap-3 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-red)]">
        <span className="landing-pulse h-[7px] w-[7px] rounded-full bg-[var(--color-landing-red)] shadow-[0_0_12px_var(--color-landing-red)]" />
        {hero.eyebrowPrefix} {daysToKickoff} {hero.eyebrowSuffix}
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
        <Link
          href={hero.primaryHref}
          className="rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          {hero.primaryCta}
        </Link>
        <Link
          href={hero.secondaryHref}
          className="rounded-sm border border-[var(--color-landing-line-strong)] px-7 py-[18px] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          {hero.secondaryCta}
        </Link>
      </div>
      <div className="mt-4 font-[family-name:var(--font-landing-mono)] text-[11px] tracking-[0.1em] text-[var(--color-landing-text-muted)]">
        {hero.miniMeta.split(" · ").map((part, i, arr) => (
          <span key={i}>
            {part.includes("11/JUN") ? (
              <strong className="text-[var(--color-landing-gold)]">{part}</strong>
            ) : (
              part
            )}
            {i < arr.length - 1 && " · "}
          </span>
        ))}
      </div>
    </section>
  );
}
