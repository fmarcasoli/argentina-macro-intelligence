import type { Frequency } from "../connectors/types";
import { defaultAggregation, FREQ_NAME, FREQ_RANK, lowestCommonFrequency, periodKey, resample } from "../analysis/frequency";
import { deflateToConstant, index100, pctYoY } from "../analysis/transform";
import type { Aggregation, Pt, SeriesData } from "../analysis/types";
import { parseIsoDate, shiftPeriods, toIsoDate } from "../normalize/dates";
import { DecomposeError, seasonalDecompose } from "./decompose";

/**
 * Transformaciones económicas reproducibles.
 *
 * Una transformación es una "receta": una lista ordenada de pasos con sus
 * parámetros. La receta se guarda junto al resultado y se describe en texto,
 * de modo que cualquier resultado puede rehacerse exactamente con los mismos
 * datos de origen.
 */

export type TransformStep =
  | { op: "log" }
  | { op: "diff"; lag?: number }
  | { op: "logdiff"; lag?: number }
  | { op: "pct"; lag?: number }
  | { op: "yoy" }
  | { op: "index100"; base?: string }
  | { op: "deflate" }
  | { op: "sa"; model?: "additive" | "multiplicative" }
  | { op: "scale"; factor: number; unit: string }
  | { op: "fx"; direction: "to_usd" | "to_ars" };

export interface TransformContext {
  freq: Frequency;
  unit: string;
  /** IPC mensual (nivel general), requerido por "deflate". */
  ipcMonthly?: Pt[];
  /** Tipo de cambio ($ por US$), en la misma frecuencia o diaria; requerido por "fx". */
  fx?: { points: Pt[]; freq: Frequency; name: string };
}

export interface TransformOutput {
  points: Pt[];
  unit: string;
  /** Descripción legible de cada paso aplicado (en orden). */
  log: string[];
  notes: string[];
}

export class TransformError extends Error {}

export const STEP_LABEL: Record<TransformStep["op"], string> = {
  log: "Logaritmo natural",
  diff: "Diferencia",
  logdiff: "Diferencia logarítmica (×100)",
  pct: "Variación %",
  yoy: "Variación % interanual",
  index100: "Índice base 100",
  deflate: "Deflactación por IPC",
  sa: "Desestacionalización (descomposición clásica)",
  scale: "Conversión de unidades (escala)",
  fx: "Conversión de moneda",
};

/** Valor `lag` períodos antes. Mensual o menor: por calendario; diaria/semanal: por posición. */
function lagged(points: Pt[], freq: Frequency, lag: number): (number | null | undefined)[] {
  if (freq === "D" || freq === "W") return points.map((_, i) => (i - lag >= 0 ? points[i - lag].v : undefined));
  const by = new Map(points.map((p) => [p.d, p.v]));
  return points.map((p) => by.get(toIsoDate(shiftPeriods(parseIsoDate(p.d)!, freq, -lag))));
}

function binaryLag(points: Pt[], freq: Frequency, lag: number, f: (cur: number, prev: number) => number | null): Pt[] {
  const prev = lagged(points, freq, lag);
  const out: Pt[] = [];
  points.forEach((p, i) => {
    const b = prev[i];
    if (b === undefined) return;
    out.push({ d: p.d, v: p.v === null || b === null ? null : f(p.v, b) });
  });
  return out;
}

const SEASONAL_PERIOD: Partial<Record<Frequency, number>> = { M: 12, Q: 4, S: 2 };

