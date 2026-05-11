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
  /**
   * Tinte por estado del match card padre. Ajusta el border color
   * para reforzar la lectura "saved" (green) / "retrying" (red) /
   * "empty" (gold tenue) sin replicar la logica del MatchCard.
   *
   * - default: border line-strong (sin tinte)
   * - saved: border green
   * - retrying: border red
   * - empty: border gold tenue (el MatchCard puede sumar `input-pulse`
   *   via className para animar el border)
   */
  tone?: "default" | "saved" | "retrying" | "empty";
  className?: string;
}

const MAX_SCORE = 99;

/**
 * Componente para cargar el score de una prediccion. Spec §6.5.
 * Repintado con la paleta dark editorial (`--color-landing-*`).
 *
 *  - **Mobile (`max-width: 767px`)**: render como boton 56x56 con
 *    bg surface-2 y border line-strong. Display Oswald 32px en cream
 *    ("—" muted si null). Tap dispara `onOpenSheet()` para abrir el
 *    `<NumberPadSheet>` compartido.
 *  - **Desktop**: render como `<input type="text" inputmode="numeric">`
 *    nativo, sin background, con border-bottom 1px line-strong. Focus
 *    cambia el border-bottom a green 2px y el caret a cream. Display
 *    Oswald 24px tabular-nums.
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
  tone = "default",
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

  // Border color por tono — solo aplica a estados open (no disabled).
  // El MatchCard padre setea el tono según `state`. La altura/ancho/
  // tipografía no cambian para no romper rítmica del card.
  const toneBorder =
    tone === "saved"
      ? "border-[var(--color-landing-green)]"
      : tone === "retrying"
        ? "border-[var(--color-landing-red)]"
        : tone === "empty"
          ? "border-[rgba(200,160,83,0.5)]"
          : value === null
            ? "border-[var(--color-landing-line-strong)]"
            : "border-[var(--color-landing-text)]";

  if (isMobile) {
    return (
      <button
        type="button"
        onClick={onOpenSheet}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "w-12 h-14 min-w-12 rounded-sm",
          "font-[family-name:var(--font-landing-display)] text-[28px] tabular-nums leading-none",
          "flex items-center justify-center",
          "border-2 transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-landing-gold)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-landing-surface)]",
          disabled
            ? "bg-black/20 border-[var(--color-landing-line)] border-dashed text-[var(--color-landing-text-muted)] cursor-not-allowed"
            : cn(
                "bg-[rgba(241,236,224,0.04)] hover:border-[var(--color-landing-gold)]",
                toneBorder,
                value === null
                  ? "text-[var(--color-landing-text-muted)]"
                  : "text-[var(--color-landing-text)]",
              ),
          className,
        )}
      >
        {value === null ? "—" : value}
      </button>
    );
  }

  // Desktop: bordered box (no underline) para matchear V4 scoreboard look.
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
        "w-11 h-12 md:h-[50px] rounded-sm text-center",
        "font-[family-name:var(--font-landing-display)] text-[26px] md:text-[28px] tabular-nums leading-none",
        "border-2 outline-none transition-colors duration-200",
        "placeholder:text-[var(--color-landing-text-muted)]",
        "focus:border-[var(--color-landing-gold)]",
        disabled
          ? "bg-black/20 border-[var(--color-landing-line)] border-dashed text-[var(--color-landing-text-muted)] cursor-not-allowed"
          : cn(
              "bg-[rgba(241,236,224,0.04)] hover:border-[var(--color-landing-gold)]",
              toneBorder,
              "text-[var(--color-landing-text)]",
            ),
        className,
      )}
    />
  );
}
