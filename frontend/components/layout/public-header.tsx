"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface PublicHeaderProps {
  className?: string;
}

/**
 * Header publico inmersivo.
 *
 * En `/` (landing): transparente sobre el hero dark; al cruzar el
 * sentinel `#hero-end` aparece con backdrop-blur navy translucido.
 * En el resto de rutas (`/login`, `/reglamento`, ...): navy solido
 * desde el primer paint — no hay hero dark detras, asi que necesita
 * presencia visual propia.
 *
 * Sticky top, h-14 mobile / h-16 desktop, siempre texto blanco.
 *
 * El observer apunta a `#hero-end`, un nodo invisible que el hero
 * landing renderiza al final de su section. Si la pagina actual no
 * tiene ese nodo (login, reglamento), el observer no encuentra nada
 * y el header queda en el estado inicial — que para esas rutas es
 * "solid" porque no son la landing.
 */
export function PublicHeader({ className }: PublicHeaderProps) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  // En landing arrancamos transparente (sobre el hero dark); en otras
  // rutas, solid desde el inicio.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isLanding) return;
    if (typeof window === "undefined") return;

    const sentinel = document.getElementById("hero-end");
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Cuando el sentinel sale del viewport HACIA ARRIBA significa
        // que ya scrolleamos pasando el hero — activamos el solid.
        setScrolled(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0, rootMargin: "-64px 0px 0px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLanding]);

  // Variant "solid" si no es landing, o si ya scrolleamos pasando el hero.
  const isSolid = !isLanding || scrolled;

  return (
    <header
      data-state={isSolid ? "solid" : "transparent"}
      className={cn(
        "fixed top-0 left-0 right-0 z-40 w-full",
        "h-14 md:h-16",
        "transition-[background-color,backdrop-filter,border-color] duration-300 ease-out",
        "motion-reduce:transition-none",
        isSolid
          ? "bg-[rgba(12,21,33,0.85)] backdrop-blur-md border-b border-white/10"
          : "bg-transparent border-b border-transparent",
        className,
      )}
    >
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 md:px-8">
        <Link
          href="/"
          className={cn(
            "font-display text-xl md:text-2xl font-black uppercase tracking-wide text-white",
            "transition-opacity duration-200 hover:opacity-80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-prode-deep-navy)]",
          )}
        >
          Prode 2026
        </Link>
        <nav className="flex items-center gap-2 md:gap-3">
          <HeaderGhostLink href="/reglamento">Reglamento</HeaderGhostLink>
          <HeaderOutlinedLink href="/login">Ingresar</HeaderOutlinedLink>
        </nav>
      </div>
    </header>
  );
}

function HeaderGhostLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative inline-flex h-10 items-center px-3 md:px-4",
        "font-sans text-sm font-medium text-white/85",
        "transition-colors duration-200 hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-prode-deep-navy)]",
        // Underline accent en hover (decoracion CSS, sin layout shift)
        "after:absolute after:left-3 after:right-3 after:bottom-2 after:h-px",
        "after:bg-[var(--color-prode-accent)] after:origin-left",
        "after:scale-x-0 hover:after:scale-x-100",
        "after:transition-transform after:duration-300 after:ease-out",
        "motion-reduce:after:transition-none",
      )}
    >
      {children}
    </Link>
  );
}

function HeaderOutlinedLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 items-center px-4 md:px-5",
        "font-sans text-sm font-medium",
        "rounded-pill border border-white/40 text-white",
        "transition-colors duration-200",
        "hover:bg-white hover:text-[var(--color-prode-deep-navy)] hover:border-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-prode-deep-navy)]",
      )}
    >
      {children}
    </Link>
  );
}
