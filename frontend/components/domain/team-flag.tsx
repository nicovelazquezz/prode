"use client";

import Image from "next/image";
import { cn } from "@/lib/utils/cn";

interface TeamFlagProps {
  /**
   * Codigo FIFA de 3 letras (ej "ARG", "MEX", "BRA").
   * Internamente lo cortamos a 2 letras lowercase para flagcdn,
   * que sigue ISO 3166-1 alpha-2 (no FIFA). Esto no es perfecto
   * (algunos paises difieren), pero cubre 95% de los casos para
   * el MVP. Phase 3+ podra usar SVGs propios si hace falta.
   */
  fifaCode: string;
  size?: number;
  className?: string;
}

/**
 * Bandera de un seleccionado, fetcheada desde flagcdn.com como
 * fallback (no necesitamos hosting de SVGs propios). Usa
 * `next/image` con `unoptimized` para no pasar por el optimizer
 * (los SVG ya pesan poco y flagcdn.com no esta en remotePatterns).
 */
export function TeamFlag({ fifaCode, size = 32, className }: TeamFlagProps) {
  const iso = fifaCode.toLowerCase().slice(0, 2);
  return (
    <Image
      src={`https://flagcdn.com/${iso}.svg`}
      alt={`Bandera ${fifaCode}`}
      width={size}
      height={size}
      className={cn("inline-block object-cover rounded-sm", className)}
      unoptimized
    />
  );
}
