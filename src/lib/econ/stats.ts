import type { Frequency } from "../connectors/types";
import { PERIODS_PER_YEAR } from "../normalize/dates";
import { index100, pctYoY } from "../analysis/transform";
import type { Pt } from "../analysis/types";

/**
 * Motor estadístico descriptivo. Todas las funciones reciben puntos {d, v}
 * ordenados por fecha; los nulos se excluyen explícitamente (nunca se cuentan
 * como cero) y se informa cuántos hubo.
 */

export class StatsError extends Error {}

/** Períodos por año para anualizar (diaria: días hábiles de mercado). */
export const ANNUAL_PERIODS: Record<Frequency, number> = { D: 252, ...PERIODS_PER_YEAR };

export const values = (pts: Pt[]) => pts.filter((p): p is { d: string; v: number } => p.v !== null && Number.isFinite(p.v));

export function mean(x: number[]): number {
  if (!x.length) return NaN;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

/** Varianza muestral (ddof=1 por defecto). */
export function variance(x: number[], ddof = 1): number {
  const n = x.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (n - ddof);
}

export const std = (x: number[], ddof = 1) => Math.sqrt(variance(x, ddof));

/** Percentil con interpolación lineal (método 7 de Hyndman-Fan, el de numpy/Excel). */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export const median = (x: number[]) => percentile([...x].sort((a, b) => a - b), 50);

/** Asimetría y curtosis (exceso), estimadores sesgados (momentos), como scipy por defecto. */
export function moments(x: number[]): { skewness: number; kurtosis: number } {
  const n = x.length;
  const m = mean(x);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of x) {
    const d = v - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  return { skewness: m3 / Math.pow(m2, 1.5), kurtosis: m4 / (m2 * m2) - 3 };
}

export interface ModeResult {
  /** "exact": valor(es) repetido(s); "interval": clase modal del histograma (datos continuos). */
  kind: "exact" | "interval" | "none";
  values: number[];
  count: number;
  interval?: [number, number];
}

/**
 * Moda. En series económicas continuas casi nunca hay valores repetidos: si
 * ningún valor se repite, se informa la clase modal de un histograma con
 * ancho de Freedman-Diaconis (y se aclara que es un intervalo).
 */
export function mode(x: number[]): ModeResult {
  if (!x.length) return { kind: "none", values: [], count: 0 };
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  const max = Math.max(...counts.values());
  if (max > 1) {
    const vals = [...counts.entries()].filter(([, c]) => c === max).map(([v]) => v).sort((a, b) => a - b);
    return { kind: "exact", values: vals, count: max };
  }
  const sorted = [...x].sort((a, b) => a - b);
  const iqr = percentile(sorted, 75) - percentile(sorted, 25);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (hi === lo) return { kind: "exact", values: [lo], count: x.length };
  let width = (2 * iqr) / Math.cbrt(x.length);
  if (!(width > 0)) width = (hi - lo) / Math.ceil(Math.log2(x.length) + 1);
  const bins = Math.min(200, Math.max(1, Math.ceil((hi - lo) / width)));
  width = (hi - lo) / bins;
  const hist = new Array<number>(bins).fill(0);
  for (const v of x) hist[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  const best = hist.indexOf(Math.max(...hist));
  const interval: [number, number] = [lo + best * width, lo + (best + 1) * width];
  return { kind: "interval", values: [(interval[0] + interval[1]) / 2], count: hist[best], interval };
}

export interface Extreme {
  d: string;
  v: number;
}

export interface Descriptive {
  n: number;
  nulls: number;
  from: string | null;
  to: string | null;
  mean: number;
  median: number;
  mode: ModeResult;
  variance: number;
  std: number;
  /** Coeficiente de variación (σ/|μ|, en %); null si la media es ~0 o la serie cambia de signo. */
  cv: number | null;
  min: Extreme | null;
  max: Extreme | null;
  range: number;
  percentiles: Record<"p1" | "p5" | "p10" | "p25" | "p50" | "p75" | "p90" | "p95" | "p99", number>;
  iqr: number;
  skewness: number;
  kurtosis: number;
  /** Valores atípicos por la regla de Tukey (fuera de Q1 − 1,5·IQR, Q3 + 1,5·IQR). */
  outliers: Extreme[];
}

export function describe(points: Pt[]): Descriptive {
  const obs = values(points);
  const x = obs.map((p) => p.v);
  const n = x.length;
  if (n === 0) throw new StatsError("La serie no tiene observaciones en el período");
  const sorted = [...x].sort((a, b) => a - b);
  const m = mean(x);
  const sd = std(x);
  let min = obs[0];
  let max = obs[0];
  for (const p of obs) {
    if (p.v < min.v) min = p;
    if (p.v > max.v) max = p;
  }
  const P = (q: number) => percentile(sorted, q);
  const q1 = P(25);
  const q3 = P(75);
  const iqr = q3 - q1;
  const signChange = sorted[0] < 0 && sorted[n - 1] > 0;
  const mom = n > 2 ? moments(x) : { skewness: NaN, kurtosis: NaN };
  return {
    n,
    nulls: points.length - n,
    from: obs[0].d,
    to: obs[n - 1].d,
    mean: m,
    median: P(50),
    mode: mode(x),
    variance: variance(x),
    std: sd,
    cv: signChange || Math.abs(m) < 1e-12 ? null : (sd / Math.abs(m)) * 100,
    min,
    max,
    range: max.v - min.v,
    percentiles: { p1: P(1), p5: P(5), p10: P(10), p25: q1, p50: P(50), p75: q3, p90: P(90), p95: P(95), p99: P(99) },
    iqr,
    skewness: mom.skewness,
    kurtosis: mom.kurtosis,
    outliers: obs.filter((p) => p.v < q1 - 1.5 * iqr || p.v > q3 + 1.5 * iqr),
  };
}

/** Promedio móvil simple de `window` observaciones (trailing o centrado). */
export function movingAverage(points: Pt[], window: number, centered = false): Pt[] {
  if (window < 1 || !Number.isInteger(window)) throw new StatsError("La ventana debe ser un entero ≥ 1");
  const out: Pt[] = [];
  const shift = centered ? Math.floor(window / 2) : window - 1;
  for (let i = 0; i < points.length; i++) {
    const start = i - shift;
    const end = start + window;
    if (start < 0 || end > points.length) continue;
    let s = 0;
    let ok = true;
    for (let j = start; j < end; j++) {
      const v = points[j].v;
      if (v === null) {
        ok = false;
        break;
      }
      s += v;
    }
    out.push({ d: points[i].d, v: ok ? s / window : null });
  }
  return out;
}

/** Promedio móvil exponencial con α = 2/(N+1), iniciado en el primer valor. */
export function ema(points: Pt[], span: number): Pt[] {
  const alpha = 2 / (span + 1);
  let prev: number | null = null;
  return points.map((p) => {
    if (p.v === null) return { d: p.d, v: prev };
    prev = prev === null ? p.v : alpha * p.v + (1 - alpha) * prev;
    return { d: p.d, v: prev };
  });
}

/**
 * Volatilidad móvil: desvío estándar de las variaciones logarítmicas en una
 * ventana, anualizado con √(períodos por año). En % (×100).
 * Requiere valores positivos (precios, tipos de cambio, índices, stocks).
 */
export function rollingVolatility(points: Pt[], window: number, freq: Frequency, annualize = true): Pt[] {
  const r: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].v;
    const b = points[i].v;
    r.push({ d: points[i].d, v: a !== null && b !== null && a > 0 && b > 0 ? Math.log(b / a) : null });
  }
  const k = annualize ? Math.sqrt(ANNUAL_PERIODS[freq]) : 1;
  const out: Pt[] = [];
  for (let i = window - 1; i < r.length; i++) {
    const w = r.slice(i - window + 1, i + 1).map((p) => p.v);
    out.push({ d: r[i].d, v: w.some((v) => v === null) ? null : std(w as number[]) * k * 100 });
  }
  return out;
}

