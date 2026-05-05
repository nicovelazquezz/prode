"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ActiveEntryProvider } from "@/providers/active-entry-provider";
import { useAuth } from "@/lib/hooks/use-auth";

/**
 * Layout para zonas autenticadas: predicciones, especiales,
 * leaderboard, ligas, perfil.
 *
 * Guard client-side: si el AuthProvider termino el bootstrap
 * (`isLoading=false`) y `user` es null, redirect a /login.
 * Mientras esta loading, muestra un skeleton (no flash).
 *
 * Visual: aplica el tema dark editorial (paleta `--color-landing-*`)
 * a todo el subtree autenticado para que matchee con la landing.
 *
 * NOTA: este es un guard client-side de UX. La autenticacion real
 * la enforcement el backend en cada endpoint protegido. Si alguien
 * deshabilita el guard JS, igual recibe 401s del backend.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-landing-bg)] text-[var(--color-landing-text)]">
        <div className="sticky top-0 h-14 md:h-16 bg-[var(--color-landing-bg)] border-b border-[var(--color-landing-line)]" />
        <main className="flex-1 px-4 py-6 md:px-8" aria-busy="true">
          <div className="space-y-4 max-w-2xl mx-auto">
            <div className="h-12 w-2/3 bg-[var(--color-landing-surface)] rounded-md animate-pulse" />
            <div className="h-32 bg-[var(--color-landing-surface)] rounded-md animate-pulse" />
            <div className="h-32 bg-[var(--color-landing-surface)] rounded-md animate-pulse" />
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    // Redirect ya disparado en el efecto; renderizamos vacio para
    // no flashear contenido protegido durante el frame de transicion.
    return null;
  }

  return (
    <ActiveEntryProvider>
      <div className="min-h-screen flex flex-col bg-[var(--color-landing-bg)] text-[var(--color-landing-text)]">
        <AppHeader userName={user.firstName} />
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
        <BottomNav />
      </div>
    </ActiveEntryProvider>
  );
}