export function applyStep(points: Pt[], step: TransformStep, ctx: TransformContext): { points: Pt[]; unit: string; text: string; notes: string[] } {
  const notes: string[] = [];
  const lag = "lag" in step && step.lag ? step.lag : 1;
  if (!Number.isInteger(lag) || lag < 1) throw new TransformError("El rezago debe ser un entero ≥ 1");
  switch (step.op) {
    case "log": {
      const bad = points.filter((p) => p.v !== null && p.v <= 0).length;
      if (bad) notes.push(`${bad} observación(es) ≤ 0 quedan sin valor: el logaritmo no está definido.`);
      return {
        points: points.map((p) => ({ d: p.d, v: p.v === null || p.v <= 0 ? null : Math.log(p.v) })),
        unit: `ln(${ctx.unit})`,
        text: "y = ln(x)",
        notes,
      };
    }
    case "diff":
      return {
        points: binaryLag(points, ctx.freq, lag, (a, b) => a - b),
        unit: `Diferencia de ${ctx.unit}`,
        text: `y(t) = x(t) − x(t−${lag})`,
        notes,
      };
    case "logdiff":
      return {
        points: binaryLag(points, ctx.freq, lag, (a, b) => (a > 0 && b > 0 ? 100 * Math.log(a / b) : null)),
        unit: "Dif. logarítmica ×100 (≈ %)",
        text: `y(t) = 100 · [ln x(t) − ln x(t−${lag})]`,
        notes,
      };
    case "pct":
      return {
        points: binaryLag(points, ctx.freq, lag, (a, b) => (b === 0 ? null : (a / b - 1) * 100)),
        unit: "%",
        text: `y(t) = 100 · [x(t) / x(t−${lag}) − 1]`,
        notes,
      };
    case "yoy":
      if (ctx.freq === "A") throw new TransformError("Para series anuales usá la variación % contra el período anterior");
      return { points: pctYoY(points, ctx.freq), unit: "% interanual", text: "y(t) = 100 · [x(t) / x(t − 1 año) − 1]", notes };
    case "index100": {
      const r = index100(points, step.base);
      if (!r.base) throw new TransformError("No hay valores no nulos para la base");
      return { points: r.points, unit: `Índice ${r.base} = 100`, text: `y(t) = 100 · x(t) / x(${r.base})`, notes };
    }
    case "deflate": {
      if (!ctx.ipcMonthly?.length) throw new TransformError("La deflactación requiere el IPC");
      if (ctx.freq === "D" || ctx.freq === "W") {
        notes.push("Serie de frecuencia mayor a la mensual: cada observación se deflacta con el IPC de su mes.");
      }
      const r = deflateToConstant(points, ctx.freq, ctx.ipcMonthly);
      if (r.dropped) notes.push(`${r.dropped} observación(es) sin IPC publicado quedaron fuera.`);
      return {
        points: r.points,
        unit: `${ctx.unit} constantes de ${r.refMonth?.slice(0, 7)}`,
        text: `y(t) = x(t) · IPC(${r.refMonth?.slice(0, 7)}) / IPC(t)`,
        notes,
      };
    }
    case "sa": {
      const period = SEASONAL_PERIOD[ctx.freq];
      if (!period) throw new TransformError(`No corresponde desestacionalizar una serie ${FREQ_NAME[ctx.freq]}: no tiene un ciclo estacional fijo`);
      const model = step.model ?? "multiplicative";
      const obs = points.filter((p) => p.v !== null);
      // Exige períodos consecutivos.
      for (let i = 1; i < obs.length; i++) {
        if (toIsoDate(shiftPeriods(parseIsoDate(obs[i - 1].d)!, ctx.freq, 1)) !== obs[i].d) {
          throw new TransformError(`Hay un hueco en la serie (${obs[i - 1].d} → ${obs[i].d}): no se puede desestacionalizar sin inventar datos`);
        }
      }
      try {
        const dec = seasonalDecompose(obs.map((p) => p.v!), period, model);
        notes.push(
          "Desestacionalización por descomposición clásica (medias móviles centradas). No reemplaza al X-13ARIMA-SEATS del INDEC: si existe la serie desestacionalizada oficial, usá esa.",
        );
        if (dec.strength !== null && dec.strength < 0.3) {
          notes.push(`La estacionalidad estimada es débil (fuerza ${dec.strength.toFixed(2)}): el ajuste cambia poco la serie.`);
        }
        return {
          points: obs.map((p, i) => ({ d: p.d, v: dec.adjusted[i] })),
          unit: `${ctx.unit} (desest.)`,
          text: `y(t) = x(t) ${model === "additive" ? "−" : "/"} S(t), S estimado por medias móviles de ${period} períodos (${model === "additive" ? "aditivo" : "multiplicativo"})`,
          notes,
        };
      } catch (e) {
        if (e instanceof DecomposeError) throw new TransformError(e.message);
        throw e;
      }
    }
    case "scale": {
      if (!Number.isFinite(step.factor) || step.factor === 0) throw new TransformError("Factor de escala inválido");
      return {
        points: points.map((p) => ({ d: p.d, v: p.v === null ? null : p.v * step.factor })),
        unit: step.unit,
        text: `y = x × ${step.factor}`,
        notes,
      };
    }
    case "fx": {
      if (!ctx.fx) throw new TransformError("La conversión de moneda requiere una serie de tipo de cambio");
      const fx = ctx.fx;
      // Tipo de cambio en la frecuencia de la serie (promedio del período).
      const fxPts = FREQ_RANK[fx.freq] < FREQ_RANK[ctx.freq] ? resample(fx.points, fx.freq, ctx.freq, "avg").points : fx.points;
      if (FREQ_RANK[fx.freq] > FREQ_RANK[ctx.freq]) {
        throw new TransformError("El tipo de cambio tiene menor frecuencia que la serie: no se puede convertir sin inventar datos");
      }
      const byKey = new Map(fxPts.filter((p) => p.v !== null && p.v > 0).map((p) => [periodKey(p.d, ctx.freq === "D" ? "D" : ctx.freq), p.v!]));
      let dropped = 0;
      const out: Pt[] = [];
      for (const p of points) {
        const r = byKey.get(periodKey(p.d, ctx.freq === "D" ? "D" : ctx.freq));
        if (r === undefined) {
          dropped++;
          continue;
        }
        out.push({ d: p.d, v: p.v === null ? null : step.direction === "to_usd" ? p.v / r : p.v * r });
      }
      if (dropped) notes.push(`${dropped} observación(es) sin tipo de cambio en la misma fecha/período quedaron fuera.`);
      if (ctx.freq !== fx.freq) notes.push(`Se usa el promedio ${FREQ_NAME[ctx.freq]} de ${fx.name}.`);
      return {
        points: out,
        unit: step.direction === "to_usd" ? `${ctx.unit} → US$` : `${ctx.unit} → $`,
        text: step.direction === "to_usd" ? `y(t) = x(t) / TC(t) [${fx.name}]` : `y(t) = x(t) × TC(t) [${fx.name}]`,
        notes,
      };
    }
  }
}

