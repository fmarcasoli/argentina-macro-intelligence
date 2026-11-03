import type { Frequency } from "../connectors/types";
import { formatPeriod } from "../normalize/dates";
import { defaultAggregation, FREQ_NAME, FREQ_RANK, lowestCommonFrequency, resample } from "./frequency";
import { findGaps, type GapReport } from "./gaps";
import { applyTransform } from "./transform";
import type { Aggregation, Notice, Pt, SeriesData, SeriesMeta, TargetFrequency, Transform } from "./types";
import { isNominalPesos } from "./units";
import { canShareAxis, methodologyWarnings } from "./warnings";

export interface AnalysisSpec {
  ids: string[];
  from?: string;
  to?: string;
  frequency: TargetFrequency;
  /** null = la agregación por defecto de cada serie. */
  aggregation: Aggregation | null;
  transform: Transform;
  /** Para índice base 100: fecha base (por defecto, el inicio del período). */
  baseDate?: string;
  layout: "auto" | "overlay" | "panels";
}

export interface AnalysisSeries {
  meta: SeriesMeta;
  points: Pt[];
  unit: string;
  aggregation: Aggregation | null;
  gaps: GapReport;
}

export interface AnalysisResult {
  frequency: Frequency;
  series: AnalysisSeries[];
  overlay: boolean;
  notices: Notice[];
  /** Filas fecha × serie, para tabla y exportación. */
  rows: { d: string; values: (number | null)[] }[];
}

export const DEFAULT_SPEC: AnalysisSpec = {
  ids: [],
  frequency: "auto",
  aggregation: null,
  transform: "level",
  layout: "auto",
};

/**
 * Ejecuta un análisis: frecuencia común → recorte del período → transformación
 * → validaciones. Es una función pura (cliente y servidor), cubierta por tests.
 */
export function runAnalysis(data: SeriesData[], spec: AnalysisSpec, ipcMonthly?: Pt[]): AnalysisResult {
  const notices: Notice[] = [];
  const metas = data.map((s) => s.meta);
  const natural = lowestCommonFrequency(metas.map((m) => m.frequency));
  let target: Frequency = spec.frequency === "auto" ? natural : spec.frequency;
  if (FREQ_RANK[target] < FREQ_RANK[natural]) {
    notices.push({
      level: "warning",
      message: `No se puede mostrar a frecuencia ${FREQ_NAME[target]} una serie ${FREQ_NAME[natural]} sin inventar datos: se usa frecuencia ${FREQ_NAME[natural]}.`,
    });
    target = natural;
  }

  notices.push(...methodologyWarnings(metas, spec.transform, target));

  const out: AnalysisSeries[] = [];
  for (const s of data) {
    const m = s.meta;
    // 1. Frecuencia
    const agg = m.frequency === target ? null : (spec.aggregation ?? defaultAggregation(m.unit, m.name));
    let pts = s.points;
    if (agg) {
      const r = resample(pts, m.frequency, target, agg);
      pts = r.points;
      if (r.incomplete.length) {
        notices.push({
          level: "info",
          seriesId: m.id,
          message: `${m.name}: ${r.incomplete.length} período(s) incompleto(s) excluido(s) al agregar (${r.incomplete
            .slice(-3)
            .map((d) => formatPeriod(d, target))
            .join(", ")}${r.incomplete.length > 3 ? "…" : ""}).`,
        });
      }
    }
    // 2. Transformación (sobre la serie completa, para que las variaciones del
    //    inicio del período tengan su base) y luego recorte.
    let unit = m.unit;
    if (spec.transform === "real" && !isNominalPesos(m.unit, m.name)) {
      notices.push({
        level: "warning",
        seriesId: m.id,
        message: `${m.name}: no está en pesos corrientes (${m.unit}); se muestra sin deflactar.`,
      });
    } else if (spec.transform === "index100") {
      // Con mes base elegido, la base puede estar fuera del período visible
      // (se calcula sobre la serie completa); si no, base = inicio del período.
      const source = spec.baseDate ? pts : pts.filter((p) => (!spec.from || p.d >= spec.from) && (!spec.to || p.d <= spec.to));
      const r = applyTransform(source, target, "index100", { baseDate: spec.baseDate });
      if (spec.baseDate && r.reference && r.reference.slice(0, 7) !== spec.baseDate.slice(0, 7)) {
        notices.push({
          level: "info",
          seriesId: m.id,
          message: `${m.name}: no hay dato en ${spec.baseDate.slice(0, 7)}; la base 100 es el primer dato posterior (${formatPeriod(r.reference, target)}).`,
        });
      }
      pts = r.points;
      unit = r.reference ? `Índice ${formatPeriod(r.reference, target)} = 100` : "Índice base 100";
    } else if (spec.transform !== "level") {
      if (spec.transform === "real" && !ipcMonthly?.length) {
        notices.push({ level: "warning", message: "No hay datos de IPC para deflactar." });
      } else {
        const r = applyTransform(pts, target, spec.transform, { ipcMonthly });
        pts = r.points;
        if (spec.transform === "real") {
          unit = `${m.unit} — pesos constantes de ${r.reference ? formatPeriod(r.reference, "M") : "—"}`;
          if (r.dropped) {
            notices.push({
              level: "info",
              seriesId: m.id,
              message: `${m.name}: ${r.dropped} dato(s) posteriores al último IPC publicado no se pueden deflactar.`,
            });
          }
        } else {
          unit = "%";
        }
      }
    }
    pts = pts.filter((p) => (!spec.from || p.d >= spec.from) && (!spec.to || p.d <= spec.to));
    out.push({ meta: m, points: pts, unit, aggregation: agg, gaps: findGaps(pts, target) });
  }

  for (const s of out) {
    const g = s.gaps;
    const parts: string[] = [];
    if (g.missingPeriods.length) parts.push(`${g.missingPeriods.length} período(s) sin dato`);
    if (g.dailyGaps.length) parts.push(`${g.dailyGaps.length} interrupción(es) de más de 7 días`);
    if (g.nullValues.length) parts.push(`${g.nullValues.length} valor(es) no publicados`);
    if (parts.length) {
      notices.push({
        level: "warning",
        seriesId: s.meta.id,
        message: `${s.meta.name}: ${parts.join(", ")} en el período. No se completan ni se interpolan.`,
      });
    }
    if (s.points.length === 0) {
      notices.push({ level: "warning", seriesId: s.meta.id, message: `${s.meta.name}: sin datos en el período elegido.` });
    }
  }

  // Ejes: superponer solo si las unidades resultantes son compatibles.
  const shareable = canShareAxis(
    out.map((s) => ({ ...s.meta, unit: s.unit })),
    spec.transform,
  );
  let overlay = spec.layout === "overlay" || (spec.layout === "auto" && shareable.ok);
  if (overlay && !shareable.ok) {
    overlay = false;
    notices.push({
      level: "warning",
      message: `No se superponen en un mismo eje: ${shareable.reason}. Se muestran en paneles con escalas independientes; para compararlas usá índice base 100 o variaciones.`,
    });
  }

  // Tabla combinada
  const dates = new Set<string>();
  out.forEach((s) => s.points.forEach((p) => dates.add(p.d)));
  const maps = out.map((s) => new Map(s.points.map((p) => [p.d, p.v])));
  const rows = [...dates].sort().map((d) => ({ d, values: maps.map((m) => (m.has(d) ? (m.get(d) ?? null) : null)) }));

  return { frequency: target, series: out, overlay, notices: dedupe(notices), rows };
}

