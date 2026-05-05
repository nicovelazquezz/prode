import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with proper conflict resolution.
 * Combines `clsx` (conditional class composition) with `tailwind-merge`
 * (deduplicates conflicting Tailwind utilities, last-wins).
 *
 * @example
 *   cn("p-4", "p-8") // => "p-8"
 *   cn("text-sm", condition && "text-lg") // => "text-lg" if condition
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
