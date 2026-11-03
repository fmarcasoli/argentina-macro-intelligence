import type { Frequency } from "../connectors/types";
import { parseIsoDate, shiftPeriods, toIsoDate } from "../normalize/dates";
import { defaultAggregation, resample } from "./frequency";
import type { Aggregation, Pt } from "./types";
import { unitFamily } from "./units";

/**
 * Datos período a período (mes a mes, trimestre a trimestre…), como los
 * publican los informes del INDEC: cada período con su valor y sus
 * variaciones. Nunca se completan períodos faltantes: si falta el período de
 * comparación, la variación queda vacía.
 */

export interface BreakdownRow {
  d: string;
  value: number | null;
  /** Variación contra el período anterior: % (niveles) o p.p. (tasas). */
  prev: number | null;
  /** Variación contra el mismo período del año anterior. */
  yoy: number | null;
  /** Acumulada en el año (contra diciembre/último período del año anterior). Solo niveles. */
  ytd: number | null;
}

export interface Breakdown {
  /** Frecuencia de las filas (diaria y semanal se agregan a mensual). */
  frequency: Frequency;
  /** "rate": la serie ya es una tasa o porcentaje (variaciones en p.p.). "level": índice o nivel (variaciones en %). */
  kind: "rate" | "level";
  /** Agregación usada si la serie original era diaria o semanal. */
  aggregation: Aggregation | null;
  rows: BreakdownRow[];
  /** Filas agrupadas por año, del más reciente al más antiguo. */
  years: { year: string; rows: BreakdownRow[] }[];
}

const PER_YEAR: Partial<Record<Frequency, number>> = { M: 12, Q: 4, S: 2, A: 1 };

export function periodBreakdown(points: Pt[], frequency: Frequency, unit: string, name = ""): Breakdown {
  let freq = frequency;
  let pts = points;
  let aggregation: Aggregation | null = null;
  if (freq === "D" || freq === "W") {
    aggregation = defaultAggregation(unit, name);
    pts = resample(points, freq, "M", aggregation).points;
    freq = "M";
  }
  const kind = unitFamily(unit, name) === "percent" ? "rate" : "level";
  const by = new Map(pts.map((p) => [p.d, p.v]));
  const at = (d: string, n: number) => by.get(toIsoDate(shiftPeriods(parseIsoDate(d)!, freq, n)));
  const change = (a: number | null, b: number | null | undefined) => {
    if (a === null || b === null || b === undefined) return null;
    if (kind === "rate") return a - b;
    return b === 0 ? null : (a / b - 1) * 100;
  };
  const perYear = PER_YEAR[freq] ?? 1;
  const rows: BreakdownRow[] = pts.map((p) => {
    const date = parseIsoDate(p.d)!;
    let ytd: number | null = null;
    if (kind === "level" && perYear > 1) {
      // Base: último período del año anterior.
      const idxInYear = Math.round(date.getUTCMonth() / (12 / perYear));
      ytd = change(p.v, at(p.d, -(idxInYear + 1)));
    }
    return { d: p.d, value: p.v, prev: change(p.v, at(p.d, -1)), yoy: perYear > 1 ? change(p.v, at(p.d, -perYear)) : change(p.v, at(p.d, -1)), ytd };
  });
  rows.reverse();
  const years: Breakdown["years"] = [];
  for (const r of rows) {
    const y = r.d.slice(0, 4);
    if (years[years.length - 1]?.year !== y) years.push({ year: y, rows: [] });
    years[years.length - 1].rows.push(r);
  }
  return { frequency: freq, kind, aggregation, rows, years };
}

// ── Variación entre dos fechas ──────────────────────────────────────────────

export interface RangeRow {
  d: string;
  value: number | null;
  /** Variación individual del período: % (niveles o tasas compuestas) o p.p. (otras tasas). */
  change: number | null;
  /** Acumulada desde el comienzo del período elegido (base 0). */
  cumulative: number | null;
  /** Índice con base 100 en el mes elegido (solo niveles, si se pidió). */
  index: number | null;
}

export interface RangeChange {
  frequency: Frequency;
  mode: "level" | "compound" | "rate";
  from: string;
  to: string;
  /** Observación base (la del período anterior al inicio, en niveles). */
  base: { d: string; v: number } | null;
  periods: number;
  /** Variación acumulada total (% o p.p.). */
  accumulated: number | null;
  /** Promedio geométrico por período (%). */
  averagePerPeriod: number | null;
  /** Equivalente anual (%), si el período abarca al menos un período completo. */
  annualized: number | null;
  rows: RangeRow[];
  /** Períodos sin dato dentro del rango (no se completan). */
  missing: string[];
  /** Base 100 elegida: período y valor (null si no se pidió o no aplica). */
  base100: { d: string; v: number } | null;
}

export class RangeError extends Error {}

/** ¿La serie es una tasa de variación período a período (se puede componer)? */
export function isCompoundableRate(unit: string, name: string): boolean {
  return (
    unitFamily(unit, name) === "percent" &&
    /(variaci|inflaci|var\.)/i.test(name) &&
    /(mensual|trimestral|semestral)/i.test(name) &&
    !/(interanual|acumulad|anual\b|i\.a\.)/i.test(name)
  );
}