/** Aplica una receta completa y devuelve el registro de cada paso. */
export function applyRecipe(points: Pt[], steps: TransformStep[], ctx: TransformContext): TransformOutput {
  let cur = points;
  let unit = ctx.unit;
  const log: string[] = [];
  const notes: string[] = [];
  for (const [i, step] of steps.entries()) {
    const r = applyStep(cur, step, { ...ctx, unit });
    cur = r.points;
    unit = r.unit;
    log.push(`${i + 1}. ${STEP_LABEL[step.op]}: ${r.text}`);
    notes.push(...r.notes);
  }
  return { points: cur, unit, log, notes };
}

export function describeRecipe(steps: TransformStep[]): string {
  if (!steps.length) return "Nivel (sin transformar)";
  return steps
    .map((s) => {
      const lag = "lag" in s && s.lag && s.lag > 1 ? ` (${s.lag})` : "";
      if (s.op === "sa") return `${STEP_LABEL.sa.split(" (")[0]} ${s.model === "additive" ? "aditiva" : "multiplicativa"}`;
      if (s.op === "fx") return s.direction === "to_usd" ? "En dólares" : "En pesos";
      if (s.op === "scale") return `× ${s.factor}`;
      return STEP_LABEL[s.op] + lag;
    })
    .join(" → ");
}

// ── Alineación temporal ──────────────────────────────────────────────────────

export interface AlignedData {
  frequency: Frequency;
  dates: string[];
  /** columns[j][t]: valor de la serie j en dates[t] (sin nulos: intersección). */
  columns: number[][];
  notes: string[];
}

/**
 * Lleva varias series a una frecuencia común (la menos granular, o la pedida)
 * y conserva solo las fechas en las que todas tienen dato (intersección).
 * Nunca interpola ni desagrega.
 */
export function alignSeries(
  series: { id: string; name: string; unit: string; freq: Frequency; points: Pt[] }[],
  opts: { frequency?: Frequency; aggregation?: Aggregation; from?: string; to?: string } = {},
): AlignedData {
  if (!series.length) throw new TransformError("No hay series para alinear");
  const natural = lowestCommonFrequency(series.map((s) => s.freq));
  let target = opts.frequency ?? natural;
  const notes: string[] = [];
  if (FREQ_RANK[target] < FREQ_RANK[natural]) {
    notes.push(`No se puede llevar a frecuencia ${FREQ_NAME[target]} sin inventar datos: se usa ${FREQ_NAME[natural]}.`);
    target = natural;
  }
  const maps = series.map((s) => {
    let pts = s.points;
    if (s.freq !== target) {
      const agg = opts.aggregation ?? defaultAggregation(s.unit, s.name);
      const r = resample(pts, s.freq, target, agg);
      pts = r.points;
      notes.push(`${s.name}: ${FREQ_NAME[s.freq]} → ${FREQ_NAME[target]} (${agg === "avg" ? "promedio" : agg === "sum" ? "suma" : "último dato"} del período).`);
    }
    return new Map(pts.filter((p) => p.v !== null && Number.isFinite(p.v)).map((p) => [p.d, p.v as number]));
  });
  let dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d)));
  if (opts.from) dates = dates.filter((d) => d >= opts.from!);
  if (opts.to) dates = dates.filter((d) => d <= opts.to!);
  dates.sort();
  const lost = maps.map((m, j) => ({ j, n: m.size - dates.length })).filter((x) => x.n > 0 && !opts.from && !opts.to);
  if (lost.length && series.length > 1) {
    notes.push(`Se usan solo los períodos con datos en todas las series (${dates.length} observaciones).`);
  }
  return { frequency: target, dates, columns: maps.map((m) => dates.map((d) => m.get(d)!)), notes };
}

/** Atajo: alinea a partir de SeriesData del motor de análisis. */
export const alignData = (data: SeriesData[], opts?: Parameters<typeof alignSeries>[1]) =>
  alignSeries(
    data.map((s) => ({ id: s.meta.id, name: s.meta.name, unit: s.meta.unit, freq: s.meta.frequency, points: s.points })),
    opts,
  );
