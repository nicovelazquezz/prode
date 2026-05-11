"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Wrapper de sonner con tokens FIFA WC.
 * Montar una sola vez en root layout.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      duration={4000}
      toastOptions={{
        classNames: {
          toast:
            "bg-[var(--color-landing-surface)] border border-[var(--color-landing-line-strong)] text-[var(--color-landing-text)] rounded-md font-sans",
          title: "font-medium text-sm",
          description: "text-sm text-[var(--color-landing-text-muted)]",
          actionButton:
            "bg-[var(--color-landing-red)] text-[var(--color-landing-text)] rounded-sm",
          cancelButton:
            "bg-transparent text-[var(--color-landing-text-muted)]",
          error: "border-[var(--color-landing-red)]",
        },
      }}
    />
  );
}

export { toast } from "sonner";
