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
            "bg-white border border-[var(--color-prode-border)] text-[var(--color-prode-near-black)] rounded-md font-sans",
          title: "font-medium text-sm",
          description: "text-sm text-[var(--color-prode-text-secondary)]",
          actionButton:
            "bg-[var(--color-prode-near-black)] text-white rounded-sm",
          cancelButton:
            "bg-transparent text-[var(--color-prode-text-secondary)]",
          error: "border-[var(--color-prode-accent)]",
        },
      }}
    />
  );
}

export { toast } from "sonner";
