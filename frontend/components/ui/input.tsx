"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Input estilo border-bottom only (DESIGN.md "Input / Search").
 *
 * - Sin background ni border-radius.
 * - Border inferior 1px en estado normal, 2px en focus, color near-black.
 * - Texto base 16px (evita zoom en iOS).
 * - Placeholder en text-muted.
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "h-12 w-full bg-transparent text-[var(--color-landing-text)]",
      "border-b border-[var(--color-landing-line-strong)]",
      "py-3 px-0 font-sans text-base",
      "transition-colors duration-300 outline-none",
      "focus:border-b-2 focus:border-[var(--color-landing-text)]",
      "disabled:opacity-50",
      "placeholder:text-[var(--color-landing-text-muted)]",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
