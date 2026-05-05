"use client";

import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TeamFlag } from "@/components/domain/team-flag";
import { useHapticFeedback } from "@/lib/hooks/use-haptic-feedback";
import { cn } from "@/lib/utils/cn";

interface NumberPadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeTeam: { name: string; fifaCode?: string };
  awayTeam: { name: string; fifaCode?: string };
  initialScoreHome: number | null;
  initialScoreAway: number | null;
  onSave: (dto: { scoreHome: number; scoreAway: number }) => void;
}

type ActiveSide = "home" | "away";

const MAX_SCORE = 99;

/**
 * Bottom sheet con number pad grande (3x4 grid 0-9 + clear) para
 * cargar la prediccion en mobile. Implementa la UX del spec §6.5:
 *
 *  - Muestra ambos teams en filas con su score actual.
 *  - El "lado activo" (home o away) se indica visualmente; tap en
 *    cualquier digito edita el score del lado activo.
 *  - Click en el otro lado lo activa para edicion.
 *  - Tap en clear (icon Delete) borra el ultimo digito; tap-largo no
 *    es necesario (el backend maneja 0-99 numeros chicos).
 *  - Haptic feedback `navigator.vibrate(10)` en cada tap.
 *  - Footer con boton "GUARDAR" → onSave({ scoreHome, scoreAway }) +
 *    cierra el sheet.
 *  - Si abrimos con scores existentes, los respeta como starting point.
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

        {/* Team rows */}
        <div className="flex flex-col gap-2 px-2">
          <TeamRow
            label={homeTeam.name}
            fifaCode={homeTeam.fifaCode}
            score={scoreHome}
            active={activeSide === "home"}
            onSelect={() => setActiveSide("home")}
          />
          <TeamRow
            label={awayTeam.name}
            fifaCode={awayTeam.fifaCode}
            score={scoreAway}
            active={activeSide === "away"}
            onSelect={() => setActiveSide("away")}
          />
        </div>

        {/* 3x4 number pad: 1 2 3 / 4 5 6 / 7 8 9 / clear 0 (empty) */}
        <div className="mt-6 grid grid-cols-3 gap-2 px-2" role="group" aria-label="Teclado numerico">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <PadButton key={d} onClick={() => handleDigit(d)} aria-label={`${d}`}>
              {d}
            </PadButton>
          ))}
          <PadButton onClick={handleClear} aria-label="Borrar" variant="muted">
            <Delete className="h-6 w-6" aria-hidden />
          </PadButton>
          <PadButton onClick={() => handleDigit(0)} aria-label="0">
            0
          </PadButton>
          <span aria-hidden />
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleSave}
            disabled={!canSave}
            className="w-full"
          >
            GUARDAR
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface TeamRowProps {
  label: string;
  fifaCode?: string;
  score: number | null;
  active: boolean;
  onSelect: () => void;
}

function TeamRow({ label, fifaCode, score, active, onSelect }: TeamRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border-2 px-4 py-3",
        "transition-colors duration-200",
        active
          ? "border-[var(--color-prode-near-black)] bg-white"
          : "border-[var(--color-prode-border)] bg-[var(--color-prode-surface)]",
      )}
      aria-pressed={active}
    >
      <div className="flex items-center gap-3 min-w-0">
        {fifaCode ? <TeamFlag fifaCode={fifaCode} size={28} /> : null}
        <span className="font-display text-lg font-black uppercase tracking-wide truncate text-[var(--color-prode-near-black)]">
          {label}
        </span>
      </div>
      <span
        className={cn(
          "font-display text-3xl font-black leading-none tabular-nums",
          score === null
            ? "text-[var(--color-prode-text-muted)]"
            : "text-[var(--color-prode-near-black)]",
        )}
      >
        {score === null ? "—" : score}
      </span>
    </button>
  );
}

interface PadButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "muted";
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
        "h-14 rounded-md font-display text-2xl font-black",
        "flex items-center justify-center",
        "active:scale-[0.97] transition-transform duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-prode-near-black)] focus-visible:ring-offset-1",
        variant === "muted"
          ? "bg-[var(--color-prode-surface)] text-[var(--color-prode-near-black)]"
          : "bg-[var(--color-prode-near-black)] text-white hover:opacity-90",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
