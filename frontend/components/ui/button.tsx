"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Button base, paleta dark editorial (landing).
 *
 * - primary: bg-red, hover red-hover (CTA principal)
 * - ghost: bg transparente, hover surface (texto cream)
 * - outlined: border line-strong sobre surface, hover border cream
 * - accent: alias de primary (legacy, no usar en codigo nuevo)
 * - destructive: bg-red, alias semantico de primary
 *
 * Focus ring siempre en gold (editorial).
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center font-[family-name:var(--font-landing-mono)] font-bold uppercase tracking-[0.18em] text-[11px]",
    "transition-colors duration-200 ease-out",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "rounded-sm cursor-pointer",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-landing-red)] text-[var(--color-landing-text)] hover:bg-[var(--color-landing-red-hover)]",
        ghost:
          "bg-transparent text-[var(--color-landing-text)] hover:bg-[var(--color-landing-surface)]",
        outlined:
          "bg-transparent text-[var(--color-landing-text)] border border-[var(--color-landing-line-strong)] hover:border-[var(--color-landing-text)]",
        accent:
          "bg-[var(--color-landing-red)] text-[var(--color-landing-text)] hover:bg-[var(--color-landing-red-hover)]",
        destructive:
          "bg-[var(--color-landing-red)] text-[var(--color-landing-text)] hover:bg-[var(--color-landing-red-hover)]",
      },
      size: {
        default: "h-12 px-6",
        sm: "h-10 px-4",
        lg: "h-14 px-8",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