function dedupe(n: Notice[]): Notice[] {
  const seen = new Set<string>();
  return n.filter((x) => (seen.has(x.message) ? false : (seen.add(x.message), true)));
}

/** Codifica un análisis en parámetros de URL (para compartir y guardar). */
export function specToSearchParams(spec: AnalysisSpec): URLSearchParams {
  const p = new URLSearchParams();
  if (spec.ids.length) p.set("s", spec.ids.join(","));
  if (spec.from) p.set("from", spec.from);
  if (spec.to) p.set("to", spec.to);
  if (spec.frequency !== "auto") p.set("f", spec.frequency);
  if (spec.aggregation) p.set("agg", spec.aggregation);
  if (spec.transform !== "level") p.set("t", spec.transform);
  if (spec.baseDate) p.set("base", spec.baseDate);
  if (spec.layout !== "auto") p.set("layout", spec.layout);
  return p;
}

const FREQS = ["D", "W", "M", "Q", "S", "A"];
const TRANSFORMS = ["level", "pct_prev", "pct_yoy", "index100", "real"];
const AGGS = ["avg", "last", "sum"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function specFromSearchParams(p: { get(name: string): string | null }): AnalysisSpec {
  const ids = (p.get("s") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^[\w.\-]{1,120}$/.test(x))
    .slice(0, 8);
  const f = p.get("f");
  const t = p.get("t");
  const agg = p.get("agg");
  const from = p.get("from");
  const to = p.get("to");
  const base = p.get("base");
  const layout = p.get("layout");
  return {
    ids: [...new Set(ids)],
    from: from && ISO.test(from) ? from : undefined,
    to: to && ISO.test(to) ? to : undefined,
    frequency: f && FREQS.includes(f) ? (f as Frequency) : "auto",
    aggregation: agg && AGGS.includes(agg) ? (agg as Aggregation) : null,
    transform: t && TRANSFORMS.includes(t) ? (t as Transform) : "level",
    baseDate: base && ISO.test(base) ? base : undefined,
    layout: layout === "overlay" || layout === "panels" ? layout : "auto",
  };
}
