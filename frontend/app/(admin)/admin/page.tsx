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
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { queryKeys } from "@/lib/api/queryKeys";
import { getMetrics, type AdminMetrics } from "@/lib/api/admin";
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
          <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            Dashboard
          </h1>
          <p className="mt-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
            Vista general del torneo, recaudacion y participacion.
          </p>
        </div>
        <ExportActions />
      </header>

      {isStub ? (
        <div
          role="status"
          className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4"
        >
          <p className="font-sans text-xs text-[var(--color-prode-text-secondary)]">
            Endpoint <code className="font-mono">/admin/metrics</code> aun no
            disponible — mostrando valores en cero. Cuando el backend lo exponga
            estos numeros se actualizan en automatico.
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
              <Sparkline data={m.sparklines.usersByDay} color="#05090e" />
            ) : null
          }
          loading={isLoading}
        />
        <AdminStatCard
          label="Recaudacion"
          value={formatARS(m.revenue.total)}
          hint={`${formatNumber(m.revenue.paidUserCount)} pagos aprobados`}
          sparkline={
            m.sparklines.revenueByDay.length ? (
              <Sparkline data={m.sparklines.revenueByDay} color="#fe1743" />
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
        aria-label="Resumen de participacion"
        className="rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6"
      >
        <h2 className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
          Recaudacion (14 dias)
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
                    <stop offset="0%" stopColor="#fe1743" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#fe1743" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="x"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="#4b5667"
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #d0d5df",
                    borderRadius: 4,
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
                  stroke="#fe1743"
                  strokeWidth={2}
                  fill="url(#revArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 font-sans text-sm text-[var(--color-prode-text-secondary)]">
            No hay datos historicos todavia. Las series temporales aparecen
            cuando el backend entregue
            {" "}
            <code className="font-mono">sparklines.revenueByDay</code>.
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
      <AdminStatCard
        label="Proximo partido"
        value="—"
        hint=""
        loading
      />
    );
  }
  if (!nextMatch) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-prode-border)] bg-white p-5 md:p-6">
        <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
          Proximo partido
        </p>
        <p className="mt-3 font-sans text-sm text-[var(--color-prode-text-secondary)]">
          No hay partidos programados.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--color-prode-border)] bg-white p-5 md:p-6">
      <p className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-text-secondary)]">
        Proximo partido
      </p>
      <p className="mt-3 font-display text-xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
        {nextMatch.homeLabel}
        <span className="mx-2 text-[var(--color-prode-text-secondary)]">vs</span>
        {nextMatch.awayLabel}
      </p>
      <div className="mt-3">
        <CountdownTimer targetIso={nextMatch.kickoffAt} compact />
      </div>
      <Link
        href={`/admin/partidos/${nextMatch.id}`}
        className="mt-4 inline-flex items-center font-sans text-xs font-bold uppercase tracking-wider text-[var(--color-prode-near-black)] underline underline-offset-4"
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
 * Botones para exportar reportes (Task 7.8). Stub que muestra toast
 * "Proximamente" — si en el futuro existen `/admin/exports/payments.csv`
 * y `/admin/exports/leaderboard.pdf`, basta con apuntar el href a esas
 * URLs (con `Authorization` cookie) o disparar un `fetch + download`.
 */
function ExportActions() {
  const handle = (label: string) => {
    // TODO(backend): wire to /admin/exports/{payments.csv | leaderboard.pdf}
    toast.info(`${label} proximamente`);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outlined"
        size="sm"
        onClick={() => handle("Exportar pagos a CSV")}
      >
        <Download className="mr-2 h-4 w-4" aria-hidden />
        Exportar pagos
      </Button>
      <Button
        type="button"
        variant="outlined"
        size="sm"
        onClick={() => handle("Exportar tabla final PDF")}
      >
        <Download className="mr-2 h-4 w-4" aria-hidden />
        Exportar tabla
      </Button>
    </div>
  );
}
