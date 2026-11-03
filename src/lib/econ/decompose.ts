import { leastSquares } from "./linalg";

/**
 * Tendencia, estacionalidad y descomposición de series.
 *
 * - Descomposición clásica por medias móviles (como `seasonal_decompose` de
 *   statsmodels). Es transparente y reproducible, pero NO reemplaza al
 *   X-13ARIMA-SEATS que usa el INDEC: cuando el organismo publica la serie
 *   desestacionalizada oficial, conviene usar esa.
 * - Filtro de Hodrick-Prescott (tendencia suave).
 * - Tendencia lineal y log-lineal por MCO.
 */

export class DecomposeError extends Error {}

export interface Decomposition {
  model: "additive" | "multiplicative";
  period: number;
  trend: (number | null)[];
  seasonal: number[];
  resid: (number | null)[];
  /** Serie ajustada por estacionalidad: y − s (aditiva) o y / s (multiplicativa). */
  adjusted: number[];
  /** Factores estacionales de cada posición del ciclo (mes 1…12, trimestre 1…4), empezando por la primera observación. */
  factors: number[];
  /** Fuerza de la estacionalidad (Wang-Smith-Hyndman): 1 − Var(resid)/Var(resid + estacional). */
  strength: number | null;
}

/** Media móvil centrada (2×m si el período es par), con nulos en los extremos. */
export function centeredMovingAverage(y: number[], period: number): (number | null)[] {
  const n = y.length;
  const w: number[] = period % 2 === 0
    ? [0.5 / period, ...new Array<number>(period - 1).fill(1 / period), 0.5 / period]
    : new Array<number>(period).fill(1 / period);
  const half = Math.floor(w.length / 2);
  const out: (number | null)[] = new Array(n).fill(null);
  for (let t = half; t < n - half; t++) {
    let s = 0;
    for (let j = 0; j < w.length; j++) s += w[j] * y[t - half + j];
    out[t] = s;
  }
  return out;
}

export function seasonalDecompose(
  y: number[],
  period: number,
  model: "additive" | "multiplicative" = "additive",
): Decomposition {
  if (!Number.isInteger(period) || period < 2) throw new DecomposeError("El período estacional debe ser un entero ≥ 2");
  if (y.length < 2 * period) {
    throw new DecomposeError(`Hacen falta al menos ${2 * period} observaciones (dos ciclos completos) para estimar la estacionalidad`);
  }
  if (y.some((v) => !Number.isFinite(v))) throw new DecomposeError("La serie tiene valores faltantes: la descomposición exige observaciones consecutivas");
  if (model === "multiplicative" && y.some((v) => v <= 0)) {
    throw new DecomposeError("El modelo multiplicativo requiere valores positivos");
  }
  const trend = centeredMovingAverage(y, period);
  const detr = y.map((v, i) => (trend[i] === null ? null : model === "additive" ? v - trend[i]! : v / trend[i]!));
  const avg = Array.from({ length: period }, (_, k) => {
    let s = 0;
    let c = 0;
    for (let i = k; i < y.length; i += period) {
      if (detr[i] !== null) {
        s += detr[i]!;
        c++;
      }
    }
    return s / c;
  });
  const center = avg.reduce((a, b) => a + b, 0) / period;
  const factors = avg.map((v) => (model === "additive" ? v - center : v / center));
  const seasonal = y.map((_, i) => factors[i % period]);
  const resid = y.map((v, i) =>
    trend[i] === null ? null : model === "additive" ? v - trend[i]! - seasonal[i] : v / (trend[i]! * seasonal[i]),
  );
  const adjusted = y.map((v, i) => (model === "additive" ? v - seasonal[i] : v / seasonal[i]));

  // Fuerza de la estacionalidad, en escala aditiva (log si es multiplicativa).
  const r: number[] = [];
  const rs: number[] = [];
  resid.forEach((e, i) => {
    if (e === null) return;
    const re = model === "additive" ? e : Math.log(e);
    const se = model === "additive" ? seasonal[i] : Math.log(seasonal[i]);
    r.push(re);
    rs.push(re + se);
  });
  const v = (x: number[]) => {
    const m = x.reduce((a, b) => a + b, 0) / x.length;
    return x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1);
  };
  const strength = r.length > 2 ? Math.max(0, 1 - v(r) / v(rs)) : null;
  return { model, period, trend, seasonal, resid, adjusted, factors, strength };
}

