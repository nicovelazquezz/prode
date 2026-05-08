"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, RotateCw } from "lucide-react";
import { AdminStatCard } from "@/components/domain/admin-stat-card";
import { CountdownTimer } from "@/components/domain/countdown-timer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  downloadExport,
  getMetrics,
  listConfig,
  refreshLeaderboard,
  type AdminMetrics,
} from "@/lib/api/admin";
import { getPublicStats } from "@/lib/api/stats";
import { formatARS, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Dashboard admin (spec §6.11). Stat cards con números display + sparklines
 * via recharts.
 *
 * Datos:
 *  - `getMetrics()` (admin) — métricas internas con sparklines.
 *  - `getPublicStats()` (público) — `enrolledUsers` que alimenta el
 *    widget destacado "X / Y inscriptos".
 *  - `listConfig()` (admin) — leemos `max_users` del AppConfig para el
 *    cap del widget.
 *
 * Mobile responsive: 1 columna con stack vertical, en md+ grid 2x2,
 * en xl+ grid 4 columnas.
 */
export default function AdminDashboardPage() {
  const metricsQuery = useQuery({
    queryKey: queryKeys.admin.metrics(),
    queryFn: () => getMetrics(),
    staleTime: 30_000,
    retry: false,
  });

  // Inscriptos / cap — widget destacado del dashboard.
  const publicStatsQuery = useQuery({
    queryKey: queryKeys.stats.public(),
    queryFn: () => getPublicStats(),
    staleTime: 30_000,
  });
  const configQuery = useQuery({
    queryKey: queryKeys.admin.config(),
    queryFn: () => listConfig(),
    staleTime: 5 * 60_000,
  });
  const maxUsers = useMemo(() => {
    const entry = configQuery.data?.find((c) => c.key === "max_users");
    if (!entry) return null;
    const n = Number.parseInt(entry.value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [configQuery.data]);
  const enrolled = publicStatsQuery.data?.enrolledUsers ?? 0;

  const isLoading = metricsQuery.isLoading;
  const data = metricsQuery.data;
  const fallback = useMemo<AdminMetrics>(
    () => ({
      totals: { users: 0, active: 0, pending: 0, banned: 0 },
      revenue: {
        total: 0,
        paidUserCount: 0,
        byMethod: {
          MERCADOPAGO: { total: 0, count: 0 },
          CASH: { total: 0, count: 0 },
          TRANSFER: { total: 0, count: 0 },
        },
      },
      predictions: { loaded: 0, expected: 0 },
      nextMatch: null,
      sparklines: { usersByDay: [], revenueByDay: [] },
    }),
    [],
  );
  const m: AdminMetrics = data ?? fallback;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
            Panel admin
          </div>
          <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
              Dashboard.
            </span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            Vista general del torneo, recaudación y participación.
          </p>
        </div>
      </header>

      <EnrolledCard
        enrolled={enrolled}
        cap={maxUsers}
        loading={publicStatsQuery.isLoading || configQuery.isLoading}
      />

      <RevenueByMethodCard
        total={m.revenue.total}
        byMethod={m.revenue.byMethod}
        loading={isLoading}
      />

      <section
        aria-label="Metricas principales"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        <AdminStatCard
          label="Usuarios activos"
          value={formatNumber(m.totals.active)}
          hint={`${formatNumber(m.totals.pending)} pendientes · ${formatNumber(
            m.totals.banned,
          )} baneados`}
          sparkline={
            m.sparklines.usersByDay.length ? (
              <Sparkline data={m.sparklines.usersByDay} color="#5c7847" />
            ) : null
          }
          loading={isLoading}
        />
        <AdminStatCard
          label="Recaudación"
          value={formatARS(m.revenue.total)}
          hint={`${formatNumber(m.revenue.paidUserCount)} pagos aprobados`}
          sparkline={
            m.sparklines.revenueByDay.length ? (
              <Sparkline data={m.sparklines.revenueByDay} color="#c8a053" />
            ) : null
          }
          loading={isLoading}
        />
        <AdminStatCard
          label="Predicciones cargadas"
          value={formatNumber(m.predictions.loaded)}
          hint={`Esperadas ${formatNumber(m.predictions.expected)} · ${
            m.predictions.expected > 0
              ? Math.round((m.predictions.loaded / m.predictions.expected) * 100)
              : 0
          }% completado`}
          loading={isLoading}
        />
        <NextMatchCard
          loading={isLoading}
          nextMatch={m.nextMatch}
        />
      </section>

      <section
        aria-label="Acciones"
        className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6"
      >
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Acciones
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          Recálculo manual del leaderboard y descarga de reportes para
          procesamiento offline (contabilidad, comunicación, premios).
        </p>
        <div className="mt-4 flex flex-col gap-2 md:flex-row md:flex-wrap">
          <RefreshLeaderboardButton />
          <ExportActions />
        </div>
      </section>

      <section
        aria-label="Resumen de participacion"
        className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6"
      >
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Recaudación (14 días)
        </h2>
        {m.sparklines.revenueByDay.length ? (
          <div className="mt-4 h-48 w-full">
            <ResponsiveContainer>
              <AreaChart
                data={toChartData(m.sparklines.revenueByDay)}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="revArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c8a053" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#c8a053" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="x"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="#8a92a8"
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "#1b2238",
                    border: "1px solid rgba(241,236,224,0.14)",
                    borderRadius: 4,
                    color: "#f1ece0",
                    fontFamily: "var(--font-sans)",
                  }}
                  formatter={(value) => [
                    formatARS(typeof value === "number" ? value : 0),
                    "Recaudado",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="y"
                  stroke="#c8a053"
                  strokeWidth={2}
                  fill="url(#revArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
            No hay datos históricos todavía. Las series temporales aparecen cuando el backend entregue {" "}
            <code className="font-[family-name:var(--font-landing-mono)] text-[var(--color-landing-gold)]">sparklines.revenueByDay</code>.
          </p>
        )}
      </section>
    </div>
  );
}

function NextMatchCard({
  loading,
  nextMatch,
}: {
  loading: boolean;
  nextMatch: AdminMetrics["nextMatch"];
}) {
  if (loading) {
    return (
      <AdminStatCard label="Próximo partido" value="—" hint="" loading />
    );
  }
  if (!nextMatch) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
        <p className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Próximo partido
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          No hay partidos programados.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
      <p className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Próximo partido
      </p>
      <p className="mt-3 font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight text-[var(--color-landing-text)]">
        {nextMatch.homeLabel}
        <span className="mx-2 text-[var(--color-landing-text-muted)]">vs</span>
        {nextMatch.awayLabel}
      </p>
      <div className="mt-3">
        <CountdownTimer targetIso={nextMatch.kickoffAt} compact />
      </div>
      <Link
        href={`/admin/partidos/${nextMatch.id}`}
        className="mt-4 inline-flex items-center font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] underline underline-offset-4 decoration-[var(--color-landing-green)] decoration-2 hover:text-[var(--color-landing-gold)]"
      >
        Ver detalle
      </Link>
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = toChartData(data);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={chartData}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <Area
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.15}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function toChartData(values: number[]): Array<{ x: number; y: number }> {
  return values.map((y, i) => ({ x: i + 1, y }));
}

/**
 * Botones para exportar reportes (Task 7.8). Si el backend tiene los
 * endpoints (`/admin/exports/payments.csv` y `/admin/exports/leaderboard.pdf`)
 * dispara la descarga via blob URL programatica. Si devuelven 404 o
 * cualquier error, muestra toast "Proximamente" para no romper la UX.
 *
 * El flow del download:
 *   1. fetch al endpoint con auth automatic via api client
 *   2. response.blob() → URL.createObjectURL → <a download> click
 *   3. revoke object URL al final para liberar memoria
 *
 * TODO(backend): cuando los endpoints existan en backend, esta UX ya
 * funciona sin cambios. Si nunca se implementan, el toast queda como
 * mensaje permanente.
 */
function ExportActions() {
  const handle = async (
    label: string,
    endpoint: "payments.csv" | "leaderboard.pdf",
  ) => {
    try {
      const { url, filename } = await downloadExport(endpoint);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Permitir al browser leer el blob antes de revocar.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${label} descargado`);
    } catch {
      // 404 / network → asumir endpoint no implementado todavia.
      toast.info(`${label} — proximamente`);
    }
  };
  const cls =
    "inline-flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]";

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => handle("Exportar pagos a CSV", "payments.csv")}
        className={cls}
      >
        <Download className="h-4 w-4" aria-hidden />
        Exportar pagos
      </button>
      <button
        type="button"
        onClick={() => handle("Exportar tabla final PDF", "leaderboard.pdf")}
        className={cls}
      >
        <Download className="h-4 w-4" aria-hidden />
        Exportar tabla
      </button>
    </div>
  );
}

/**
 * Botón "Refrescar leaderboard" — encola un job en backend que
 * recalcula la materialized view. Útil cuando el admin cambia
 * scoring rules o phase multipliers y quiere ver el efecto sin
 * esperar al próximo trigger automático.
 *
 * UX:
 *   1. Click → dialog de confirmación (la operación puede tardar
 *      varios segundos y no es necesariamente reversible).
 *   2. Confirmar → POST /admin/leaderboard/refresh → toast informa
 *      que el recálculo está en cola y los datos aparecen en 1-2 min.
 *   3. Botón disabled mientras isPending para evitar dobles clicks.
 *
 * No invalidamos las queries del leaderboard inmediatamente porque el
 * recálculo es asíncrono — el user lo verá en el próximo refetch.
 */
function RefreshLeaderboardButton() {
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => refreshLeaderboard(),
    onSuccess: () => {
      toast.success(
        "Recálculo encolado — los datos se actualizan en 1-2 minutos",
      );
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "No pudimos encolar el recálculo");
    },
  });

  const cls =
    "inline-flex items-center gap-2 rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-4 py-2 font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={mutation.isPending}
        className={cls}
      >
        <RotateCw
          className={cn("h-4 w-4", mutation.isPending && "animate-spin")}
          aria-hidden
        />
        Refrescar leaderboard
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
            <span className="inline-block border-b-[3px] border-[var(--color-landing-green)] pb-1">
              Recalcular leaderboard
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
            El sistema va a recalcular la tabla desde cero. Los datos
            actualizados aparecen en 1-2 minutos. Hacelo si cambiaste reglas
            de puntaje o multiplicadores.
          </DialogDescription>
          <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-stretch">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
              className="inline-flex flex-1 items-center justify-center rounded-sm border border-[var(--color-landing-line-strong)] bg-transparent px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="inline-flex flex-1 items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-3 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mutation.isPending ? "Encolando..." : "Confirmar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Widget "Inscriptos" — number heroico tipo Anton 56-72px con cap
 * configurable y barra de progreso. Color del número y la barra
 * cambia según el ratio: verde <70%, gold 70-90%, red >90%. Da
 * visibilidad inmediata de cuán cerca estamos del cap del torneo.
 *
 * Si `max_users` no está configurado en AppConfig (cap = null),
 * mostramos solo el número actual sin la barra ni el ratio.
 */
function EnrolledCard({
  enrolled,
  cap,
  loading,
}: {
  enrolled: number;
  cap: number | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
        <div className="h-3 w-24 rounded-sm bg-[var(--color-landing-surface-2)] animate-pulse" />
        <div className="mt-4 h-12 w-40 rounded-sm bg-[var(--color-landing-surface-2)] animate-pulse" />
      </div>
    );
  }

  const ratio = cap ? Math.min(1, enrolled / cap) : 0;
  const percentage = cap ? Math.round(ratio * 100) : 0;
  const color = !cap
    ? "var(--color-landing-text)"
    : ratio < 0.7
      ? "var(--color-landing-green)"
      : ratio < 0.9
        ? "var(--color-landing-gold)"
        : "var(--color-landing-red)";

  return (
    <section
      aria-label="Inscriptos"
      className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Inscriptos
        </p>
        {cap !== null ? (
          <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            {percentage}% del cap configurado
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span
          className="font-[family-name:var(--font-landing-display)] text-5xl md:text-6xl tabular-nums leading-none transition-colors duration-300"
          style={{ color }}
        >
          {formatNumber(enrolled)}
        </span>
        {cap !== null ? (
          <span className="font-[family-name:var(--font-landing-mono)] text-[16px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] tabular-nums">
            / {formatNumber(cap)}
          </span>
        ) : null}
      </div>
      {cap !== null ? (
        <div
          className="mt-4 h-1 w-full rounded-sm bg-[var(--color-landing-surface-2)] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={enrolled}
          aria-label={`${enrolled} de ${cap} inscriptos`}
        >
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${percentage}%`, background: color }}
          />
        </div>
      ) : null}
    </section>
  );
}


