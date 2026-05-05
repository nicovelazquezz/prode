"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Award, CheckCircle2, Lock, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  closePhase,
  listPhaseSummaries,
  listPrizes,
  markPrizePaid,
  type AdminPrize,
  type PhaseSummary,
} from "@/lib/api/admin";
import { formatARS, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { Phase } from "@/lib/api/types";

const PHASE_LABELS: Record<Phase, string> = {
  GROUPS: "Fase de grupos",
  ROUND_32: "16avos",
  ROUND_16: "Octavos",
  QUARTERS: "Cuartos",
  SEMIS: "Semifinales",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};

const PRIZE_LABELS: Record<AdminPrize["type"], string> = {
  GENERAL_FIRST: "1ro general",
  GENERAL_SECOND: "2do general",
  GENERAL_THIRD: "3ro general",
  PHASE_WINNER: "Ganador de fase",
};

/**
 * /admin/fases (spec §6.11). Por cada fase: card con count de
 * matches finalizados/totales, top 10, y boton "Cerrar fase"
 * habilitado SOLO si todos los matches estan FINISHED. Modal con
 * ganador propuesto + monto + nota. Lista de premios abajo.
 *
 * Mobile responsive: cards se apilan en columna en mobile.
 */
export default function AdminFasesPage() {
  const summariesQuery = useQuery({
    queryKey: queryKeys.admin.phases.summary(),
    queryFn: () => listPhaseSummaries(),
    retry: false,
  });

  const prizesQuery = useQuery({
    queryKey: queryKeys.admin.prizes(),
    queryFn: () => listPrizes(),
    retry: false,
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Fases
        </h1>
        <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          Cierre de fases con asignacion de premios y top 10 por fase.
        </p>
      </header>

      <BackendHint
        loading={summariesQuery.isLoading}
        hasData={!!summariesQuery.data}
        endpoint="/admin/phases/summary"
      />

      <section
        aria-label="Resumen por fase"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {(summariesQuery.data ?? defaultSummaries()).map((s) => (
          <PhaseCard key={s.phase} summary={s} />
        ))}
      </section>

      <section
        aria-label="Premios"
        className="rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6"
      >
        <div className="flex items-center gap-2">
          <Award
            className="h-5 w-5 text-[var(--color-prode-accent)]"
            aria-hidden
          />
          <h2 className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            Premios
          </h2>
        </div>
        <BackendHint
          loading={prizesQuery.isLoading}
          hasData={!!prizesQuery.data}
          endpoint="/admin/prizes"
          className="mt-3"
        />
        <PrizesList prizes={prizesQuery.data ?? []} loading={prizesQuery.isLoading} />
      </section>
    </div>
  );
}

function PhaseCard({ summary }: { summary: PhaseSummary }) {
  const [open, setOpen] = useState(false);
  const allFinished =
    summary.matchesTotal > 0 && summary.matchesFinished === summary.matchesTotal;
  const canClose = allFinished && !summary.closed;

  return (
    <article className="rounded-md border border-[var(--color-prode-border)] bg-white p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            {PHASE_LABELS[summary.phase]}
          </h3>
          <p className="font-sans text-xs uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            {summary.matchesFinished} / {summary.matchesTotal} finalizados
          </p>
        </div>
        {summary.closed ? (
          <span className="inline-flex items-center gap-1 rounded-pill bg-[var(--color-prode-near-black)] px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-wider text-white">
            <Lock className="h-3 w-3" aria-hidden />
            Cerrada
          </span>
        ) : null}
      </header>

      <div className="mt-4 h-2 rounded-pill bg-[var(--color-prode-surface)]">
        <div
          className="h-full rounded-pill bg-[var(--color-prode-near-black)]"
          style={{
            width: `${
              summary.matchesTotal === 0
                ? 0
                : (summary.matchesFinished / summary.matchesTotal) * 100
            }%`,
          }}
          aria-hidden
        />
      </div>

      <div className="mt-4">
        <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
          Top 10 de la fase
        </p>
        {summary.topTen.length === 0 ? (
          <p className="mt-2 font-sans text-xs italic text-[var(--color-prode-text-secondary)]">
            Sin puntos cargados aun.
          </p>
        ) : (
          <ol className="mt-2 space-y-1">
            {summary.topTen.slice(0, 10).map((entry, i) => (
              <li
                key={entry.userId}
                className="flex items-center justify-between font-sans text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono w-6 text-right tabular-nums text-[var(--color-prode-text-secondary)]">
                    {i + 1}
                  </span>
                  <span className="truncate">
                    {entry.firstName} {entry.lastName}
                  </span>
                </span>
                <span className="font-mono font-bold tabular-nums">
                  {formatNumber(entry.points)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-4">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!canClose}
          onClick={() => setOpen(true)}
        >
          <Trophy className="mr-2 h-4 w-4" aria-hidden />
          {summary.closed ? "Fase ya cerrada" : "Cerrar fase"}
        </Button>
      </div>

      <ClosePhaseDialog
        open={open}
        onOpenChange={setOpen}
        summary={summary}
      />
    </article>
  );
}

function ClosePhaseDialog({
  open,
  onOpenChange,
  summary,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  summary: PhaseSummary;
}) {
  const qc = useQueryClient();
  const closeMutation = useMutation({
    mutationFn: () => closePhase(summary.phase),
    onSuccess: () => {
      toast.success(`Fase ${PHASE_LABELS[summary.phase]} cerrada`);
      qc.invalidateQueries({ queryKey: queryKeys.admin.phases.summary() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.prizes() });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos cerrar la fase.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar {PHASE_LABELS[summary.phase]}</DialogTitle>
          <DialogDescription>
            Una vez cerrada, el ganador queda registrado y se asigna el
            premio correspondiente. Las predicciones de esta fase no se
            pueden recalcular sin reabrir.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4">
          <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
            Ganador propuesto
          </p>
          {summary.proposedWinner ? (
            <>
              <p className="mt-1 font-display text-xl font-black uppercase tracking-wide">
                {summary.proposedWinner.firstName}{" "}
                {summary.proposedWinner.lastName}
              </p>
              <p className="mt-1 font-mono text-sm">
                {formatNumber(summary.proposedWinner.points)} pts
              </p>
            </>
          ) : (
            <p className="mt-1 font-sans text-sm italic text-[var(--color-prode-text-secondary)]">
              Sin ganador (empate o sin participantes).
            </p>
          )}
        </div>
        <p className="rounded-md bg-[var(--color-prode-surface)] px-3 py-2 font-sans text-sm">
          Monto del premio:{" "}
          <span className="font-mono font-bold">
            {formatARS(summary.prizeAmount)}
          </span>
        </p>
        <p className="font-sans text-xs italic text-[var(--color-prode-text-secondary)]">
          Nota: cerrar la fase dispara la notificacion al ganador (si tiene
          opt-in WhatsApp).
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outlined"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
          >
            {closeMutation.isPending ? "Cerrando..." : "Confirmar cierre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrizesList({
  prizes,
  loading,
}: {
  prizes: AdminPrize[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const payMutation = useMutation({
    mutationFn: (id: string) => markPrizePaid(id),
    onSuccess: () => {
      toast.success("Premio marcado como pagado");
      qc.invalidateQueries({ queryKey: queryKeys.admin.prizes() });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos marcar el premio.");
    },
  });

  if (loading) {
    return (
      <div className="mt-4 space-y-2" role="status" aria-busy="true">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded bg-[var(--color-prode-surface)]"
          />
        ))}
      </div>
    );
  }

  if (prizes.length === 0) {
    return (
      <p className="mt-4 font-sans text-sm italic text-[var(--color-prode-text-secondary)]">
        Sin premios cargados todavia.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-2">
      {prizes.map((p) => (
        <li
          key={p.id}
          className="flex flex-col gap-2 rounded-md border border-[var(--color-prode-border)] bg-white p-3 md:flex-row md:items-center md:justify-between"
        >
          <div className="min-w-0">
            <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
              {PRIZE_LABELS[p.type]}
              {p.phase ? ` · ${PHASE_LABELS[p.phase]}` : ""}
            </p>
            <p className="font-display text-lg font-black uppercase tracking-wide">
              {p.recipientName ?? "Pendiente de asignar"}
            </p>
            <p className="font-mono text-sm">{formatARS(p.amount)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block rounded-pill px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-wider",
                p.status === "PAID"
                  ? "bg-[var(--color-prode-near-black)] text-white"
                  : "bg-[var(--color-prode-accent)] text-white",
              )}
            >
              {p.status}
            </span>
            {p.status === "PENDING" && p.recipientUserId ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => payMutation.mutate(p.id)}
                disabled={payMutation.isPending}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                Marcar pagado
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BackendHint({
  loading,
  hasData,
  endpoint,
  className,
}: {
  loading: boolean;
  hasData: boolean;
  endpoint: string;
  className?: string;
}) {
  if (loading || hasData) return null;
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-3 font-sans text-xs text-[var(--color-prode-text-secondary)]",
        className,
      )}
    >
      Endpoint <code className="font-mono">{endpoint}</code> aun no disponible
      en backend — mostrando placeholder.
    </div>
  );
}

function defaultSummaries(): PhaseSummary[] {
  const phases: Phase[] = [
    "GROUPS",
    "ROUND_32",
    "ROUND_16",
    "QUARTERS",
    "SEMIS",
    "THIRD_PLACE",
    "FINAL",
  ];
  return phases.map((phase) => ({
    phase,
    matchesTotal: 0,
    matchesFinished: 0,
    closed: false,
    proposedWinner: null,
    prizeAmount: 0,
    topTen: [],
  }));
}
