import { normalInv, tPValue } from "./dist";

/**
 * Correlaciones: Pearson, Spearman, matrices, móviles y con rezagos.
 *
 * Una correlación mide asociación lineal (Pearson) o monótona (Spearman) en
 * la muestra. No implica causalidad, y en series temporales con tendencia o
 * autocorrelación los p-valores clásicos sobreestiman la significancia
 * (correlación espuria): por eso conviene correlacionar variaciones, no niveles.
 */

export class CorrelationError extends Error {}

export type CorrMethod = "pearson" | "spearman";

export interface CorrResult {
  method: CorrMethod;
  r: number;
  n: number;
  /** Estadístico t = r·√((n−2)/(1−r²)). */
  t: number;
  /** p-valor bilateral (H0: ρ = 0), t de Student con n−2 g.l. */
  p: number;
  /** IC 95 % por la transformación z de Fisher (solo Pearson, n > 3). */
  ci95: [number, number] | null;
}

function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  if (sxx === 0 || syy === 0) throw new CorrelationError("Una de las series es constante en el período: la correlación no está definida");
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Rangos con promedio en los empates (como scipy.stats.rankdata). */
export function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function correlate(x: number[], y: number[], method: CorrMethod = "pearson"): CorrResult {
  if (x.length !== y.length) throw new CorrelationError("Las series deben tener la misma cantidad de observaciones");
  const n = x.length;
  if (n < 3) throw new CorrelationError("Hacen falta al menos 3 observaciones en común");
  const r = method === "pearson" ? pearsonR(x, y) : pearsonR(ranks(x), ranks(y));
  const df = n - 2;
  const t = Math.abs(r) === 1 ? Math.sign(r) * Infinity : r * Math.sqrt(df / (1 - r * r));
  const p = Math.abs(r) === 1 ? 0 : tPValue(t, df);
  let ci95: [number, number] | null = null;
  if (method === "pearson" && n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r);
    const h = normalInv(0.975) / Math.sqrt(n - 3);
    ci95 = [Math.tanh(z - h), Math.tanh(z + h)];
  }
  return { method, r, n, t, p, ci95 };
}

export interface CorrMatrix {
  method: CorrMethod;
  names: string[];
  r: number[][];
  p: number[][];
  n: number;
}

/** Matriz de correlaciones sobre columnas ya alineadas (mismas fechas). */
export function correlationMatrix(columns: number[][], names: string[], method: CorrMethod = "pearson"): CorrMatrix {
  const k = columns.length;
  const r = Array.from({ length: k }, () => new Array<number>(k).fill(1));
  const p = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const c = correlate(columns[i], columns[j], method);
      r[i][j] = r[j][i] = c.r;
      p[i][j] = p[j][i] = c.p;
    }
  return { method, names, r, p, n: columns[0]?.length ?? 0 };
}

/** Correlación móvil en ventanas de `window` observaciones. */
export function rollingCorrelation(
  dates: string[],
  x: number[],
  y: number[],
  window: number,
  method: CorrMethod = "pearson",
): { d: string; r: number | null }[] {
  if (window < 3) throw new CorrelationError("La ventana debe tener al menos 3 observaciones");
  const out: { d: string; r: number | null }[] = [];
  for (let i = window - 1; i < x.length; i++) {
    try {
      out.push({ d: dates[i], r: correlate(x.slice(i - window + 1, i + 1), y.slice(i - window + 1, i + 1), method).r });
    } catch {
      out.push({ d: dates[i], r: null });
    }
  }
  return out;
}

export interface LagCorr extends CorrResult {
  /** k > 0: x adelanta a y en k períodos (corr(x[t−k], y[t])); k < 0: y adelanta a x. */
  lag: number;
}

/** Correlaciones cruzadas para rezagos −maxLag…+maxLag. */
export function laggedCorrelations(x: number[], y: number[], maxLag: number, method: CorrMethod = "pearson"): LagCorr[] {
  const out: LagCorr[] = [];
  for (let k = -maxLag; k <= maxLag; k++) {
    const xs = k >= 0 ? x.slice(0, x.length - k) : x.slice(-k);
    const ys = k >= 0 ? y.slice(k) : y.slice(0, y.length + k);
    if (xs.length < 3) continue;
    try {
      out.push({ lag: k, ...correlate(xs, ys, method) });
    } catch {
      /* ventana sin variación: se omite */
    }
  }
  return out;
}
