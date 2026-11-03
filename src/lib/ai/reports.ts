import { periodBreakdown } from "../analysis/breakdown";
import { FREQ_NAME } from "../analysis/frequency";
import type { SeriesData } from "../analysis/types";
import { runTool } from "./tools";
import type { Block, DataClient, SourceRef, ToolResult } from "./types";

/**
 * Informes automáticos. Se construyen solo con datos reales y herramientas
 * verificadas; el texto es descriptivo (hechos con su fecha y unidad), sin
 * afirmaciones causales. Cada dato muestra su frecuencia real: un informe
 * "diario" no presenta como diaria una serie mensual.
 */

export type ReportKind = "diario" | "inflacion" | "monetario" | "cambiario" | "reservas" | "actividad" | "salarios" | "mensual" | "personalizado";

export const REPORT_LABEL: Record<ReportKind, { title: string; description: string }> = {
  diario: { title: "Informe macroeconómico diario", description: "Últimos datos diarios del BCRA y últimos datos publicados de las series mensuales, cada uno con su fecha." },
  inflacion: { title: "Informe de inflación", description: "IPC: variación mensual, interanual y acumulada; núcleo y regulados; alertas." },
  monetario: { title: "Informe monetario", description: "Base monetaria y M2: variaciones nominales y reales." },
  cambiario: { title: "Informe cambiario", description: "Tipo de cambio mayorista, bandas, devaluación vs. inflación y tipo de cambio real." },
  reservas: { title: "Informe de reservas", description: "Reservas internacionales: evolución, variaciones mensuales y alertas." },
  actividad: { title: "Informe de actividad", description: "EMAE desestacionalizado, variación mensual e interanual, industria y construcción." },
  salarios: { title: "Informe de salarios reales", description: "Salario real, variación interanual real y salario nominal vs. inflación." },
  mensual: { title: "Informe macroeconómico mensual", description: "Resumen del último mes con datos completos: precios, actividad, dinero, cambio, reservas y salarios." },
  personalizado: { title: "Informe personalizado", description: "Series elegidas por el usuario: gráfico, datos período a período y alertas." },
};

export interface ReportSection {
  title: string;
  text: string[];
  blocks: Block[];
}

export interface Report {
  kind: ReportKind;
  title: string;
  generatedAt: string;
  /** Frecuencia y fecha del último dato de cada serie usada. */
  coverage: string[];
  sections: ReportSection[];
  sources: SourceRef[];
  methodology: string[];
  warnings: string[];
}

const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "s/d" : v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
const dayName = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const signed = (v: number | null, u: string, d = 1) => (v === null ? "s/d" : `${v > 0 ? "+" : ""}${fmt(v, d)} ${u}`);

/** Último dato y variaciones de una serie, con su frecuencia real. */
function latest(s: SeriesData) {
  const pts = s.points.filter((p) => p.v !== null) as { d: string; v: number }[];
  const last = pts.at(-1);
  if (!last) return null;
  if (s.meta.frequency === "D" || s.meta.frequency === "W") {
    const prev = pts.at(-2);
    const target = new Date(Date.parse(last.d) - 30 * 86_400_000).toISOString().slice(0, 10);
    const m1 = [...pts].reverse().find((p) => p.d <= target);
    return { d: last.d, v: last.v, label: dayName(last.d), chPrev: prev ? (last.v / prev.v - 1) * 100 : null, ch30: m1 ? (last.v / m1.v - 1) * 100 : null, yoy: null as number | null, ytd: null as number | null, kind: "level" as const };
  }
  const b = periodBreakdown(s.points, s.meta.frequency, s.meta.unit, s.meta.name);
  const r = b.rows[0];
  return { d: r.d, v: r.value ?? last.v, label: s.meta.frequency === "M" ? monthName(r.d) : `${r.d.slice(0, 7)} (${FREQ_NAME[s.meta.frequency]})`, chPrev: r.prev, ch30: null, yoy: r.yoy, ytd: r.ytd, kind: b.kind };
}

function srcOf(s: SeriesData): SourceRef {
  const pts = s.points.filter((p) => p.v !== null);
  return { id: s.meta.id, name: s.meta.name, source: s.meta.source_id, code: s.meta.source_code, unit: s.meta.unit, frequency: s.meta.frequency, from: pts[0]?.d ?? null, to: pts.at(-1)?.d ?? null, kind: s.meta.value_kind };
}

const KPI_HEADER = ["Indicador", "Frecuencia", "Último dato", "Valor", "Unidad", "Var. vs. anterior", "Var. 30 días / interanual"];

