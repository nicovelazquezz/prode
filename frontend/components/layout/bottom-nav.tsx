"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Star, Trophy, Users, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof ListChecks;
}

const ITEMS: NavItem[] = [
  { href: "/predicciones", label: "Predic", Icon: ListChecks },
  { href: "/especiales", label: "Especial", Icon: Star },
  { href: "/leaderboard", label: "Tabla", Icon: Trophy },
  { href: "/ligas", label: "Ligas", Icon: Users },
  { href: "/perfil", label: "Perfil", Icon: User },
];

interface BottomNavProps {
  className?: string;
}

/**
 * Bottom nav mobile-only para zonas autenticadas. 5 items con
 * icons Lucide + labels en mono uppercase tracked. Active state:
 * cream con icon stroke 2.5; inactive: muted.
 *
 * Hidden en desktop (md+) — el `<AppHeader>` cubre la navegacion
 * con tabs centradas. El layout `(app)` reserva `pb-16` en mobile
 * para el espacio de esta nav.
 */
export function BottomNav({ className }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 md:hidden",
        "h-16 bg-[var(--color-landing-bg)] border-t border-[var(--color-landing-line)]",
        "grid grid-cols-5",
        className,
      )}
      aria-label="Navegacion principal"
    >
      {ITEMS.map(({ href, label, Icon }) => {
        const isActive =
          pathname === href || (pathname?.startsWith(href + "/") ?? false);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center justify-center gap-1",
              "font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em]",
              "transition-colors duration-200",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--color-landing-gold)]",
              isActive
                ? "text-[var(--color-landing-text)]"
                : "text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon
              className={cn("h-5 w-5", isActive && "stroke-[2.5]")}
              aria-hidden="true"
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
