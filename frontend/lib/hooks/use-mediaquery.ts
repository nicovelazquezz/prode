"use client";

import { useEffect, useState } from "react";

/**
 * Hook que escucha un media query y devuelve si matchea.
 *
 * SSR-safe: en el primer render (SSR + first client render) devuelve
 * `false` para evitar hydration mismatch. Despues del mount lee el
 * valor real del `window.matchMedia` y se suscribe a cambios.
 *
 * @example
 *   const isMobile = useMediaQuery("(max-width: 767px)");
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);

    // addEventListener es lo moderno; algunos browsers viejos solo
    // exponen addListener (deprecated). Soportamos ambos.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacy = mql as unknown as {
        addListener: (l: (e: MediaQueryListEvent) => void) => void;
        removeListener: (l: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener(listener);
      return () => legacy.removeListener(listener);
    }
  }, [query]);

  return matches;
}
