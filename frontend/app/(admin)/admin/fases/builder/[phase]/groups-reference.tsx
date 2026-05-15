"use client";

import { useMemo } from "react";
import { Check, HelpCircle } from "lucide-react";
import { TeamFlag } from "@/components/domain/team-flag";
import type { GroupStanding } from "@/lib/api/admin";

interface GroupsReferenceProps {
  /** Map de groupCode (A..L) → standings 1..4 ordenadas. */
  standings: Record<string, GroupStanding[]>;
}

/**
 * Referencia visual del builder de ROUND_32: 12 cards (una por grupo)
 * con tabla 4 filas + panel "Mejores terceros".
 *
 * - Posiciones 1 y 2 → ✓ (clasifica directo).
 * - Posición 3 → ? (candidato a mejor tercero).
 * - Panel inferior: los 12 terceros re-ordenados por PTS DESC → DG DESC
 *   → GF DESC; los 8 primeros marcados con ✓.
 *
 * No tiene interacción — sólo lectura para que el admin decida los
 * cruces que carga a la derecha en el builder.
 */
export function GroupsReference({ standings }: GroupsReferenceProps) {
  const groupCodes = useMemo(() => Object.keys(standings).sort(), [standings]);

  const bestThirds = useMemo(() => {
    const thirds: Array<GroupStanding & { groupCode: string }> = [];
    for (const code of groupCodes) {
      const team = standings[code]?.find((s) => s.position === 3);
      if (team) thirds.push({ ...team, groupCode: code });
    }
    thirds.sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
    return thirds;
  }, [standings, groupCodes]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Tabla de grupos
        </h2>
        <p className="mt-1 font-sans text-xs text-[var(--color-landing-text-muted)]">
          Posiciones 1-2 clasifican directo. El 3° pelea por entrar como
          mejor tercero (8 mejores de 12).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {groupCodes.map((code) => (
          <GroupCard
            key={code}
            code={code}
            standings={standings[code] ?? []}
          />
        ))}
      </div>

      <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-4">
        <h3 className="font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight text-[var(--color-landing-text)]">
          Mejores terceros
        </h3>
        <p className="mt-1 font-sans text-[11px] text-[var(--color-landing-text-muted)]">
          Top 8 de los 12 terceros. Ordenados por PTS → DG → GF.
        </p>
        <ol className="mt-3 space-y-1">
          {bestThirds.map((t, idx) => {
            const qualifies = idx < 8;
            return (
              <li
                key={t.teamId}
                className="flex items-center gap-2 font-sans text-xs"
              >
                <span
                  className={
                    qualifies
                      ? "inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-landing-green)] text-[var(--color-landing-bg)]"
                      : "inline-flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-[var(--color-landing-line)] text-[var(--color-landing-text-muted)]"
                  }
                  aria-hidden
                >
                  {qualifies ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
                  {t.groupCode}
                </span>
                <TeamFlag
                  fifaCode={t.teamShortName}
                  src={t.teamFlagUrl}
                  size={16}
                />
                <span className="flex-1 truncate text-[var(--color-landing-text)]">
                  {t.teamName}
                </span>
                <span className="font-[family-name:var(--font-landing-mono)] tabular-nums text-[10px] text-[var(--color-landing-text-muted)]">
                  {t.pts}pts · {t.dg >= 0 ? `+${t.dg}` : t.dg} · GF{t.gf}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function GroupCard({
  code,
  standings,
}: {
  code: string;
  standings: GroupStanding[];
}) {
  return (
    <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-[family-name:var(--font-landing-display)] text-base uppercase tracking-tight text-[var(--color-landing-text)]">
          Grupo {code}
        </h3>
      </div>
      <table className="w-full font-sans text-[11px]">
        <thead>
          <tr className="border-b border-[var(--color-landing-line)] text-[var(--color-landing-text-muted)]">
            <th className="py-1 text-left font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.14em] font-normal">
              #
            </th>
            <th className="py-1 text-left font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.14em] font-normal">
              Equipo
            </th>
            <th className="py-1 text-right font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.14em] font-normal">
              PJ
            </th>
            <th className="py-1 text-right font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.14em] font-normal">
              DG
            </th>
            <th className="py-1 text-right font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.14em] font-normal">
              PTS
            </th>
            <th className="py-1 text-right font-[family-name:var(--font-landing-mono)] text-[9px] uppercase tracking-[0.14em] font-normal">
              {""}
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => {
            const qualifies = s.position <= 2;
            const candidate = s.position === 3;
            return (
              <tr
                key={s.teamId}
                className="border-b border-[var(--color-landing-line)] last:border-b-0"
              >
                <td className="py-1 font-[family-name:var(--font-landing-mono)] text-[10px] text-[var(--color-landing-text-muted)] tabular-nums">
                  {s.position}
                </td>
                <td className="py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <TeamFlag
                      fifaCode={s.teamShortName}
                      src={s.teamFlagUrl}
                      size={14}
                    />
                    <span className="text-[var(--color-landing-text)]">
                      {s.teamShortName}
                    </span>
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums text-[var(--color-landing-text-muted)]">
                  {s.pj}
                </td>
                <td className="py-1 text-right tabular-nums text-[var(--color-landing-text-muted)]">
                  {s.dg >= 0 ? `+${s.dg}` : s.dg}
                </td>
                <td className="py-1 text-right tabular-nums font-bold text-[var(--color-landing-text)]">
                  {s.pts}
                </td>
                <td className="py-1 text-right">
                  {qualifies ? (
                    <Check
                      className="ml-auto h-3 w-3 text-[var(--color-landing-green)]"
                      aria-label="Clasifica"
                    />
                  ) : candidate ? (
                    <HelpCircle
                      className="ml-auto h-3 w-3 text-[var(--color-landing-gold)]"
                      aria-label="Candidato a mejor tercero"
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
