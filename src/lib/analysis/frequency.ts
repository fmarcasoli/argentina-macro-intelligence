import type { Frequency } from "../connectors/types";
import { alignToPeriodStart, parseIsoDate, shiftPeriods, toIsoDate } from "../normalize/dates";
import type { Aggregation, Pt } from "./types";

/** Orden de frecuencias de mayor a menor granularidad. */
export const FREQ_RANK: Record<Frequency, number> = { D: 0, W: 1, M: 2, Q: 3, S: 4, A: 5 };

export const FREQ_NAME: Record<Frequency, string> = {
  D: "diaria",
  W: "semanal",
  M: "mensual",
  Q: "trimestral",
  S: "semestral",
  A: "anual",
};

/** La frecuencia común más baja (menos granular) de un conjunto de series. */
export function lowestCommonFrequency(freqs: Frequency[]): Frequency {
  return freqs.reduce((acc, f) => (FREQ_RANK[f] > FREQ_RANK[acc] ? f : acc), freqs[0] ?? "M");
}

export function periodKey(iso: string, freq: Frequency): string {
  const d = parseIsoDate(iso);
  if (!d) throw new Error(`Fecha inválida: ${iso}`);
  return toIsoDate(alignToPeriodStart(d, freq));
}

/** Último día del período que empieza en `periodStart`. */
export function periodEnd(periodStart: string, freq: Frequency): string {
  const d = parseIsoDate(periodStart)!;
  const next = shiftPeriods(d, freq, 1);
  return toIsoDate(new Date(next.getTime() - 86_400_000));
}

/** Cantidad de observaciones esperadas al llevar `from` a `to` (null si no es fija, p.ej. diaria). */
function expectedCount(from: Frequency, to: Frequency): number | null {
  const months: Record<Frequency, number> = { D: 0, W: 0, M: 1, Q: 3, S: 6, A: 12 };
  if (from === "D" || from === "W") return null;
  return months[to] / months[from];
}

export interface ResampleResult {
  points: Pt[];
  /** Períodos descartados por estar incompletos (no se estiman valores faltantes). */
  incomplete: string[];
}

/**
 * Agrega una serie a una frecuencia menor (p.ej. diaria → mensual).
 * Nunca desagrega ni interpola. Un período se descarta si está incompleto:
 *   - desde mensual/trimestral: faltan observaciones del período;
 *   - desde diaria: no hay datos en los últimos 7 días del período (o en los
 *     primeros 7, para el primer período), típico del mes en curso.
 * Los valores nulos no se cuentan: un período con todos nulos da null.
 */
export function resample(points: Pt[], from: Frequency, to: Frequency, agg: Aggregation): ResampleResult {
  if (FREQ_RANK[to] < FREQ_RANK[from]) {
    throw new Error(`No se puede pasar de frecuencia ${FREQ_NAME[from]} a ${FREQ_NAME[to]} sin inventar datos`);
  }
  if (to === from) return { points, incomplete: [] };

  const groups = new Map<string, Pt[]>();
  for (const p of points) {
    const k = periodKey(p.d, to);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const expected = expectedCount(from, to);
  const keys = [...groups.keys()].sort();
  const out: Pt[] = [];
  const incomplete: string[] = [];
  keys.forEach((k, i) => {
    const g = groups.get(k)!.sort((a, b) => (a.d < b.d ? -1 : 1));
    let complete: boolean;
    if (expected !== null) {
      complete = g.length >= expected;
    } else {
      const endOk = g[g.length - 1].d >= addDaysIso(periodEnd(k, to), -7);
      const startOk = i > 0 || g[0].d <= addDaysIso(k, 7);
      complete = endOk && startOk;
    }
    if (!complete) {
      incomplete.push(k);
      return;
    }
    const vals = g.map((p) => p.v).filter((v): v is number => v !== null);
    let v: number | null = null;
    if (vals.length) {
      if (agg === "avg") v = vals.reduce((a, b) => a + b, 0) / vals.length;
      else if (agg === "sum") v = vals.reduce((a, b) => a + b, 0);
      else v = [...g].reverse().find((p) => p.v !== null)!.v;
    }
    out.push({ d: k, v: v === null ? null : Number(v.toPrecision(12)) });
  });
  return { points: out, incomplete };
}

function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso)!;
  return toIsoDate(new Date(d.getTime() + days * 86_400_000));
}

/**
 * Agregación por defecto según el tipo de variable:
 *   - tasas, porcentajes, tipos de cambio e índices → promedio;
 *   - flujos (exportaciones, ventas, efectos monetarios, viajeros) → suma;
 *   - stocks (reservas, base monetaria, depósitos, préstamos) → último dato.
 */
export function defaultAggregation(unit: string, name: string): Aggregation {
  const u = `${unit} ${name}`;
  if (/%|porcentaje|\btasa\b|\bTNA\b|tipo de cambio|por d[oó]lar|[ií]ndice|\bCER\b|\bUVA\b|\bUVI\b|coeficiente/i.test(u)) return "avg";
  if (/exportaci|importaci|saldo comercial|ventas|efecto monetario|variaci[oó]n de reservas|compras netas|pernoctac|viajeros|flujo/i.test(u)) return "sum";
  return "last";
}
