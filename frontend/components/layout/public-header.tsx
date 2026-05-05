"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface PublicHeaderProps {
  className?: string;
}

/**
 * Header publico para zonas no autenticadas (landing, login,
 * completar-registro, reglamento). Skeleton — la logica de auth
 * (mostrar "Mi cuenta" si has_session) se conecta en Phase 3.
 *
 * Sticky top, h-14 mobile / h-16 desktop, white bg con border-b.
 */
export function PublicHeader({ className }: PublicHeaderProps) {
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
          href="/"
          className="font-display text-xl md:text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]"
        >
          Prode 2026
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/reglamento">
            <Button variant="ghost" size="sm">
              Reglamento
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="primary" size="sm">
              Ingresar
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}