/**
 * Widget "Recaudado por método" (Q4=B). Muestra el total + desglose
 * por método de pago (MercadoPago / Transferencia / Efectivo) con
 * monto absoluto y porcentaje del total.
 *
 * Visualización: 3 mini-cards horizontales con barra de progreso
 * proporcional al monto. Cada método tiene su acento de color:
 *   - MercadoPago: blue (--color-landing-blue)
 *   - Transferencia: green (--color-landing-green)
 *   - Efectivo: gold (--color-landing-gold)
 *
 * Si el total es 0 (no hubo pagos todavía), las barras quedan vacías
 * y los montos en 0 — sin layout shift cuando empiecen a llegar pagos.
 */
function RevenueByMethodCard({
  total,
  byMethod,
  loading,
}: {
  total: number;
  byMethod: AdminMetrics["revenue"]["byMethod"];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6">
        <div className="h-3 w-32 rounded-sm bg-[var(--color-landing-surface-2)] animate-pulse" />
        <div className="mt-4 h-12 w-48 rounded-sm bg-[var(--color-landing-surface-2)] animate-pulse" />
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-sm bg-[var(--color-landing-surface-2)] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const methods = [
    {
      key: "MERCADOPAGO" as const,
      label: "MercadoPago",
      color: "var(--color-landing-blue)",
      data: byMethod.MERCADOPAGO,
    },
    {
      key: "TRANSFER" as const,
      label: "Transferencia",
      color: "var(--color-landing-green)",
      data: byMethod.TRANSFER,
    },
    {
      key: "CASH" as const,
      label: "Efectivo",
      color: "var(--color-landing-gold)",
      data: byMethod.CASH,
    },
  ];

  return (
    <section
      aria-label="Recaudado por método"
      className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Recaudado por método
        </p>
        <p className="font-[family-name:var(--font-landing-display)] text-3xl md:text-4xl tabular-nums leading-none text-[var(--color-landing-gold)]">
          {formatARS(total)}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {methods.map((m) => {
          const percentage = total > 0 ? (m.data.total / total) * 100 : 0;
          return (
            <div
              key={m.key}
              className="rounded-sm border border-[var(--color-landing-line)] bg-[var(--color-landing-surface-2)] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className="font-[family-name:var(--font-landing-mono)] text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: m.color }}
                >
                  {m.label}
                </p>
                <p className="font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)] tabular-nums">
                  {Math.round(percentage)}%
                </p>
              </div>
              <p className="mt-2 font-[family-name:var(--font-landing-display)] text-2xl tabular-nums leading-none text-[var(--color-landing-text)]">
                {formatARS(m.data.total)}
              </p>
              <p className="mt-1 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
                {formatNumber(m.data.count)}{" "}
                {m.data.count === 1 ? "pago" : "pagos"}
              </p>
              <div
                className="mt-3 h-1 w-full rounded-sm bg-[var(--color-landing-surface)] overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percentage)}
              >
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${percentage}%`,
                    background: m.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