async function kpiTable(client: DataClient, ids: string[], title: string) {
  const res = await client.series(ids);
  const byId = new Map(res.series.map((s) => [s.meta.id, s]));
  const rows: (string | number | null)[][] = [];
  const coverage: string[] = [];
  const sources: SourceRef[] = [];
  const facts = new Map<string, NonNullable<ReturnType<typeof latest>>>();
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    const l = latest(s);
    if (!l) continue;
    facts.set(id, l);
    sources.push(srcOf(s));
    const daily = s.meta.frequency === "D" || s.meta.frequency === "W";
    const u = l.kind === "rate" ? "pp" : "%";
    rows.push([s.meta.name, FREQ_NAME[s.meta.frequency], l.label, l.v, s.meta.unit, signed(l.chPrev, u, 2), daily ? signed(l.ch30, "%", 2) : signed(l.yoy, u, 1)]);
    coverage.push(`${s.meta.name}: ${FREQ_NAME[s.meta.frequency]}, último dato ${l.label}.`);
  }
  return { block: { type: "table" as const, title, header: KPI_HEADER, rows }, coverage, sources, facts, byId, missing: res.missing };
}

const merge = (results: ToolResult[]) => ({
  blocks: results.flatMap((r) => r.blocks),
  sources: results.flatMap((r) => r.sources),
  methodology: results.flatMap((r) => r.methodology),
  warnings: results.flatMap((r) => (r.ok ? [] : [r.summary])),
});

function dedupe<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

const yearsAgo = (iso: string, n: number) => `${Number(iso.slice(0, 4)) - n}${iso.slice(4, 7)}`;