/** Crecimiento acumulado (%) desde la primera observación válida en o después de `from`. */
export function cumulativeGrowth(points: Pt[], from?: string): Pt[] {
  const r = index100(points, from);
  return r.points.filter((p) => !from || p.d >= from).map((p) => ({ d: p.d, v: p.v === null ? null : p.v - 100 }));
}

export { pctYoY as yoyRate, index100 };

export interface CagrResult {
  from: Extreme;
  to: Extreme;
  years: number;
  /** Tasa de crecimiento anual compuesta, en %. */
  cagr: number;
  total: number;
}

/**
 * CAGR = (V_fin / V_ini)^(1/años) − 1, con años = días / 365,25.
 * Exige valores positivos en ambos extremos.
 */
export function cagr(points: Pt[], from?: string, to?: string): CagrResult {
  const obs = values(points).filter((p) => (!from || p.d >= from) && (!to || p.d <= to));
  if (obs.length < 2) throw new StatsError("Hacen falta al menos dos observaciones para calcular el CAGR");
  const a = obs[0];
  const b = obs[obs.length - 1];
  if (a.v <= 0 || b.v <= 0) throw new StatsError("El CAGR requiere valores positivos en el inicio y el final");
  const years = (Date.parse(b.d) - Date.parse(a.d)) / (365.25 * 86_400_000);
  if (years <= 0) throw new StatsError("El período debe abarcar más de un día");
  return { from: a, to: b, years, cagr: (Math.pow(b.v / a.v, 1 / years) - 1) * 100, total: (b.v / a.v - 1) * 100 };
}
