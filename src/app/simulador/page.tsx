import { Suspense } from "react";
import { Simulator, type SimulatorDefaults } from "@/components/simulator/simulator";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { PageHeader } from "@/components/ui-kit/panel";
import { resample } from "@/lib/analysis/frequency";
import type { Pt, SeriesData } from "@/lib/analysis/types";
import { getSeriesBundle, IPC_ID } from "@/lib/data/series";
import { formatNumber } from "@/lib/format";

export const metadata = { title: "Simulador macroeconómico" };

const IDS = {
  ipc: IPC_ID,
  fx: "bcra.tc_mayorista",
  base: "bcra.base_monetaria",
  reserves: "bcra.reservas",
  wage: "indec.salarios",
  rate: "bcra.plazo_fijo_30d",
};

export default function SimulatorPage() {
  return (
    <>
      <PageHeader
        code="07 · SIM"
        title="Simulador macroeconómico"
        description="Tres herramientas distintas que nunca se mezclan: identidades aritméticas exactas, escenarios que definís vos encadenados desde los últimos datos oficiales, y respuestas a shocks en un modelo VAR estimado con datos reales. Ninguna es una predicción ni un modelo causal validado."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
        <SimulatorData />
      </Suspense>
    </>
  );
}

const valid = (pts: Pt[]) => pts.filter((p): p is { d: string; v: number } => p.v !== null);
const last = (pts: Pt[]) => valid(pts).at(-1) ?? null;

/** Promedio de las últimas `k` variaciones % mensuales. */
function avgMonthlyChange(monthly: Pt[], k: number): number {
  const v = valid(monthly);
  const ch: number[] = [];
  for (let i = Math.max(1, v.length - k); i < v.length; i++) ch.push((v[i].v / v[i - 1].v - 1) * 100);
  return ch.length ? ch.reduce((a, b) => a + b, 0) / ch.length : 0;
}

function monthly(s: SeriesData | undefined, agg: "avg" | "last"): Pt[] {
  if (!s) return [];
  return s.meta.frequency === "M" ? s.points : resample(s.points, s.meta.frequency, "M", agg).points;
}

async function SimulatorData() {
  const res = await safeLoad(() => getSeriesBundle(Object.values(IDS)));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const by = new Map(res.data.series.map((s) => [s.meta.id, s]));
  const ipc = by.get(IDS.ipc);
  const pick = { fx: last(by.get(IDS.fx)?.points ?? []), base: last(by.get(IDS.base)?.points ?? []), reserves: last(by.get(IDS.reserves)?.points ?? []), wage: last(by.get(IDS.wage)?.points ?? []), rate: last(by.get(IDS.rate)?.points ?? []) };
  const ipcLast = last(ipc?.points ?? []);
  if (!ipc || !ipcLast || !pick.fx || !pick.base || !pick.reserves || !pick.wage) {
    return <p className="text-sm text-muted-foreground">Faltan datos oficiales para armar el punto de partida (IPC, tipo de cambio, base monetaria, reservas o salarios). Ejecutá la sincronización.</p>;
  }
  const reservesMonthly = valid(monthly(by.get(IDS.reserves), "last"));
  const flows = reservesMonthly.slice(-7).map((p, i, a) => (i ? p.v - a[i - 1].v : null)).filter((x): x is number => x !== null);
  const fmtv = (v: number, d = 2) => formatNumber(v, { decimals: d });
  const defaults: SimulatorDefaults = {
    start: { date: ipcLast.d, ipc: ipcLast.v, fx: pick.fx.v, base: pick.base.v, reserves: pick.reserves.v, wage: pick.wage.v },
    recent: {
      inflation: avgMonthlyChange(ipc.points, 1),
      devaluation: avgMonthlyChange(monthly(by.get(IDS.fx), "avg"), 3),
      baseGrowth: avgMonthlyChange(monthly(by.get(IDS.base), "avg"), 3),
      wageGrowth: avgMonthlyChange(by.get(IDS.wage)!.points, 3),
      rate: pick.rate?.v ?? null,
      reserveFlow: flows.length ? flows.reduce((a, b) => a + b, 0) / flows.length : 0,
    },
    sources: [
      { name: "IPC nivel general (INDEC)", value: fmtv(ipcLast.v), date: ipcLast.d },
      { name: "Tipo de cambio mayorista (BCRA)", value: fmtv(pick.fx.v), date: pick.fx.d },
      { name: "Base monetaria, M$ (BCRA)", value: fmtv(pick.base.v, 0), date: pick.base.d },
      { name: "Reservas, M US$ (BCRA)", value: fmtv(pick.reserves.v, 0), date: pick.reserves.d },
      { name: "Índice de salarios (INDEC)", value: fmtv(pick.wage.v), date: pick.wage.d },
      ...(pick.rate ? [{ name: "Plazo fijo 30 días, TNA % (BCRA)", value: fmtv(pick.rate.v), date: pick.rate.d }] : []),
    ],
  };
  return <Simulator defaults={defaults} />;
}
