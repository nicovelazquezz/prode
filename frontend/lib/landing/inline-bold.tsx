import { Fragment, type ReactNode } from "react";

/**
 * Convierte `**foo**` → `<strong>foo</strong>` inline.
 * No interpreta otros tokens markdown — solo bold.
 *
 * Uso: para resaltar palabras dentro de copy almacenado como string
 * en `lib/landing/content.ts`, sin tener que romper en arrays JSX.
 */
export function inlineBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const match = part.match(/^\*\*([^*]+)\*\*$/);
    if (match) return <strong key={i}>{match[1]}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
