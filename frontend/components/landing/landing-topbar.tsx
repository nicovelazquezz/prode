import Link from "next/link";
import { LANDING } from "@/lib/landing/content";

export function LandingTopbar() {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-landing-line)] px-8 py-3.5 font-[family-name:var(--font-landing-mono)] text-xs tracking-wider text-[var(--color-landing-text-muted)]">
      <div className="font-medium tracking-[0.12em] text-[var(--color-landing-text)]">
        {LANDING.topbar.brand}
      </div>
      <Link
        href={LANDING.topbar.loginHref}
        className="whitespace-nowrap rounded-sm border border-[var(--color-landing-line-strong)] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
      >
        {LANDING.topbar.loginCta}
      </Link>
    </div>
  );
}
