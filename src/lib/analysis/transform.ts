import type { Frequency } from "../connectors/types";
import { parseIsoDate, PERIODS_PER_YEAR, shiftPeriods, toIsoDate } from "../normalize/dates";
import { periodKey, resample } from "./frequency";
import type { Pt, Transform } from "./types";

const r12 = (v: number) => Number(v.toPrecision(12));

/**
 * Variación porcentual contra el período anterior.
 * Mensual o menor: empareja por período (si falta el anterior, no hay punto).
 * Diaria/semanal: contra la observación anterior disponible (días hábiles).
 */
export function pctPrev(points: Pt[], freq: Frequency): Pt[] {
  if (freq === "D" || freq === "W") {
    const out: Pt[] = [];
    let prev: number | null | undefined;
    for (const p of points) {
      if (prev !== undefined) {
        out.push({ d: p.d, v: p.v === null || prev === null || prev === 0 ? null : r12((p.v / prev - 1) * 100) });
      }
      prev = p.v;
    }
    return out;
  }
  return pctLag(points, freq, 1);
}

function pctLag(points: Pt[], freq: Frequency, lag: number): Pt[] {
  const by = new Map(points.map((p) => [p.d, p.v]));
  const out: Pt[] = [];
  for (const p of points) {
    const key = toIsoDate(shiftPeriods(parseIsoDate(p.d)!, freq, -lag));
    if (!by.has(key)) continue;
    const b = by.get(key);
    out.push({ d: p.d, v: p.v === null || b == null || b === 0 ? null : r12((p.v / b - 1) * 100) });
  }
  return out;
}

/**
 * Variación interanual. Para series diarias se compara con la última
 * observación disponible en la semana previa a la misma fecha del año anterior.
 */
export function pctYoY(points: Pt[], freq: Frequency): Pt[] {
  if (freq !== "D") return pctLag(points, freq, PERIODS_PER_YEAR[freq as Exclude<Frequency, "D">]);
  const out: Pt[] = [];
  let j = 0;
  for (const p of points) {
    const d = parseIsoDate(p.d)!;
    const target = toIsoDate(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())));
    const floor = toIsoDate(new Date(parseIsoDate(target)!.getTime() - 7 * 86_400_000));
    while (j + 1 < points.length && points[j + 1].d <= target) j++;
    const b = points[j];
    if (!b || b.d > target || b.d < floor) continue;
    out.push({ d: p.d, v: p.v === null || b.v === null || b.v === 0 ? null : r12((p.v / b.v - 1) * 100) });
  }
  return out;
}

/** Índice base 100 en la primera observación no nula en o después de `baseDate`. */
export function index100(points: Pt[], baseDate?: string): { points: Pt[]; base: string | null } {
  const base = points.find((p) => p.v !== null && p.v !== 0 && (!baseDate || p.d >= baseDate));
  if (!base) return { points: [], base: null };
  return {
    base: base.d,
    points: points.map((p) => ({ d: p.d, v: p.v === null ? null : r12((p.v / base.v!) * 100) })),
  };
}

/**
 * Valores reales: expresa una serie en pesos constantes del último mes con IPC
 * publicado: V_real(t) = V(t) × IPC_ref / IPC(t).
 * Para series diarias se usa el IPC del mes; para trimestrales/anuales el
 * promedio del IPC del período. Los períodos sin IPC publicado quedan fuera.
 */
export function deflateToConstant(
  points: Pt[],
  freq: Frequency,
  ipcMonthly: Pt[],
): { points: Pt[]; refMonth: string | null; dropped: number } {
  const ipc = ipcMonthly.filter((p) => p.v !== null);
  if (!ipc.length) return { points: [], refMonth: null, dropped: points.length };
  const ref = ipc[ipc.length - 1];
  let byPeriod: Map<string, number>;
  let keyFreq: Frequency;
  if (freq === "D" || freq === "W" || freq === "M") {
    keyFreq = "M";
    byPeriod = new Map(ipc.map((p) => [p.d, p.v!]));
  } else {
    keyFreq = freq;
    byPeriod = new Map(
      resample(ipc, "M", freq, "avg").points.filter((p) => p.v !== null).map((p) => [p.d, p.v!]),
    );
  }
  const out: Pt[] = [];
  let dropped = 0;
  for (const p of points) {
    const q = byPeriod.get(periodKey(p.d, keyFreq));
    if (q === undefined) {
      dropped++;
      continue;
    }
    out.push({ d: p.d, v: p.v === null ? null : r12((p.v * ref.v!) / q) });
  }
  return { points: out, refMonth: ref.d, dropped };
}

export interface TransformResult {
  points: Pt[];
  /** Descripción de la base o referencia usada (para la unidad resultante). */
  reference: string | null;
  dropped: number;
}

export function applyTransform(
  points: Pt[],
  freq: Frequency,
  t: Transform,
  opts: { baseDate?: string; ipcMonthly?: Pt[] } = {},
): TransformResult {
  switch (t) {
    case "level":
      return { points, reference: null, dropped: 0 };
    case "pct_prev":
      return { points: pctPrev(points, freq), reference: null, dropped: 0 };
    case "pct_yoy":
      return { points: pctYoY(points, freq), reference: null, dropped: 0 };
    case "index100": {
      const r = index100(points, opts.baseDate);
      return { points: r.points, reference: r.base, dropped: 0 };
    }
    case "real": {
      if (!opts.ipcMonthly) throw new Error("Para valores reales hace falta el IPC");
      const r = deflateToConstant(points, freq, opts.ipcMonthly);
      return { points: r.points, reference: r.refMonth, dropped: r.dropped };
    }
  }
}
