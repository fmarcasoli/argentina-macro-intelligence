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
  | { op: "ratio"; numerator: string; denominator: string; scale?: number }
  | { op: "ytd_change"; base: string }
  | { op: "deflate"; nominal: string; deflator: string; base: string };

/** IDs de las series de las que depende un cálculo (para ordenar y validar). */
export function derivationInputs(d: Derivation): string[] {
  switch (d.op) {
    case "pct_change":
    case "ytd_change":
      return [d.base];
    case "ratio":
      return [d.numerator, d.denominator];
    case "deflate":
      return [d.nominal, d.deflator];
  }
}

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

/**
 * Variación acumulada en el año: contra diciembre del año anterior. Solo para
 * series mensuales. Si falta el diciembre base, no se emite el punto.
 */
export function ytdChange(points: Point[]): Point[] {
  const byDate = new Map(points.map((p) => [p.refDate, p.value]));
  const out: Point[] = [];
  for (const p of points) {
    const year = Number(p.refDate.slice(0, 4));
    const baseKey = `${year - 1}-12-01`;
    if (!byDate.has(baseKey)) continue;
    const base = byDate.get(baseKey);
    out.push({
      refDate: p.refDate,
      value: p.value === null || base == null || base === 0 ? null : round((p.value / base - 1) * 100),
    });
  }
  return out;
}

/**
 * Deflacta una serie nominal por un índice de precios, con ambas llevadas a
 * 100 en el período base: (N_t / N_base) / (P_t / P_base) × 100.
 * Solo se emiten los períodos presentes en ambas series.
 */
export function deflate(nominal: Point[], deflator: Point[], baseDate: string): Point[] {
  const p = new Map(deflator.map((x) => [x.refDate, x.value]));
  const nBase = nominal.find((x) => x.refDate === baseDate)?.value;
  const pBase = p.get(baseDate);
  if (nBase == null || pBase == null || nBase === 0 || pBase === 0) {
    throw new Error(`No hay datos de ambas series en el período base ${baseDate}`);
  }
  const out: Point[] = [];
  for (const x of nominal) {
    if (!p.has(x.refDate)) continue;
    const q = p.get(x.refDate);
    out.push({
      refDate: x.refDate,
      value: x.value === null || q == null || q === 0 ? null : round(((x.value / nBase) / (q / pBase)) * 100),
    });
  }
  return out;
}

function round(v: number): number {
  return Number(v.toPrecision(12));
}
