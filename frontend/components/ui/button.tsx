"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center font-sans font-medium text-sm",
    "transition-colors duration-300 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "cursor-pointer",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-prode-accent)] text-[var(--color-prode-near-black)] hover:opacity-90",
        ghost:
          "bg-transparent text-[var(--color-prode-near-black)] hover:bg-[var(--color-prode-surface)]",
        outlined:
          "bg-[var(--color-prode-surface)] text-[var(--color-prode-near-black)] border border-[var(--color-prode-border)] hover:border-[var(--color-prode-near-black)]",
        accent:
          "bg-[var(--color-prode-accent)] text-[var(--color-prode-near-black)] hover:opacity-90",
        destructive:
          "bg-[var(--color-prode-accent)] text-[var(--color-prode-near-black)] hover:opacity-90",
      },
      size: {
        default: "h-12 px-8",
        sm: "h-10 px-6",
        lg: "h-14 px-10 text-base",
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
