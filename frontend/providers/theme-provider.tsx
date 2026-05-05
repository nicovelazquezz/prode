"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Wrapper de next-themes con defaults del Prode. La paleta del
 * spec FIFA WC 2026 es light-first; dejamos `dark` disponible para
 * usuarios que prefieren tema oscuro a nivel sistema, pero el
 * default es `light` y el toggle no se expone aun en MVP.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
