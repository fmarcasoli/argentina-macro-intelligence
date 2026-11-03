import { chi2Sf } from "./dist";

/** Autocovarianzas γ(0…nlags), con la media muestral; `adjusted` divide por n−k en lugar de n. */
export function acovf(x: number[], nlags: number, adjusted = false): number[] {
  const n = x.length;
  const m = x.reduce((a, b) => a + b, 0) / n;
  const d = x.map((v) => v - m);
  const out: number[] = [];
  for (let k = 0; k <= Math.min(nlags, n - 1); k++) {
    let s = 0;
    for (let t = k; t < n; t++) s += d[t] * d[t - k];
    out.push(s / (adjusted ? n - k : n));
  }
  return out;
}

/** Función de autocorrelación ρ(0…nlags) (como statsmodels `acf`). */
export function acf(x: number[], nlags: number): number[] {
  const g = acovf(x, nlags);
  return g.map((v) => v / g[0]);
}

/** Recursión de Durbin-Levinson: coeficientes AR y autocorrelaciones parciales desde autocovarianzas. */
export function durbinLevinson(gamma: number[], order: number): { phi: number[]; pacf: number[]; sigma2: number } {
  let phi: number[] = [];
  let v = gamma[0];
  const pacf = [1];
  for (let k = 1; k <= order; k++) {
    let num = gamma[k];
    for (let j = 1; j < k; j++) num -= phi[j - 1] * gamma[k - j];
    const a = num / v;
    const next = phi.map((p, j) => p - a * phi[k - 2 - j]);
    next.push(a);
    phi = next;
    v *= 1 - a * a;
    pacf.push(a);
  }
  return { phi, pacf, sigma2: v };
}

/** Autocorrelación parcial por Yule-Walker con autocovarianzas ajustadas (statsmodels "ywadjusted"). */
export function pacf(x: number[], nlags: number): number[] {
  return durbinLevinson(acovf(x, nlags, true), nlags).pacf;
}

export interface LjungBox {
  lags: number;
  q: number;
  df: number;
  p: number;
}

/** Prueba de Ljung-Box (H0: no hay autocorrelación hasta el rezago `lags`). */
export function ljungBox(x: number[], lags: number, modelDf = 0): LjungBox {
  const n = x.length;
  const r = acf(x, lags);
  let q = 0;
  for (let k = 1; k <= lags; k++) q += (r[k] * r[k]) / (n - k);
  q *= n * (n + 2);
  const df = Math.max(1, lags - modelDf);
  return { lags, q, df, p: chi2Sf(q, df) };
}
