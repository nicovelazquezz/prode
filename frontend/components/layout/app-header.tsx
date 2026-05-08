"use client";

import { useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { EntrySwitcher } from "@/components/domain/entry-switcher";
import { NewEntryModal } from "@/components/domain/new-entry-modal";
import { ActiveEntryContext } from "@/providers/active-entry-provider";
import { useAuth } from "@/lib/hooks/use-auth";
import { queryKeys } from "@/lib/api/queryKeys";
import { getEntrySpecialPrediction } from "@/lib/api/predictions";
import { cn } from "@/lib/utils/cn";

interface AppHeaderProps {
  /**
   * Nombre del usuario para saludo. El layout autenticado lo deriva
   * de `useAuth()` y lo pasa explicito; default "Usuario" cubre tests
   * aislados que renderean el header sin contexto.
   */
  userName?: string;
  className?: string;
}

interface NavTab {
  href: string;
  label: string;
}

const NAV_TABS: NavTab[] = [
  { href: "/predicciones", label: "Predicciones" },
  { href: "/especiales", label: "Especiales" },
  { href: "/leaderboard", label: "Tabla" },
  { href: "/ligas", label: "Ligas" },
  { href: "/perfil", label: "Perfil" },
];

/**
 * Header para zonas autenticadas (predicciones, especiales,
 * leaderboard, ligas, perfil). Tema dark editorial: bg landing-bg,
 * brand display Oswald, tabs en mono uppercase tracked.
 *
 *  - Mobile: brand + greeting + logout (icon only). Tabs ocultas
 *    porque el `<BottomNav>` cubre la navegacion.
 *  - Desktop (md+): tabs centradas con active state underline verde,
 *    logout con icon + label "Salir".
 *
 * Logout: usa `useAuth().logout()` que limpia state local y cookies
 * server-side. La redireccion a /login la dispara el guard del
 * `(app)/layout.tsx` cuando user pasa a null.
 */
export function AppHeader({ userName = "Usuario", className }: AppHeaderProps) {
  const pathname = usePathname();
  const { logout } = useAuth();
  // Lectura "soft" del ActiveEntryContext: si el header se monta fuera
  // del provider (tests aislados, /admin), simplemente no renderiza el
  // EntrySwitcher en lugar de tirar.
  const activeEntryCtx = useContext(ActiveEntryContext);
  const queryClient = useQueryClient();
  const [newEntryOpen, setNewEntryOpen] = useState(false);

  const handleLogout = () => {
    void logout();
  };

  // Prefetch de la special prediction al hacer hover sobre la tab
  // "Especiales". Cuando el user clickea, los datos ya estan en cache y
  // la pagina renderiza instantaneo sin pegar al backend. Solo aplica en
  // desktop (hover); mobile usa BottomNav que renderea sin prefetch
  // — el costo de un fetch extra ahi no compensa.
  //
  // No-op si:
  //   - no hay activeEntry (user todavia no resolvio entries)
  //   - el cache ya esta fresco (staleTime 30s respetado por prefetchQuery)
  //   - se monta fuera de QueryClientProvider (improbable; el (app)
  //     layout siempre lo provee)
  const prefetchEspeciales = () => {
    const entryId = activeEntryCtx?.activeEntry?.id;
    if (!entryId) return;
    void queryClient.prefetchQuery({
      queryKey: queryKeys.entries.special(entryId),
      queryFn: () => getEntrySpecialPrediction(entryId),
      staleTime: 30_000,
    });
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        "bg-[var(--color-landing-bg)] border-b border-[var(--color-landing-line)]",
        "h-14 md:h-16",
        className,
      )}
    >
      <div className="mx-auto grid h-full max-w-[1440px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 md:px-8">
        {/* Brand + greeting + switcher */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/predicciones"
            className="flex items-center gap-3 min-w-0"
            aria-label="Ir a mis predicciones"
          >
            <span
              className="font-[family-name:var(--font-landing-display)] text-[18px] uppercase tracking-[0.04em] leading-none text-[var(--color-landing-text)]"
            >
              Prode
            </span>
            <span
              className="hidden sm:inline font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] truncate max-w-[180px]"
            >
              Hola, {userName}
            </span>
          </Link>
          {/*
            EntrySwitcher: visible cuando el header se monta dentro del
            ActiveEntryProvider (todo el (app)). Se renderiza tanto en
            mobile como desktop — en mobile aparece pegado al saludo,
            con el dropdown abriéndose hacia abajo desde el header.
          */}
          {activeEntryCtx ? (
            <EntrySwitcher onCreateNew={() => setNewEntryOpen(true)} />
          ) : null}
        </div>

        {/* Desktop tabs (centro) */}
        <nav
          aria-label="Navegacion principal"
          className="hidden md:flex items-center justify-center gap-1"
        >
          {NAV_TABS.map(({ href, label }) => {
            const isActive =
              pathname === href || (pathname?.startsWith(href + "/") ?? false);
            const isEspeciales = href === "/especiales";
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                onMouseEnter={isEspeciales ? prefetchEspeciales : undefined}
                onFocus={isEspeciales ? prefetchEspeciales : undefined}
                className={cn(
                  "relative inline-flex h-16 items-center px-4",
                  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]",
                  "transition-colors duration-200",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--color-landing-gold)]",
                  isActive
                    ? "text-[var(--color-landing-text)] before:absolute before:bottom-0 before:left-3 before:right-3 before:h-[2px] before:bg-[var(--color-landing-green)]"
                    : "text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Spacer para mobile (la nav se oculta) — la grid ya distribuye */}
        <div className="md:hidden" />

        {/* Logout (derecha) */}
        <button
          type="button"
          onClick={handleLogout}
          aria-label="Cerrar sesion"
          className={cn(
            "inline-flex items-center gap-2 px-2 py-2 -mr-2",
            "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]",
            "text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]",
            "transition-colors duration-200",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
            "cursor-pointer",
          )}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">Salir</span>
        </button>
      </div>
      {/*
        NewEntryModal: vive a nivel del header para que el CTA del
        EntrySwitcher pueda abrirlo sin acoplar el switcher al modal.
        No se monta si el header corre fuera del ActiveEntryProvider.
      */}
      {activeEntryCtx ? (
        <NewEntryModal
          open={newEntryOpen}
          onOpenChange={setNewEntryOpen}
        />
      ) : null}
    </header>
  );
}
