import type { Frequency } from "../connectors/types";
import { parseIsoDate, shiftPeriods, toIsoDate } from "./dates";

export interface Point {
  refDate: string;
  value: number | null;
}

/**
 * Definición de una serie calculada. Se guarda en indicators.derivation (jsonb)
 * para que cualquier dato calculado sea reproducible y trazable.
 */
export type Derivation =
  | { op: "pct_change"; base: string; lag: number; label?: string }
  | { op: "ratio"; numerator: string; denominator: string; scale?: number };

/**
 * Variación porcentual contra `lag` períodos atrás, emparejando por fecha de
 * período (no por posición): si falta el período base, el resultado es
 * null — nunca se rellena ni se interpola.
 */
export function pctChange(points: Point[], freq: Frequency, lag: number): Point[] {
  const byDate = new Map(points.map((p) => [p.refDate, p.value]));
  const out: Point[] = [];
  for (const p of points) {
    const d = parseIsoDate(p.refDate);
    if (!d) continue;
    const baseKey = toIsoDate(shiftPeriods(d, freq, -lag));
    if (!byDate.has(baseKey)) continue; // no hay período base: no se emite el punto
    const base = byDate.get(baseKey);
    const value =
      p.value === null || base === null || base === undefined || base === 0
        ? null
        : round((p.value / base - 1) * 100);
    out.push({ refDate: p.refDate, value });
  }
  return out;
}

/** Cociente entre dos series alineadas por fecha (solo fechas presentes en ambas). */
export function ratio(num: Point[], den: Point[], scale = 1): Point[] {
  const d = new Map(den.map((p) => [p.refDate, p.value]));
  const out: Point[] = [];
  for (const p of num) {
    if (!d.has(p.refDate)) continue;
    const q = d.get(p.refDate);
    out.push({
      refDate: p.refDate,
      value: p.value === null || q === null || q === undefined || q === 0 ? null : round((p.value / q) * scale),
    });
  }
  return out;
}

function round(v: number): number {
  return Number(v.toPrecision(12));
}
