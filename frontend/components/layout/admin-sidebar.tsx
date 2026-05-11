"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Calendar,
  Flag,
  Bell,
  ScrollText,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SidebarItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

const ITEMS: SidebarItem[] = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/usuarios", label: "Usuarios", Icon: Users },
  { href: "/admin/pagos", label: "Pagos", Icon: CreditCard },
  { href: "/admin/partidos", label: "Partidos", Icon: Calendar },
  { href: "/admin/fases", label: "Fases", Icon: Flag },
  { href: "/admin/notificaciones", label: "Notificaciones", Icon: Bell },
  { href: "/admin/auditoria", label: "Auditoria", Icon: ScrollText },
  { href: "/admin/configuracion", label: "Configuracion", Icon: Settings },
];

interface AdminSidebarProps {
  className?: string;
}

/**
 * Sidebar fija izquierda para admin. 8 items. En mobile se colapsa
 * a un drawer (no implementado en este skeleton — Phase 7 lo refina).
 * Por ahora oculta en mobile; AdminLayout debe ofrecer un toggle.
 *
 * Visual: dark editorial. Bg surface (un escalon mas oscuro que el
 * main bg para distinguirla), texto cream, item activo con
 * border-left verde + bg surface-2.
 */
export function AdminSidebar({ className }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col",
        "fixed inset-y-0 left-0 z-30 w-64",
        "bg-[var(--color-landing-surface)] text-[var(--color-landing-text)]",
        "border-r border-[var(--color-landing-line-strong)]",
        className,
      )}
      aria-label="Navegacion admin"
    >
      <div className="flex h-16 items-center border-b border-[var(--color-landing-line-strong)] px-6">
        <Link
          href="/admin"
          className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight leading-none text-[var(--color-landing-text)]"
        >
          <span className="border-b-[4px] border-[var(--color-landing-green)] pb-0.5">
            Admin
          </span>
        </Link>
      </div>
      <ul className="flex-1 overflow-y-auto py-4">
        {ITEMS.map(({ href, label, Icon }) => {
          const isActive =
            href === "/admin"
              ? pathname === "/admin"
              : pathname?.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 px-6 py-3",
                  "font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.18em]",
                  "transition-colors duration-200",
                  "border-l-[3px]",
                  isActive
                    ? "bg-[var(--color-landing-surface-2)] text-[var(--color-landing-text)] border-[var(--color-landing-green)]"
                    : "border-transparent text-[var(--color-landing-text-muted)] hover:bg-[var(--color-landing-surface-2)] hover:text-[var(--color-landing-text)]",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
