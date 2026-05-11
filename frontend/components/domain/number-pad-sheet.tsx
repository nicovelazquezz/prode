"use client";

import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import { TeamFlag } from "@/components/domain/team-flag";
import { useHapticFeedback } from "@/lib/hooks/use-haptic-feedback";
import { cn } from "@/lib/utils/cn";

interface NumberPadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeTeam: { name: string; fifaCode?: string; flagUrl?: string };
  awayTeam: { name: string; fifaCode?: string; flagUrl?: string };
  initialScoreHome: number | null;
  initialScoreAway: number | null;
  onSave: (dto: { scoreHome: number; scoreAway: number }) => void;
}

type ActiveSide = "home" | "away";

const MAX_SCORE = 99;

/**
 * Bottom sheet con number pad grande (3x4 grid 0-9 + clear) para
 * cargar la prediccion en mobile. Repintado con la paleta dark
 * editorial (`--color-landing-*`). Implementa la UX del spec §6.5:
 *
 *  - Header: ambos teams con scores grandes display 48px; el "lado
 *    activo" se marca con border-bottom verde 2px (igual que el
 *    eyebrow underline pattern del landing hero).
 *  - Number pad 3x4: buttons 56x56 surface-2 con line-strong border,
 *    text display 28px cream, hover border-cream.
 *  - Clear (Delete icon): variant ghost, sin border, hover cream.
 *  - GUARDAR: full-width bg-red text-cream, mismo style del CTA
 *    primario del landing.
 *  - Haptic feedback `navigator.vibrate(10)` en cada tap.
 *
 * Reset: cada vez que `open` pasa a true, reinicializa state desde
 * `initialScoreHome/Away`. Permite descartar cambios cerrando y
 * reabriendo (UX simple).
 */
export function NumberPadSheet({
  open,
  onOpenChange,
  homeTeam,
  awayTeam,
  initialScoreHome,
  initialScoreAway,
  onSave,
}: NumberPadSheetProps) {
  const vibrate = useHapticFeedback();
  const [scoreHome, setScoreHome] = useState<number | null>(initialScoreHome);
  const [scoreAway, setScoreAway] = useState<number | null>(initialScoreAway);
  const [activeSide, setActiveSide] = useState<ActiveSide>("home");

  // Reset state on open transition.
  useEffect(() => {
    if (open) {
      setScoreHome(initialScoreHome);
      setScoreAway(initialScoreAway);
      setActiveSide("home");
    }
  }, [open, initialScoreHome, initialScoreAway]);

  const currentScore = activeSide === "home" ? scoreHome : scoreAway;
  const setCurrentScore = (val: number | null) => {
    if (activeSide === "home") setScoreHome(val);
    else setScoreAway(val);
  };

  const handleDigit = (d: number) => {
    vibrate(10);
    if (currentScore === null) {
      setCurrentScore(d);
    } else {
      // Concat digit only if resulting number stays within MAX_SCORE.
      const next = currentScore * 10 + d;
      if (next <= MAX_SCORE) {
        setCurrentScore(next);
      } else {
        // Replace with single digit (overflow: tipear "5" tras "9" → "5").
        setCurrentScore(d);
      }
    }
    // Auto-advance: si estoy editando home y meto un digito y el siguiente
    // tap es probablemente para away. Mantenemos focus en home para
    // permitir scores de 2 digitos. El usuario debe tocar la fila away
    // para cambiar.
  };

  const handleClear = () => {
    vibrate(10);
    setCurrentScore(null);
  };

  const handleSave = () => {
    if (scoreHome === null || scoreAway === null) return;
    vibrate(20);
    onSave({ scoreHome, scoreAway });
    onOpenChange(false);
  };

  const canSave = scoreHome !== null && scoreAway !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle className="sr-only">Cargar prediccion</SheetTitle>

        {/* Team rows con score grande arriba */}
        <div className="flex flex-col gap-3 px-2">
          <TeamScoreRow
            label={homeTeam.name}
            fifaCode={homeTeam.fifaCode}
            flagUrl={homeTeam.flagUrl}
            score={scoreHome}
            active={activeSide === "home"}
            onSelect={() => setActiveSide("home")}
          />
          <TeamScoreRow
            label={awayTeam.name}
            fifaCode={awayTeam.fifaCode}
            flagUrl={awayTeam.flagUrl}
            score={scoreAway}
            active={activeSide === "away"}
            onSelect={() => setActiveSide("away")}
          />
        </div>

        {/* 3x4 number pad: 1 2 3 / 4 5 6 / 7 8 9 / clear 0 (empty) */}
        <div
          className="mt-6 grid grid-cols-3 gap-2 px-2"
          role="group"
          aria-label="Teclado numerico"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <PadButton key={d} onClick={() => handleDigit(d)} aria-label={`${d}`}>
              {d}
            </PadButton>
          ))}
          <PadButton onClick={handleClear} aria-label="Borrar" variant="ghost">
            <Delete className="h-6 w-6" aria-hidden />
          </PadButton>
          <PadButton onClick={() => handleDigit(0)} aria-label="0">
            0
          </PadButton>
          <span aria-hidden />
        </div>

        <SheetFooter>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "w-full h-14 rounded-sm",
              "font-[family-name:var(--font-landing-mono)] text-xs uppercase tracking-[0.18em] font-extrabold",
              "bg-[var(--color-landing-red)] text-[var(--color-landing-text)]",
              "transition-colors duration-200",
              "hover:bg-[var(--color-landing-red-hover)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            GUARDAR
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface TeamScoreRowProps {
  label: string;
  fifaCode?: string;
  flagUrl?: string;
  score: number | null;
  active: boolean;
  onSelect: () => void;
}

function TeamScoreRow({
  label,
  fifaCode,
  flagUrl,
  score,
  active,
  onSelect,
}: TeamScoreRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 rounded-sm",
        "transition-colors duration-200",
        "border-b-2 -mb-px",
        active
          ? "border-[var(--color-landing-green)] bg-[var(--color-landing-surface-2)]"
          : "border-transparent bg-[var(--color-landing-surface)] hover:border-[var(--color-landing-line-strong)]",
      )}
      aria-pressed={active}
    >
      <div className="flex items-center gap-3 min-w-0">
        {fifaCode ? <TeamFlag fifaCode={fifaCode} src={flagUrl} size={28} /> : null}
        <span className="font-[family-name:var(--font-landing-display)] text-[20px] uppercase tracking-[0.02em] truncate text-[var(--color-landing-text)]">
          {label}
        </span>
      </div>
      <span
        className={cn(
          "font-[family-name:var(--font-landing-display)] text-[48px] leading-none tabular-nums",
          score === null
            ? "text-[var(--color-landing-text-muted)]"
            : "text-[var(--color-landing-text)]",
        )}
      >
        {score === null ? "—" : score}
      </span>
    </button>
  );
}

interface PadButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost";
}

function PadButton({
  children,
  className,
  variant = "default",
  ...props
}: PadButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "h-14 rounded-sm",
        "font-[family-name:var(--font-landing-display)] text-[28px] tabular-nums leading-none",
        "flex items-center justify-center",
        "border transition-colors duration-150",
        "active:scale-[0.97]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
        variant === "ghost"
          ? "bg-transparent border-transparent text-[var(--color-landing-text-muted)] hover:text-[var(--color-landing-text)]"
          : "bg-[var(--color-landing-surface-2)] border-[var(--color-landing-line-strong)] text-[var(--color-landing-text)] hover:border-[var(--color-landing-text)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
