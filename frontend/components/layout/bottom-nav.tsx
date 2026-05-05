"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Trophy, Users, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof ListChecks;
}

const ITEMS: NavItem[] = [
  { href: "/predicciones", label: "Predic", Icon: ListChecks },
  { href: "/leaderboard", label: "Tabla", Icon: Trophy },
  { href: "/ligas", label: "Ligas", Icon: Users },
  { href: "/perfil", label: "Perfil", Icon: User },
];

interface BottomNavProps {
  className?: string;
}

/**
 * Bottom nav mobile-only para zonas autenticadas. 4 items con
 * icons Lucide + labels, active state highlight near-black.
 * Hidden en desktop (md+).
 *
 * El layout `(app)` debe agregar `pb-16` al main para reservar
 * espacio para esta nav.
 */
export function BottomNav({ className }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 md:hidden",
        "h-16 bg-white border-t border-[var(--color-prode-border)]",
        "grid grid-cols-4",
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
              "font-sans text-xs",
              "transition-colors duration-300",
              isActive
                ? "text-[var(--color-prode-near-black)]"
                : "text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon
              className={cn("h-5 w-5", isActive && "stroke-[2.5]")}
              aria-hidden="true"
            />
            <span className={cn(isActive && "font-bold")}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