/**
 * Filtro de Hodrick-Prescott: minimiza Σ(y−τ)² + λ Σ(Δ²τ)².
 * Resuelve (I + λ K'K) τ = y con Cholesky de banda (pentadiagonal), O(n).
 * λ habitual: 1600 trimestral, 129600 mensual (Ravn-Uhlig), 6,25 anual.
 */
export function hpFilter(y: number[], lambda: number): { trend: number[]; cycle: number[] } {
  const n = y.length;
  if (n < 4) throw new DecomposeError("El filtro HP necesita al menos 4 observaciones");
  // Matriz simétrica pentadiagonal: diagonales d0, d1, d2.
  const d0 = new Array<number>(n).fill(0);
  const d1 = new Array<number>(n - 1).fill(0);
  const d2 = new Array<number>(n - 2).fill(0);
  for (let i = 0; i < n - 2; i++) {
    // fila i de K: [1, -2, 1] en columnas i, i+1, i+2
    const k = [1, -2, 1];
    for (let a = 0; a < 3; a++)
      for (let b = a; b < 3; b++) {
        const v = lambda * k[a] * k[b];
        const r = i + a;
        const off = b - a;
        if (off === 0) d0[r] += v;
        else if (off === 1) d1[r] += v;
        else d2[r] += v;
      }
  }
  for (let i = 0; i < n; i++) d0[i] += 1;
  // Cholesky de banda: L con diagonales l0, l1, l2.
  const l0 = new Array<number>(n).fill(0);
  const l1 = new Array<number>(n).fill(0);
  const l2 = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i >= 2) l2[i] = d2[i - 2] / l0[i - 2];
    if (i >= 1) l1[i] = ((d1[i - 1] ?? 0) - (i >= 2 ? l2[i] * l1[i - 1] : 0)) / l0[i - 1];
    const s = d0[i] - l1[i] * l1[i] - l2[i] * l2[i];
    l0[i] = Math.sqrt(s);
  }
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) z[i] = (y[i] - (i >= 1 ? l1[i] * z[i - 1] : 0) - (i >= 2 ? l2[i] * z[i - 2] : 0)) / l0[i];
  const tau = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    tau[i] = (z[i] - (i + 1 < n ? l1[i + 1] * tau[i + 1] : 0) - (i + 2 < n ? l2[i + 2] * tau[i + 2] : 0)) / l0[i];
  }
  return { trend: tau, cycle: y.map((v, i) => v - tau[i]) };
}

/** λ de HP sugerido por frecuencia (Ravn y Uhlig, 2002). */
export const HP_LAMBDA: Record<string, number> = { M: 129600, Q: 1600, A: 6.25, S: 100 };

/** Tendencia lineal (o log-lineal) por MCO sobre t = 0…n−1. */
export function linearTrend(y: number[], log = false): { trend: number[]; slope: number; intercept: number; growthPerPeriod: number | null } {
  if (log && y.some((v) => v <= 0)) throw new DecomposeError("La tendencia log-lineal requiere valores positivos");
  const z = log ? y.map(Math.log) : y;
  const { beta } = leastSquares(z.map((_, t) => [1, t]), z);
  const fit = z.map((_, t) => beta[0] + beta[1] * t);
  return {
    trend: log ? fit.map(Math.exp) : fit,
    intercept: beta[0],
    slope: beta[1],
    growthPerPeriod: log ? (Math.exp(beta[1]) - 1) * 100 : null,
  };
}
