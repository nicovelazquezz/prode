"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { useAuth } from "@/lib/hooks/use-auth";

/**
 * Layout para el panel admin. Guard client-side: si el user no es
 * ADMIN, redirect a `/`. Si esta loading, skeleton.
 *
 * Sidebar fija a la izquierda en desktop (md+); en mobile la
 * sidebar se oculta y el toggle se implementa en Phase 7. Por
 * ahora dejamos un header minimo top con el logout.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user || user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex-1 flex">
        <div className="hidden md:block w-64 bg-[var(--color-prode-near-black)]" />
        <main className="flex-1 px-4 py-6 md:px-8" aria-busy="true">
          <div className="space-y-4 max-w-4xl">
            <div className="h-12 w-1/3 bg-[var(--color-prode-surface)] rounded-md animate-pulse" />
            <div className="h-32 bg-[var(--color-prode-surface)] rounded-md animate-pulse" />
          </div>
        </main>
      </div>
    );
  }

  if (!user || user.role !== "ADMIN") {
    return null;
  }

  return (
    <div className="flex-1 flex">
      <AdminSidebar />
      <div className="flex-1 md:pl-64 flex flex-col">
        <header className="sticky top-0 z-30 h-14 md:h-16 bg-white border-b border-[var(--color-prode-border)] flex items-center justify-between px-4 md:px-8">
          <span className="font-sans text-sm text-[var(--color-prode-text-secondary)]">
            <span className="hidden md:inline">Admin · </span>
            {user.firstName} {user.lastName}
          </span>
          <button
            type="button"
            aria-label="Cerrar sesion"
            onClick={() => {
              void logout().then(() => router.replace("/"));
            }}
            className="inline-flex items-center gap-2 font-sans text-sm font-medium text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)] transition-colors duration-300"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
