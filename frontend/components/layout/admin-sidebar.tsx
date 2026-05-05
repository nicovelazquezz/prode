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
 * Sidebar fija izquierda para admin. 9 items. En mobile se colapsa
 * a un drawer (no implementado en este skeleton — Phase 7 lo refina).
 * Por ahora oculta en mobile; AdminLayout debe ofrecer un toggle.
 *
 * Layout `(admin)` debe agregar `pl-64` al main en md+ para
 * reservar espacio para esta sidebar.
 */
export function AdminSidebar({ className }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col",
        "fixed inset-y-0 left-0 z-30 w-64",
        "bg-[var(--color-prode-near-black)] text-white",
        "border-r border-[var(--color-prode-near-black)]",
        className,
      )}
      aria-label="Navegacion admin"
    >
      <div className="flex h-16 items-center border-b border-white/10 px-6">
        <Link
          href="/admin"
          className="font-display text-xl font-black uppercase tracking-wide"
        >
          Admin Prode
        </Link>
      </div>
      <ul className="flex-1 overflow-y-auto py-4 space-y-1">
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
                  "font-sans text-sm font-medium",
                  "transition-colors duration-300",
                  isActive
                    ? "bg-white/10 text-white border-l-4 border-[var(--color-prode-accent)]"
                    : "text-white/70 hover:bg-white/5 hover:text-white",
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