/**
 * Variación entre dos fechas, con base 0 al comienzo del período:
 *  - niveles e índices: acumulada = V(fin) / V(período anterior al inicio) − 1,
 *    así la acumulada incluye la variación del primer período elegido (igual
 *    que la inflación "de septiembre a enero" del INDEC);
 *  - tasas mensuales de variación (p. ej. inflación mensual): se componen
 *    Π(1 + r) − 1;
 *  - otras tasas (desocupación, tasas de interés): diferencia en p.p.
 * Series diarias o semanales se resumen por mes. No se completan faltantes.
 */
export function rangeChange(
  points: Pt[],
  frequency: Frequency,
  unit: string,
  name: string,
  from: string,
  to: string,
  opts: { base100?: string } = {},
): RangeChange {
  if (from > to) throw new RangeError("La fecha inicial debe ser anterior a la final");
  let freq = frequency;
  let pts = points.filter((p) => p.v !== null);
  if (freq === "D" || freq === "W") {
    pts = resample(points, freq, "M", defaultAggregation(unit, name)).points.filter((p) => p.v !== null);
    freq = "M";
  }
  const mode: RangeChange["mode"] = unitFamily(unit, name) !== "percent" ? "level" : isCompoundableRate(unit, name) ? "compound" : "rate";
  const align = (iso: string) => {
    const d = parseIsoDate(iso);
    if (!d) throw new RangeError(`Fecha inválida: ${iso}`);
    const months = { M: 1, Q: 3, S: 6, A: 12 }[freq as "M"] ?? 1;
    const m = Math.floor(d.getUTCMonth() / months) * months;
    return toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), m, 1)));
  };
  const f = align(from);
  const t = align(to);
  const by = new Map(pts.map((p) => [p.d, p.v as number]));
  const inRange: string[] = [];
  for (let d = f; d <= t; d = toIsoDate(shiftPeriods(parseIsoDate(d)!, freq, 1))) inRange.push(d);
  const missing = inRange.filter((d) => !by.has(d));
  const lastAvailable = pts.at(-1)?.d;
  if (lastAvailable && f > lastAvailable) throw new RangeError(`No hay datos desde ${f}: el último dato publicado es de ${lastAvailable}`);

  const rows: RangeRow[] = [];
  let base: RangeChange["base"] = null;
  let accumulated: number | null = null;
  if (mode === "level") {
    const bd = toIsoDate(shiftPeriods(parseIsoDate(f)!, freq, -1));
    const bv = by.get(bd);
    if (bv === undefined) throw new RangeError(`No hay dato del período anterior al inicio (${bd}) para usar como base`);
    base = { d: bd, v: bv };
    let prev: number | null = bv;
    for (const d of inRange) {
      const v = by.get(d) ?? null;
      rows.push({ d, value: v, change: v !== null && prev !== null && prev !== 0 ? (v / prev - 1) * 100 : null, cumulative: v !== null && bv !== 0 ? (v / bv - 1) * 100 : null, index: null });
      prev = v;
    }
  } else if (mode === "compound") {
    let acc = 1;
    let broken = false;
    for (const d of inRange) {
      const v = by.get(d) ?? null;
      if (v === null) broken = true;
      else acc *= 1 + v / 100;
      rows.push({ d, value: v, change: v, cumulative: broken ? null : (acc - 1) * 100, index: null });
    }
  } else {
    const bd = toIsoDate(shiftPeriods(parseIsoDate(f)!, freq, -1));
    const bv = by.get(bd) ?? by.get(f);
    if (bv === undefined) throw new RangeError("No hay dato al inicio del período");
    base = { d: by.has(bd) ? bd : f, v: bv };
    let prev: number | null = by.get(bd) ?? null;
    for (const d of inRange) {
      const v = by.get(d) ?? null;
      rows.push({ d, value: v, change: v !== null && prev !== null ? v - prev : null, cumulative: v !== null ? v - bv : null, index: null });
      prev = v;
    }
  }
  // Base 100 en el mes elegido (puede estar fuera del rango).
  let base100: RangeChange["base100"] = null;
  if (opts.base100 && mode === "level") {
    const bd = align(opts.base100);
    const bv = by.get(bd);
    if (bv === undefined || bv === 0) throw new RangeError(`No hay dato publicado en ${bd.slice(0, 7)} para usar como base 100`);
    base100 = { d: bd, v: bv };
    for (const r of rows) r.index = r.value === null ? null : (r.value / bv) * 100;
  }
  const lastRow = [...rows].reverse().find((r) => r.cumulative !== null);
  if (missing.length && mode !== "rate") {
    // Con faltantes, la acumulada solo vale hasta el último dato disponible.
    accumulated = lastRow?.cumulative ?? null;
  } else accumulated = rows.at(-1)?.cumulative ?? null;
  // Períodos transcurridos desde la base hasta el último dato usado (los huecos intermedios cuentan).
  const n = lastRow ? rows.indexOf(lastRow) + 1 : 0;
  const perYear = PER_YEAR[freq] ?? 1;
  const growth = mode !== "rate" && accumulated !== null ? 1 + accumulated / 100 : null;
  return {
    frequency: freq,
    mode,
    from: f,
    to: lastRow?.d ?? t,
    base,
    periods: n,
    accumulated,
    averagePerPeriod: growth !== null && n > 0 && growth > 0 ? (Math.pow(growth, 1 / n) - 1) * 100 : null,
    annualized: growth !== null && n > 0 && growth > 0 ? (Math.pow(growth, perYear / n) - 1) * 100 : null,
    rows,
    missing,
    base100,
  };
}
