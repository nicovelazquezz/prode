"use client";

import { useCallback } from "react";

/**
 * Hook que devuelve una funcion `vibrate(duration)` que dispara
 * vibracion via `navigator.vibrate` cuando esta soportado. En
 * desktop o browsers sin soporte (iOS Safari) es un no-op silencioso.
 *
 * @example
 *   const vibrate = useHapticFeedback();
 *   <button onClick={() => vibrate(10)}>tap</button>
 */
export function useHapticFeedback() {
  return useCallback((durationMs: number = 10) => {
    if (typeof navigator === "undefined") return;
    if (typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(durationMs);
    } catch {
      // navigator.vibrate puede tirar en algunos contextos (iframes,
      // permisos restringidos). Lo silenciamos — es solo cosmetic.
    }
  }, []);
}
