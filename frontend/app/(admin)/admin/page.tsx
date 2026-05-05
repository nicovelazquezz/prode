"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { AdminStatCard } from "@/components/domain/admin-stat-card";
import { CountdownTimer } from "@/components/domain/countdown-timer";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import {
  downloadExport,
  getMetrics,
  type AdminMetrics,
} from "@/lib/api/admin";
import { formatARS, formatNumber } from "@/lib/utils/format";

/**
 * Dashboard admin (spec §6.11). Stat cards con numeros display 48px
 * + sparklines via recharts. Si el endpoint backend `/admin/metrics`
 * todavia no existe (caso esperado en MVP del backend), la query falla
 * y mostramos un placeholder estatico para que el panel siga siendo
 * navegable y visualmente completo. Cuando el endpoint exista los
 * stats reales aparecen automaticamente.
 *
 * Mobile responsive: 1 columna con stack vertical, en md+ grid 2x2,
 * en xl+ grid 4 columnas.
 */
export default function AdminDashboardPage() {
  const metricsQuery = useQuery({
    queryKey: queryKeys.admin.metrics(),
    queryFn: () => getMetrics(),
    staleTime: 30_000,
    // Si el endpoint todavia no existe en backend, no reintentamos.
    retry: false,
  });

  const isLoading = metricsQuery.isLoading;
  const data = metricsQuery.data;
  // TODO(backend): cuando `/admin/metrics` exista, eliminar este
  // fallback. Por ahora dejamos placeholders para no bloquear la UI.
  const fallback = useMemo<AdminMetrics>(
    () => ({
      totals: { users: 0, active: 0, pending: 0, banned: 0 },
      revenue: { total: 0, paidUserCount: 0 },
      predictions: { loaded: 0, expected: 0 },
      nextMatch: null,
      sparklines: { usersByDay: [], revenueByDay: [] },
    }),
    [],
  );
  const m: AdminMetrics = data ?? fallback;
  const isStub = !data && !isLoading;

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
        <ExportActions />
      </header>

      {isStub ? (
        <div
          role="status"
          className="rounded-sm border border-dashed border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-4"
        >
          <p className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
            Endpoint <code className="font-[family-name:var(--font-landing-mono)] text-[var(--color-landing-gold)]">/admin/metrics</code> aún no disponible — mostrando valores en cero.
          </p>
        </div>
      ) : null}

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
        aria-label="Reportes"
        className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5 md:p-6"
      >
        <h2 className="font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight text-[var(--color-landing-text)]">
          Reportes
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
          Descargá reportes para procesamiento offline (contabilidad,
          comunicación, premios). Los archivos los genera el backend on-demand.
        </p>
        <div className="mt-4">
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
