import real from "../fixtures/econ/indec-real.json";
import type { Pt, SeriesData, SeriesMeta } from "@/lib/analysis/types";
import type { DataClient } from "@/lib/ai/types";

/**
 * Cliente de datos para tests de MACRO AI: series oficiales reales del INDEC
 * (IPC, EMAE, salarios 2017-2026) y series diarias del BCRA sintéticas con
 * semilla fija. Registra cada llamada para verificar qué consultó el asistente.
 */
const monthly = (rows: (string | number)[][]): Pt[] => rows.map(([d, v]) => ({ d: d as string, v: v as number }));

function daily(seed: number, start: number, drift: number, vol: number): Pt[] {
  let a = seed;
  const rnd = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const out: Pt[] = [];
  let v = start;
  for (let t = Date.UTC(2017, 0, 2); t <= Date.UTC(2026, 9, 30); t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    v *= 1 + drift + vol * rnd();
    out.push({ d: new Date(t).toISOString().slice(0, 10), v: Number(v.toFixed(4)) });
  }
  return out;
}

const meta = (id: string, name: string, source: "INDEC" | "BCRA", unit: string, frequency: SeriesMeta["frequency"], code: string | null, kind: SeriesMeta["value_kind"] = "original"): SeriesMeta => ({
  id, name, source_id: source, source_code: code, unit, frequency, value_kind: kind, category: "", subcategory: null, panel: null, update_status: "ok", last_date: null, methodology_url: null,
});

const ipc = monthly(real.series.ipc);
const sal = monthly(real.series.salarios);
const ipcBy = new Map(ipc.map((p) => [p.d, p.v!]));

export const AI_SERIES: SeriesData[] = [
  { meta: meta("indec.ipc_nivel_general", "IPC Nivel General Nacional (dic-2016=100)", "INDEC", "Índice dic-2016=100", "M", "148.3_INIVELNAL_DICI_M_26"), points: ipc },
  { meta: meta("indec.emae_desest", "EMAE desestacionalizado", "INDEC", "Índice 2004=100", "M", "143.3_NO_PR_2004_A_31"), points: monthly(real.series.emae) },
  { meta: meta("indec.salarios", "Índice de salarios", "INDEC", "Índice oct-2016=100", "M", "149.1_TL_INDIIOS_OCTU_0_21"), points: sal },
  { meta: meta("calc.salarios_reales", "Salario real", "INDEC", "Índice dic-2016=100", "M", null, "calculated"), points: sal.filter((p) => ipcBy.has(p.d)).map((p) => ({ d: p.d, v: (p.v! / ipcBy.get(p.d)!) * 100 })) },
  { meta: meta("bcra.reservas", "Reservas internacionales", "BCRA", "Millones de USD", "D", "1"), points: daily(7, 40000, 0.0001, 0.01) },
  { meta: meta("bcra.tc_mayorista", "Tipo de cambio mayorista", "BCRA", "Pesos por dólar", "D", "5"), points: daily(11, 16, 0.0019, 0.006) },
  { meta: meta("bcra.base_monetaria", "Base monetaria", "BCRA", "Millones de pesos", "D", "15"), points: daily(13, 800000, 0.0013, 0.01) },
  { meta: meta("bcra.m2", "M2 en moneda local", "BCRA", "Millones de pesos", "D", "1618"), points: daily(17, 1500000, 0.0014, 0.008) },
  { meta: meta("bcra.badlar", "Tasa BADLAR bancos privados (TNA)", "BCRA", "Porcentaje", "D", "7"), points: daily(19, 20, 0.0002, 0.02) },
  { meta: meta("bcra.prestamos_privados", "Préstamos al sector privado", "BCRA", "Millones de pesos", "D", "26"), points: daily(23, 900000, 0.0012, 0.005) },
];

export interface CallLog {
  searches: string[];
  series: string[][];
}

export function testClient(log: CallLog = { searches: [], series: [] }, opts: { failSeries?: boolean } = {}): DataClient & { log: CallLog } {
  return {
    log,
    async search(q, o) {
      log.searches.push(q);
      const terms = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/);
      return AI_SERIES.filter((s) => terms.every((t) => `${s.meta.name} ${s.meta.id}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(t)))
        .filter((s) => !o?.source || s.meta.source_id === o.source)
        .slice(0, o?.limit ?? 8)
        .map((s) => ({ id: s.meta.id, name: s.meta.name, source_id: s.meta.source_id, source_code: s.meta.source_code, unit: s.meta.unit, frequency: s.meta.frequency, last_date: s.points.at(-1)!.d, update_status: "ok" }));
    },
    async series(ids) {
      log.series.push(ids);
      if (opts.failSeries) throw new Error("Base de datos no disponible");
      const found = ids.map((id) => AI_SERIES.find((s) => s.meta.id === id)).filter((s): s is SeriesData => Boolean(s));
      return { series: found, ipc, missing: ids.filter((id) => !found.some((s) => s.meta.id === id)), errors: {} };
    },
    async savedAnalyses() {
      return [{ id: "a1", title: "Reservas vs. base", kind: "analysis", indicator_ids: ["bcra.reservas", "bcra.base_monetaria"], updated_at: "2026-11-01T00:00:00Z" }];
    },
  };
}
