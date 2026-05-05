"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Input dark editorial.
 *
 * - bg surface-2 (un escalon mas claro que surface — visible sobre cards
 *   de surface y sobre el bg base), border line-strong, rounded-sm.
 * - Focus: outline gold (editorial), border verde (acento subtil).
 * - Texto base 16px (evita zoom en iOS), placeholder text-muted.
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "h-12 w-full rounded-sm bg-[var(--color-landing-surface-2)] text-[var(--color-landing-text)]",
      "border border-[var(--color-landing-line-strong)]",
      "px-3 font-sans text-base",
      "transition-colors outline-none",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
      "focus:border-[var(--color-landing-green)]",
      "disabled:opacity-50",
      "placeholder:text-[var(--color-landing-text-muted)]",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
