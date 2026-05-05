"use client";

import { useEffect, useState } from "react";

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /**
   * Total milliseconds until target. <= 0 means target reached/passed.
   */
  totalMs: number;
  /** Convenience flag for "target time has passed". */
  finished: boolean;
}

const ZERO: CountdownParts = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  totalMs: 0,
  finished: true,
};

function computeParts(targetMs: number): CountdownParts {
  const totalMs = targetMs - Date.now();
  if (totalMs <= 0) return ZERO;
  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, totalMs, finished: false };
}

/**
 * Hook que cuenta hacia atras hasta `targetIso`. SSR-safe:
 * en el primer render (SSR + first client render) devuelve `null`
 * para evitar hydration mismatch. Despues del mount empieza a tickear
 * cada segundo y devuelve los `CountdownParts`.
 *
 * El consumidor debe renderizar un placeholder (ej "—:—:—:—") cuando
 * el valor es `null`.
 */
export function useCountdown(targetIso: string): CountdownParts | null {
  const [parts, setParts] = useState<CountdownParts | null>(null);

  useEffect(() => {
    const targetMs = new Date(targetIso).getTime();
    if (Number.isNaN(targetMs)) {
      setParts(ZERO);
      return;
    }

    // Primer compute inmediatamente al mount.
    setParts(computeParts(targetMs));

    const interval = window.setInterval(() => {
      const next = computeParts(targetMs);
      setParts(next);
      if (next.finished) {
        window.clearInterval(interval);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [targetIso]);

  return parts;
}
