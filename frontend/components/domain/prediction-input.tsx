"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useMediaQuery } from "@/lib/hooks/use-mediaquery";
import { cn } from "@/lib/utils/cn";

interface PredictionInputProps {
  /**
   * Score actual (puede ser null si el user no cargo nada todavia).
   */
  value: number | null;
  /**
   * Disabled cuando el match esta locked o pre-open. NO usa opacity
   * (preserva contraste WCAG); solo cambia colores.
   */
  disabled?: boolean;
  /**
   * En mobile: callback que abre el `<NumberPadSheet>`. Si no esta
   * definido y estamos en mobile, el componente igual abre un input
   * fallback. La pagina de /predicciones provee este callback con un
   * sheet compartido entre todos los matches abiertos.
   */
  onOpenSheet?: () => void;
  /**
   * En desktop: callback con el nuevo valor cuando el user termina
   * de tipear (debounce hecho por el padre). Recibe `null` si el
   * input se vacia.
   */
  onChange?: (value: number | null) => void;
  /**
   * Label accesible (ej "Predicción Mexico"). Cae a "Predicción"
   * si no se provee.
   */
  ariaLabel?: string;
  className?: string;
}

const MAX_SCORE = 99;

/**
 * Componente para cargar el score de una prediccion. Spec §6.5.
 *
 *  - **Mobile (`max-width: 767px`)**: render como boton 56x56 que
 *    muestra el score ("—" si null) en font-display 32px. Tap dispara
 *    `onOpenSheet()` para abrir el `<NumberPadSheet>` compartido.
 *  - **Desktop**: render como `<input type="text" inputmode="numeric">`
 *    nativo, validacion 0-99 (clamp on blur), `onChange` propaga el
 *    valor cuando cambia. El padre maneja debounce si quiere.
 *
 * SSR-safe: en el primer render usamos el variant desktop (input)
 * porque `useMediaQuery` devuelve false en SSR. Despues del mount
 * cambia al boton si esta en mobile.
 */
export function PredictionInput({
  value,
  disabled = false,
  onOpenSheet,
  onChange,
  ariaLabel = "Prediccion",
  className,
}: PredictionInputProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [localValue, setLocalValue] = useState<string>(
    value === null ? "" : String(value),
  );

  // Sync external value → local state. Critico para optimistic
  // updates: cuando el padre cambia el valor desde React Query, el
  // input refleja el nuevo numero.
  useEffect(() => {
    setLocalValue(value === null ? "" : String(value));
  }, [value]);

  if (isMobile) {
    return (
      <button
        type="button"
        onClick={onOpenSheet}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "w-14 h-14 min-w-14 rounded-md",
          "font-display text-3xl font-black tabular-nums leading-none",
          "flex items-center justify-center",
          "transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-1",
          disabled
            ? "bg-[var(--color-prode-surface)] text-[var(--color-prode-text-muted)] cursor-not-allowed"
            : value === null
              ? "bg-white border-2 border-dashed border-[var(--color-prode-border)] text-[var(--color-prode-text-muted)] hover:border-[var(--color-prode-near-black)]"
              : "bg-white border-2 border-[var(--color-prode-near-black)] text-[var(--color-prode-near-black)]",
          className,
        )}
      >
        {value === null ? "—" : value}
      </button>
    );
  }

  // Desktop: input nativo.
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
    setLocalValue(raw);
    if (raw === "") {
      onChange?.(null);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(Math.max(parsed, 0), MAX_SCORE);
    onChange?.(clamped);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={localValue}
      onChange={handleChange}
      disabled={disabled}
      aria-label={ariaLabel}
      maxLength={2}
      placeholder="—"
      className={cn(
        "w-14 h-14 rounded-md text-center",
        "font-display text-3xl font-black tabular-nums leading-none",
        "border-2 outline-none",
        "transition-colors duration-200",
        "focus:border-[var(--color-prode-near-black)]",
        "placeholder:text-[var(--color-prode-text-muted)]",
        disabled
          ? "bg-[var(--color-prode-surface)] text-[var(--color-prode-text-muted)] border-[var(--color-prode-border)] cursor-not-allowed"
          : value === null
            ? "bg-white border-dashed border-[var(--color-prode-border)] text-[var(--color-prode-near-black)]"
            : "bg-white border-[var(--color-prode-near-black)] text-[var(--color-prode-near-black)]",
        className,
      )}
    />
  );
}