export async function buildReport(kind: ReportKind, client: DataClient, opts: { ids?: string[]; today?: string } = {}): Promise<Report> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const sections: ReportSection[] = [];
  const sources: SourceRef[] = [];
  const methodology: string[] = [];
  const warnings: string[] = [];
  const coverage: string[] = [];
  const addTools = async (title: string, text: string[], calls: [string, Record<string, unknown>][]) => {
    const rs = await Promise.all(calls.map(([n, a]) => runTool(n, a, client)));
    const m = merge(rs);
    sections.push({ title, text, blocks: m.blocks });
    sources.push(...m.sources);
    methodology.push(...m.methodology);
    warnings.push(...m.warnings);
  };
  const addKpis = async (title: string, ids: string[], text: (f: Awaited<ReturnType<typeof kpiTable>>) => string[]) => {
    const k = await kpiTable(client, ids, title);
    sections.push({ title, text: text(k), blocks: [k.block] });
    sources.push(...k.sources);
    coverage.push(...k.coverage);
    if (k.missing.length) warnings.push(`Series no disponibles: ${k.missing.join(", ")}.`);
    return k;
  };
  const from24 = yearsAgo(today, 2);

  switch (kind) {
    case "diario": {
      await addKpis("Datos diarios (BCRA)", ["bcra.tc_mayorista", "bcra.reservas", "bcra.base_monetaria", "bcra.badlar", "bcra.tamar", "bcra.plazo_fijo_30d"], (k) => {
        const fx = k.facts.get("bcra.tc_mayorista");
        const rs = k.facts.get("bcra.reservas");
        return [
          ...(fx ? [`Tipo de cambio mayorista: $ ${fmt(fx.v, 2)} por dólar al ${fx.label} (${signed(fx.chPrev, "%", 2)} vs. dato anterior; ${signed(fx.ch30, "%", 2)} en 30 días).`] : []),
          ...(rs ? [`Reservas internacionales: US$ ${fmt(rs.v, 0)} millones al ${rs.label} (${signed(rs.ch30, "%", 2)} en 30 días).`] : []),
        ];
      });
      await addKpis("Últimos datos de series mensuales y trimestrales", ["calc.ipc_var_mensual", "bcra.inflacion_mensual", "calc.ipc_var_interanual", "indec.emae_desest", "calc.salarios_reales"], (k) => {
        const ipc = k.facts.get("calc.ipc_var_mensual");
        const bc = k.facts.get("bcra.inflacion_mensual");
        const t = ["Estas series no son diarias: se muestra el último dato publicado, con el mes al que corresponde."];
        if (ipc) t.push(`Último IPC con índice completo: ${fmt(ipc.v, 2)} % mensual en ${ipc.label}.`);
        if (bc && ipc && bc.d > ipc.d) t.push(`El BCRA ya republicó la inflación de ${bc.label}: ${fmt(bc.v, 1)} % (dato del INDEC, 1 decimal).`);
        return t;
      });
      const m3 = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 4, 1)).toISOString().slice(0, 7);
      await addTools("Últimos tres meses (datos diarios)", [], [["grafico", { ids: ["bcra.tc_mayorista", "bcra.reservas"], desde: m3, transformacion: "nivel", frecuencia: "D", titulo: "Tipo de cambio mayorista y reservas (diario)" }]]);
      break;
    }
    case "inflacion": {
      await addKpis("Inflación: últimos datos", ["calc.ipc_var_mensual", "calc.ipc_var_interanual", "calc.ipc_var_acumulada", "calc.ipc_nucleo_var_mensual", "bcra.inflacion_mensual"], (k) => {
        const m = k.facts.get("calc.ipc_var_mensual");
        const y = k.facts.get("calc.ipc_var_interanual");
        const a = k.facts.get("calc.ipc_var_acumulada");
        const n = k.facts.get("calc.ipc_nucleo_var_mensual");
        const bc = k.facts.get("bcra.inflacion_mensual");
        const t: string[] = [];
        if (m) t.push(`La inflación de ${m.label} fue ${fmt(m.v, 2)} % mensual (${signed(m.chPrev, "pp", 2)} respecto del mes anterior).`);
        if (y) t.push(`La variación interanual fue ${fmt(y.v, 2)} % y la acumulada en el año ${a ? `${fmt(a.v, 2)} %` : "s/d"}.`);
        if (n) t.push(`La inflación núcleo fue ${fmt(n.v, 2)} % mensual.`);
        if (bc && m && bc.d > m.d) t.push(`Dato más reciente publicado (vía BCRA, 1 decimal): ${fmt(bc.v, 1)} % en ${bc.label}; el índice completo todavía no está en la API de series.`);
        return t;
      });
      await addTools("Evolución mensual", [], [
        ["grafico", { ids: ["indec.ipc_nivel_general", "indec.ipc_nucleo", "indec.ipc_regulados"], desde: from24, transformacion: "variacion_mensual", titulo: "Inflación mensual: general, núcleo y regulados (%)" }],
        ["calcular", { id: "indec.ipc_nivel_general", operacion: "mes_a_mes", desde: from24 }],
      ]);
      await addTools("Alertas estadísticas", ["Señales sobre la variación mensual del IPC general, con su criterio."], [["anomalias", { ids: ["indec.ipc_nivel_general"], desde: "2017-01" }]]);
      break;
    }
    case "monetario": {
      await addKpis("Agregados monetarios: últimos datos", ["bcra.base_monetaria", "bcra.m2", "bcra.m2_privado_yoy"], () => ["Los datos diarios se comparan contra 30 días antes; los mensuales, contra el mes anterior y el mismo mes del año previo."]);
      await addTools("Variación real", ["Base monetaria y M2 deflactados por el IPC (pesos constantes del último mes con IPC)."], [
        ["comparar", { ids: ["bcra.base_monetaria", "bcra.m2"], desde: from24, transformacion: "real_variacion_interanual" }],
        ["comparar", { ids: ["bcra.base_monetaria", "indec.ipc_nivel_general"], desde: from24, transformacion: "base100" }],
      ]);
      break;
    }
    case "cambiario": {
      await addKpis("Tipo de cambio: últimos datos", ["bcra.tc_mayorista", "bcra.tc_minorista", "bcra.banda_superior", "bcra.banda_inferior"], (k) => {
        const fx = k.facts.get("bcra.tc_mayorista");
        const hi = k.facts.get("bcra.banda_superior");
        const lo = k.facts.get("bcra.banda_inferior");
        return fx && hi && lo ? [`El mayorista cotizó $ ${fmt(fx.v, 2)} al ${fx.label}, ${fmt(((fx.v - lo.v) / (hi.v - lo.v)) * 100, 0)} % del recorrido entre la banda inferior ($ ${fmt(lo.v, 2)}) y la superior ($ ${fmt(hi.v, 2)}).`] : [];
      });
      await addTools("Devaluación vs. inflación", ["Variación mensual del promedio del tipo de cambio mayorista contra la inflación mensual."], [
        ["comparar", { ids: ["bcra.tc_mayorista", "indec.ipc_nivel_general"], desde: from24, transformacion: "variacion_mensual" }],
        ["grafico", { ids: ["bcra.tc_mayorista"], desde: from24, transformacion: "real", titulo: "Tipo de cambio mayorista real (deflactado por IPC; no incluye inflación externa)" }],
      ]);
      break;
    }
    case "reservas": {
      await addKpis("Reservas: último dato", ["bcra.reservas"], (k) => {
        const r = k.facts.get("bcra.reservas");
        return r ? [`Reservas brutas: US$ ${fmt(r.v, 0)} millones al ${r.label}; ${signed(r.ch30, "%", 2)} en 30 días.`] : [];
      });
      await addTools("Evolución y variaciones mensuales", ["Cierre de cada mes (último dato hábil)."], [
        ["calcular", { id: "bcra.reservas", operacion: "mes_a_mes", desde: from24 }],
        ["grafico", { ids: ["bcra.reservas"], desde: from24, transformacion: "nivel", titulo: "Reservas internacionales (millones de US$)" }],
      ]);
      await addTools("Alertas estadísticas", [], [["anomalias", { ids: ["bcra.reservas"], desde: "2016-01" }]]);
      break;
    }
    case "actividad": {
      await addKpis("Actividad: últimos datos", ["indec.emae_desest", "calc.emae_desest_var_mensual", "calc.emae_var_interanual", "indec.ipi_manufacturero_desest", "indec.isac_desest"], (k) => {
        const e = k.facts.get("calc.emae_desest_var_mensual");
        const y = k.facts.get("calc.emae_var_interanual");
        return [...(e ? [`El EMAE desestacionalizado varió ${signed(e.v, "%", 1)} en ${e.label} respecto del mes anterior.`] : []), ...(y ? [`La variación interanual del EMAE (serie original) fue ${signed(y.v, "%", 1)}.`] : [])];
      });
      await addTools("Evolución", [], [["grafico", { ids: ["indec.emae_desest", "indec.ipi_manufacturero_desest", "indec.isac_desest"], desde: from24, transformacion: "base100", titulo: "Actividad, industria y construcción (desest., base 100)" }]]);
      break;
    }
    case "salarios": {
      await addKpis("Salarios: últimos datos", ["calc.salarios_reales", "calc.salarios_reales_var_interanual", "calc.salarios_var_interanual", "calc.ipc_var_interanual"], (k) => {
        const r = k.facts.get("calc.salarios_reales_var_interanual");
        const n = k.facts.get("calc.salarios_var_interanual");
        const p = k.facts.get("calc.ipc_var_interanual");
        return [...(r ? [`El salario real varió ${signed(r.v, "%", 1)} interanual en ${r.label}.`] : []), ...(n && p ? [`Salario nominal ${signed(n.v, "%", 1)} interanual vs. inflación ${fmt(p.v, 1)} % (${p.label}).`] : [])];
      });
      await addTools("Evolución", [], [
        ["grafico", { ids: ["calc.salarios_reales"], desde: "2017-01", transformacion: "nivel", titulo: "Salario real (índice dic-2016 = 100)" }],
        ["calcular", { id: "calc.salarios_reales", operacion: "mes_a_mes", desde: from24 }],
      ]);
      break;
    }
    case "mensual": {
      await addKpis("Resumen del mes", ["calc.ipc_var_mensual", "calc.ipc_var_interanual", "calc.emae_desest_var_mensual", "calc.salarios_reales_var_interanual", "bcra.tc_mayorista", "bcra.reservas", "bcra.base_monetaria", "bcra.badlar"], () => [
        "Cada indicador muestra su último dato con su fecha: las series mensuales del INDEC se publican con rezago, las diarias del BCRA están al día.",
      ]);
      await addTools("Precios y dinero", [], [["comparar", { ids: ["indec.ipc_nivel_general", "bcra.tc_mayorista", "bcra.base_monetaria"], desde: yearsAgo(today, 1), transformacion: "variacion_mensual" }]]);
      await addTools("Actividad y salarios", [], [["grafico", { ids: ["indec.emae_desest", "calc.salarios_reales"], desde: from24, transformacion: "base100", titulo: "Actividad y salario real (base 100)" }]]);
      break;
    }
    case "personalizado": {
      const ids = (opts.ids ?? []).slice(0, 6);
      if (!ids.length) throw new Error("Elegí al menos una serie para el informe personalizado");
      await addKpis("Últimos datos", ids, () => []);
      await addTools("Evolución", [], [["grafico", { ids, desde: from24 }], ...ids.slice(0, 3).map((id) => ["calcular", { id, operacion: "mes_a_mes", desde: from24 }] as [string, Record<string, unknown>])]);
      await addTools("Alertas estadísticas", [], [["anomalias", { ids: ids.slice(0, 4) }]]);
      break;
    }
  }
  return {
    kind,
    title: REPORT_LABEL[kind].title,
    generatedAt: new Date().toISOString(),
    coverage,
    sections,
    sources: dedupe(sources),
    methodology: [...new Set(methodology)],
    warnings: [...new Set(warnings)],
  };
}
