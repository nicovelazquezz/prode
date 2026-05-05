"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface AppHeaderProps {
  /**
   * Nombre del usuario para saludo. Hardcodeado en este skeleton —
   * Phase 3 lo conecta con `useAuth()`.
   */
  userName?: string;
  className?: string;
}

/**
 * Header para zonas autenticadas (predicciones, leaderboard, ligas,
 * perfil). Skeleton — auth se conecta en Phase 3.
 *
 * Sticky top, h-14 mobile / h-16 desktop, white bg con border-b.
 * Saludo a la izquierda, logout a la derecha.
 */
export function AppHeader({ userName = "Usuario", className }: AppHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        "bg-white border-b border-[var(--color-prode-border)]",
        "h-14 md:h-16",
        className,
      )}
    >
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 md:px-8">
        <Link
          href="/predicciones"
          className="flex items-center gap-3"
          aria-label="Ir a mis predicciones"
        >
          <span className="font-display text-lg md:text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            Prode
          </span>
          <span className="font-sans text-sm text-[var(--color-prode-text-secondary)] truncate max-w-[180px]">
            Hola, {userName}
          </span>
        </Link>
        <button
          type="button"
          aria-label="Cerrar sesion"
          className={cn(
            "inline-flex items-center gap-2",
            "font-sans text-sm font-medium",
            "text-[var(--color-prode-text-secondary)]",
            "hover:text-[var(--color-prode-near-black)]",
            "transition-colors duration-300",
          )}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  );
}
