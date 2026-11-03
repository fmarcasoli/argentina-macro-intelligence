import type { Frequency } from "../connectors/types";
import { parseIsoDate, shiftPeriods, toIsoDate } from "../normalize/dates";
import type { Pt } from "./types";

export interface GapReport {
  /** Períodos sin observación entre el primer y el último dato (frecuencias M/Q/S/A/W). */
  missingPeriods: string[];
  /** Huecos de más de 7 días corridos en series diarias (las diarias no informan fines de semana ni feriados). */
  dailyGaps: { from: string; to: string; days: number }[];
  /** Observaciones presentes pero sin valor publicado. */
  nullValues: string[];
}

/**
 * Detecta períodos faltantes. No completa ni interpola: solo informa.
 */
export function findGaps(points: Pt[], freq: Frequency): GapReport {
  const report: GapReport = { missingPeriods: [], dailyGaps: [], nullValues: [] };
  if (points.length === 0) return report;
  report.nullValues = points.filter((p) => p.v === null).map((p) => p.d);

  if (freq === "D") {
    for (let i = 1; i < points.length; i++) {
      const a = parseIsoDate(points[i - 1].d)!.getTime();
      const b = parseIsoDate(points[i].d)!.getTime();
      const days = Math.round((b - a) / 86_400_000);
      if (days > 7) report.dailyGaps.push({ from: points[i - 1].d, to: points[i].d, days });
    }
    return report;
  }

  const have = new Set(points.map((p) => p.d));
  let cur = parseIsoDate(points[0].d)!;
  const last = points[points.length - 1].d;
  for (let guard = 0; guard < 20000; guard++) {
    const k = toIsoDate(cur);
    if (k > last) break;
    if (!have.has(k)) report.missingPeriods.push(k);
    cur = shiftPeriods(cur, freq, 1);
  }
  return report;
}

export function gapCount(r: GapReport): number {
  return r.missingPeriods.length + r.dailyGaps.length + r.nullValues.length;
}
