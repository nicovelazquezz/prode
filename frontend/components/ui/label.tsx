import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Label uppercase tracked, estilo "H4 / Label" del DESIGN.md.
 *
 * 14px / 700 / uppercase / tracked, color text-secondary.
 * Usado encima de inputs para mantener jerarquia visual.
 */
export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "font-sans text-xs font-bold uppercase tracking-wider",
      "text-[var(--color-prode-text-secondary)]",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
