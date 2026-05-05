import { LANDING } from "@/lib/landing/content";

interface StripTopProps {
  daysToKickoff: number;
}

/**
 * Strip fina arriba del topbar con info temporal del Mundial.
 * El último segmento (días para kickoff) va en strong para destacar.
 */
export function StripTop({ daysToKickoff }: StripTopProps) {
  const segments = [
    ...LANDING.strip.parts,
    `${daysToKickoff} ${LANDING.strip.countdownLabel}`,
  ];
  return (
    <div className="border-b border-[var(--color-landing-line)] bg-black/25 px-8 py-2 text-center font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
      {segments.map((segment, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">·</span>}
          {i === segments.length - 1 ? (
            <strong className="text-[var(--color-landing-text)]">{segment}</strong>
          ) : (
            segment
          )}
        </span>
      ))}
    </div>
  );
}
