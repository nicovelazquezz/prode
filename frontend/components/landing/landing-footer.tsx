import Link from "next/link";
import { LANDING } from "@/lib/landing/content";

type FooterColumn = (typeof LANDING.footer.columns)[number];

function hasBody(col: FooterColumn): col is FooterColumn & { body: string } {
  return "body" in col && typeof col.body === "string";
}
function hasMuted(col: FooterColumn): col is FooterColumn & { muted: string } {
  return "muted" in col && typeof col.muted === "string";
}
function hasLinks(
  col: FooterColumn,
): col is FooterColumn & { links: ReadonlyArray<{ label: string; href: string }> } {
  return "links" in col && Array.isArray(col.links);
}

/**
 * Footer rico de 4 columnas: Organiza · Contacto · Prode · Cuenta.
 * Bar inferior con copyright y tagline.
 */
export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--color-landing-line)] bg-black/30 px-8 pb-6 pt-10">
      <div className="mb-7 grid grid-cols-1 gap-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
        {LANDING.footer.columns.map((col) => (
          <div key={col.title}>
            <h5 className="mb-3.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              {col.title}
            </h5>
            {hasBody(col) && (
              <p className="mb-2 text-sm leading-relaxed text-[var(--color-landing-text)]">
                {col.body}
              </p>
            )}
            {hasMuted(col) && (
              <p className="mb-2 text-xs leading-relaxed text-[var(--color-landing-text-muted)]">
                {col.muted}
              </p>
            )}
            {hasLinks(col) &&
              col.links.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="block text-sm leading-loose text-[var(--color-landing-text)] transition-colors hover:text-[var(--color-landing-gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
                >
                  {link.label}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col justify-between gap-2 border-t border-[var(--color-landing-line)] pt-4 font-[family-name:var(--font-landing-mono)] text-[10px] tracking-wider text-[var(--color-landing-text-muted)] md:flex-row">
        <span className="text-[var(--color-landing-text)]">{LANDING.footer.barLeft}</span>
        <span>{LANDING.footer.barRight}</span>
      </div>
    </footer>
  );
}
