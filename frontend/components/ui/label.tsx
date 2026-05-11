import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Label dark editorial.
 *
 * Mono uppercase tracked (10px / 0.22em) en text-muted; misma gramática
 * tipografica de los eyebrows del sistema landing.
 */
export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.22em]",
      "text-[var(--color-landing-text-muted)]",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
