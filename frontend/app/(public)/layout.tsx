import { LandingTopbar } from "@/components/landing/landing-topbar";
import { LandingFooter } from "@/components/landing/landing-footer";

/**
 * Layout para zonas públicas (login, completar-registro, forgot/reset,
 * reglamento, inscripcion success/failure/pending).
 *
 * Usa la estética stadium de la landing — navy bg + cream text + grain
 * overlay vía .landing-root, con LandingTopbar arriba y LandingFooter
 * abajo. Es Server Component; cada página decide su propio contenido.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="landing-root flex min-h-screen flex-col bg-[var(--color-landing-bg)] text-[var(--color-landing-text)]">
      <LandingTopbar />
      <main className="flex-1">{children}</main>
      <LandingFooter />
    </div>
  );
}
