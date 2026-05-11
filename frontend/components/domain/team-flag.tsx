"use client";

import Image from "next/image";
import { cn } from "@/lib/utils/cn";

interface TeamFlagProps {
  /**
   * Código FIFA de 3 letras (ej "ARG", "MEX", "BRA"). Se usa como
   * texto alt y como fallback si no se pasa `src`.
   */
  fifaCode: string;
  /**
   * URL completa de la bandera. Default backend: PNG hosted en
   * `static.flashscore.com/res/image/data/{id}.png`. Si no se provee
   * (callers legacy / tests), se cae a `flagcdn.com/{iso2}.svg`.
   */
  src?: string;
  size?: number;
  className?: string;
}

/**
 * Bandera de un seleccionado. La fuente preferida es `team.flagUrl`
 * (PNG flashscore); si no se pasa, fallback a flagcdn por código FIFA
 * truncado a 2 letras lowercase. Siempre `unoptimized` — los assets
 * son ya pequeños y los hosts externos no requieren optimización.
 */
export function TeamFlag({ fifaCode, src, size = 32, className }: TeamFlagProps) {
  const url =
    src ?? `https://flagcdn.com/${fifaCode.toLowerCase().slice(0, 2)}.svg`;
  return (
    <Image
      src={url}
      alt={`Bandera ${fifaCode}`}
      width={size}
      height={size}
      className={cn("inline-block object-cover rounded-sm", className)}
      unoptimized
    />
  );
}
