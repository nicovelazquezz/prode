"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface PointsCelebrationProps {
  /**
   * Puntos ganados en la prediccion. Se renderiza como `+N pts`.
   * Si es 0 o negativo, el componente no renderiza nada.
   */
  points: number;
  /**
   * Si esta en true, fuerza la animacion incluso si el usuario tiene
   * `prefers-reduced-motion` (raro — usado en demos / showcase).
   */
  forceAnimate?: boolean;
  className?: string;
}

/**
 * Animacion celebratoria cuando una prediction recien evaluada
 * acerto. Spec §6.6 + §7. Stagger scale 0.95 → 1.05 → 1, color
 * accent, duration 0.4s ease-out.
 *
 * Respeta `prefers-reduced-motion`: en ese caso, animation se
 * reduce a un fade simple (no scale + bounce).
 *
 * SSR-safe: estado inicial mismo en server y client. La animacion
 * arranca despues del primer mount (useEffect setea `mounted`).
 */
export function PointsCelebration({
  points,
  forceAnimate = false,
  className,
}: PointsCelebrationProps) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (points <= 0) return null;

  const useReduced = !forceAnimate && reduceMotion;

  // Fade simple si reduce-motion; sino, stagger scale + opacity.
  const initial = useReduced ? { opacity: 0 } : { scale: 0.95, opacity: 0 };
  const animate = mounted
    ? useReduced
      ? { opacity: 1 }
      : { scale: [0.95, 1.05, 1], opacity: 1 }
    : initial;
  const transition = useReduced
    ? { duration: 0.2, ease: [0, 0, 0.2, 1] as [number, number, number, number] }
    : {
        duration: 0.4,
        ease: [0, 0, 0.2, 1] as [number, number, number, number],
        times: [0, 0.6, 1],
      };

  return (
    <motion.div
      initial={initial}
      animate={animate}
      transition={transition}
      className={
        className ??
        "font-display text-3xl font-black tabular-nums text-[var(--color-prode-accent)]"
      }
      role="status"
      aria-label={`Ganaste ${points} puntos`}
      data-testid="points-celebration"
    >
      +{points} pts
    </motion.div>
  );
}
