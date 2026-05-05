import { PublicHeader } from "@/components/layout/public-header";
import Link from "next/link";

/**
 * Layout para zonas publicas (landing, login, completar-registro,
 * forgot/reset, reglamento, inscripcion success/failure/pending).
 *
 * Sin guards — cualquier visitante puede ver. PublicHeader fixed
 * arriba (transparente en `/`, navy solido en otras rutas); footer
 * dark abajo con CTA repetida.
 *
 * Es un Server Component (RSC) — la landing es estatica con widgets
 * client-side puntuales (countdown, stats live).
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      {/* El header es fixed (h-14 mobile / h-16 desktop). Le damos
          padding-top a main para que el contenido no quede tapado.
          La landing usa `-mt-14 md:-mt-16` en su section hero para
          permitir que el navy se extienda hasta arriba — el header
          va transparente sobre el. */}
      <main className="flex-1 pt-14 md:pt-16">{children}</main>
      <footer className="bg-[var(--color-prode-near-black)] text-white">
        {/* Banda CTA repetida — ultima oportunidad de conversion antes
            del footer institucional. Solo se muestra en pantallas con
            espacio (sm+) — en mobile, el CTA principal queda muy cerca. */}
        <div className="border-b border-white/10">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-8 md:py-14">
            <p
              className="font-display font-black uppercase tracking-tight leading-[0.9]"
              style={{
                fontSize: "clamp(28px, 4vw, 48px)",
              }}
            >
              Listo para
              <br className="md:hidden" /> jugar?
            </p>
            <Link
              href="/#sumarse"
              className={cnFooterCta}
            >
              Sumate al Prode
              <span aria-hidden="true" className="inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>

        {/* Footer institucional */}
        <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8 md:py-14 grid gap-6 md:grid-cols-3 text-sm">
          <div>
            <p className="font-display text-2xl font-black uppercase tracking-wide">
              Prode 2026
            </p>
            <p className="mt-2 text-white/70">
              Club Tiro Federal de Bahía Blanca
            </p>
          </div>
          <nav className="flex flex-col gap-2 text-white/80">
            <Link href="/reglamento" className="hover:text-white">
              Reglamento
            </Link>
            <Link href="/login" className="hover:text-white">
              Ingresar
            </Link>
          </nav>
          <p className="text-white/50 text-xs leading-relaxed">
            Pronósticos del Mundial 2026. No es un juego de azar:
            requiere análisis y conocimiento. Mayores de 18 años.
          </p>
        </div>
      </footer>
    </>
  );
}

const cnFooterCta = [
  "group inline-flex items-center justify-center gap-3",
  "px-7 py-4 rounded-pill",
  "bg-[var(--color-prode-accent)] text-white",
  "font-sans font-semibold text-base whitespace-nowrap",
  "transition-colors duration-300 ease-out",
  "hover:bg-white hover:text-[var(--color-prode-accent)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-prode-near-black)]",
  "self-start md:self-auto",
].join(" ");
