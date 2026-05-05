import { PublicHeader } from "@/components/layout/public-header";
import Link from "next/link";

/**
 * Layout para zonas publicas (landing, login, completar-registro,
 * forgot/reset, reglamento, inscripcion success/failure/pending).
 *
 * Sin guards — cualquier visitante puede ver. PublicHeader sticky
 * arriba; footer simple abajo.
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
      <main className="flex-1">{children}</main>
      <footer className="bg-[var(--color-prode-near-black)] text-white">
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
