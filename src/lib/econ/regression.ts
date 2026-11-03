import { ljungBox, type LjungBox } from "./acf";
import { chi2Sf, fSf, tInv, tPValue } from "./dist";
import { crossprod, inverse, leastSquares, matmul, symmetricEigen, type Matrix } from "./linalg";

/**
 * Regresión lineal por mínimos cuadrados ordinarios (MCO), simple o múltiple,
 * con regresores rezagados y diagnósticos de residuos. Los resultados se
 * verifican contra statsmodels (OLS) en los tests.
 */

export class RegressionError extends Error {}

export type CovType = "nonrobust" | "HC1" | "HAC";

export interface Coefficient {
  name: string;
  coef: number;
  se: number;
  t: number;
  p: number;
  ciLow: number;
  ciHigh: number;
}

export interface OlsDiagnostics {
  durbinWatson: number;
  jarqueBera: { stat: number; p: number; skewness: number; kurtosis: number };
  /** Breusch-Pagan (versión de Koenker, robusta a no normalidad). null sin constante o con un solo regresor. */
  breuschPagan: { lm: number; df: number; p: number } | null;
  ljungBox: LjungBox | null;
  /** Número de condición de X (columnas normalizadas): > 30 sugiere multicolinealidad. */
  conditionNumber: number;
  /** Factor de inflación de la varianza de cada regresor (sin la constante). */
  vif: { name: string; vif: number }[];
}

export interface OlsResult {
  n: number;
  k: number;
  dfResid: number;
  dfModel: number;
  hasConstant: boolean;
  covType: CovType;
  hacLags: number | null;
  coefficients: Coefficient[];
  r2: number;
  adjR2: number;
  fStat: number | null;
  fP: number | null;
  sigma: number;
  ssr: number;
  llf: number;
  aic: number;
  bic: number;
  fitted: number[];
  residuals: number[];
  diagnostics: OlsDiagnostics;
  confidence: number;
}

export interface OlsOptions {
  /** Agregar constante (por defecto, sí). */
  constant?: boolean;
  covType?: CovType;
  /** Rezagos de Newey-West para HAC (por defecto ⌊4·(n/100)^{2/9}⌋). */
  hacLags?: number;
  /** Nivel de confianza de los intervalos (por defecto 0,95). */
  confidence?: number;
}

export const neweyWestLags = (n: number) => Math.floor(4 * Math.pow(n / 100, 2 / 9));

export function ols(y: number[], x: number[][], names: string[], opts: OlsOptions = {}): OlsResult {
  const hasConstant = opts.constant ?? true;
  const covType = opts.covType ?? "nonrobust";
  const confidence = opts.confidence ?? 0.95;
  const n = y.length;
  if (x.length !== n) throw new RegressionError("La variable dependiente y los regresores tienen distinta cantidad de observaciones");
  if (y.some((v) => !Number.isFinite(v)) || x.some((r) => r.some((v) => !Number.isFinite(v)))) {
    throw new RegressionError("Hay valores faltantes o no finitos en los datos");
  }
  const X = hasConstant ? x.map((r) => [1, ...r]) : x.map((r) => [...r]);
  const allNames = hasConstant ? ["Constante", ...names] : [...names];
  const k = X[0]?.length ?? 0;
  if (k === 0) throw new RegressionError("No hay regresores");
  const dfResid = n - k;
  if (dfResid <= 0) throw new RegressionError(`Hay ${n} observaciones para ${k} parámetros: hacen falta más observaciones`);

  const { beta, xtxInv } = leastSquares(X, y);
  const fitted = X.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const ssr = resid.reduce((s, e) => s + e * e, 0);
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  const tss = hasConstant ? y.reduce((s, v) => s + (v - ybar) ** 2, 0) : y.reduce((s, v) => s + v * v, 0);
  const r2 = 1 - ssr / tss;
  const dfModel = k - (hasConstant ? 1 : 0);
  const adjR2 = 1 - ((n - (hasConstant ? 1 : 0)) / dfResid) * (1 - r2);
  const sigma2 = ssr / dfResid;

  // Matriz de covarianzas de β.
  let cov: Matrix;
  let hacLags: number | null = null;
  if (covType === "nonrobust") {
    cov = xtxInv.map((r) => r.map((v) => v * sigma2));
  } else {
    const meat: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const add = (i: number, j: number, w: number) => {
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += w * resid[i] * resid[j] * X[i][a] * X[j][b];
    };
    for (let t = 0; t < n; t++) add(t, t, 1);
    if (covType === "HAC") {
      hacLags = opts.hacLags ?? neweyWestLags(n);
      for (let l = 1; l <= hacLags; l++) {
        const w = 1 - l / (hacLags + 1);
        for (let t = l; t < n; t++) {
          add(t, t - l, w);
          add(t - l, t, w);
        }
      }
    }
    // HC1 lleva la corrección n/(n−k); Newey-West sin corrección (como statsmodels).
    const corr = covType === "HC1" ? n / dfResid : 1;
    cov = matmul(matmul(xtxInv, meat), xtxInv).map((r) => r.map((v) => v * corr));
  }

  const tq = tInv(1 - (1 - confidence) / 2, dfResid);
  const coefficients: Coefficient[] = beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]);
    const t = b / se;
    return { name: allNames[j], coef: b, se, t, p: tPValue(t, dfResid), ciLow: b - tq * se, ciHigh: b + tq * se };
  });

  // F conjunta de las pendientes (Wald con la covarianza elegida).
  let fStat: number | null = null;
  let fP: number | null = null;
  if (dfModel > 0) {
    if (covType === "nonrobust" && hasConstant) {
      fStat = ((tss - ssr) / dfModel) / sigma2;
    } else {
      const idx = allNames.map((_, j) => j).filter((j) => !(hasConstant && j === 0));
      const bs = idx.map((j) => beta[j]);
      const vs = idx.map((i) => idx.map((j) => cov[i][j]));
      const vi = inverse(vs);
      let w = 0;
      for (let i = 0; i < bs.length; i++) for (let j = 0; j < bs.length; j++) w += bs[i] * vi[i][j] * bs[j];
      fStat = w / dfModel;
    }
    fP = fSf(fStat, dfModel, dfResid);
  }

  const llf = -(n / 2) * (Math.log(2 * Math.PI) + Math.log(ssr / n) + 1);

  return {
    n,
    k,
    dfResid,
    dfModel,
    hasConstant,
    covType,
    hacLags,
    coefficients,
    r2,
    adjR2,
    fStat,
    fP,
    sigma: Math.sqrt(sigma2),
    ssr,
    llf,
    aic: -2 * llf + 2 * k,
    bic: -2 * llf + Math.log(n) * k,
    fitted,
    residuals: resid,
    diagnostics: diagnostics(resid, X, allNames, hasConstant),
    confidence,
  };
}

function diagnostics(resid: number[], X: number[][], names: string[], hasConstant: boolean): OlsDiagnostics {
  const n = resid.length;
  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t++) {
    den += resid[t] * resid[t];
    if (t > 0) num += (resid[t] - resid[t - 1]) ** 2;
  }
  // Jarque-Bera
  const m = resid.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const e of resid) {
    const d = e - m;
    m2 += d * d;
    m3 += d ** 3;
    m4 += d ** 4;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const skewness = m3 / Math.pow(m2, 1.5);
  const kurtosis = m4 / (m2 * m2);
  const jb = (n / 6) * (skewness ** 2 + ((kurtosis - 3) ** 2) / 4);

  // Breusch-Pagan (Koenker): n·R² de e² sobre X.
  let breuschPagan: OlsDiagnostics["breuschPagan"] = null;
  const kx = X[0].length;
  if (hasConstant && kx > 1 && n > kx) {
    const e2 = resid.map((e) => e * e);
    try {
      const { beta } = leastSquares(X, e2);
      const fit = X.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
      const mean = e2.reduce((a, b) => a + b, 0) / n;
      const tss = e2.reduce((s, v) => s + (v - mean) ** 2, 0);
      const rss = e2.reduce((s, v, i) => s + (v - fit[i]) ** 2, 0);
      const lm = n * (1 - rss / tss);
      breuschPagan = { lm, df: kx - 1, p: chi2Sf(lm, kx - 1) };
    } catch {
      breuschPagan = null;
    }
  }

  const lbLags = Math.min(10, Math.floor(n / 5));
  // Número de condición con columnas normalizadas a norma 1.
  const norms = X[0].map((_, j) => Math.sqrt(X.reduce((s, r) => s + r[j] * r[j], 0)));
  const Xn = X.map((r) => r.map((v, j) => v / norms[j]));
  const ev = symmetricEigen(crossprod(Xn)).values;
  const conditionNumber = Math.sqrt(ev[0] / Math.max(ev[ev.length - 1], 1e-300));

  // VIF: 1/(1−R²_j) regresando cada regresor contra los demás (con constante).
  const vif: OlsDiagnostics["vif"] = [];
  const start = hasConstant ? 1 : 0;
  if (kx - start >= 2) {
    for (let j = start; j < kx; j++) {
      const yj = X.map((r) => r[j]);
      const others = X.map((r) => r.filter((_, c) => c !== j && c >= start));
      try {
        const Z = others.map((r) => [1, ...r]);
        const { beta } = leastSquares(Z, yj);
        const mj = yj.reduce((a, b) => a + b, 0) / n;
        const tss = yj.reduce((s, v) => s + (v - mj) ** 2, 0);
        const rss = yj.reduce((s, v, i) => s + (v - Z[i].reduce((a, z, c) => a + z * beta[c], 0)) ** 2, 0);
        vif.push({ name: names[j], vif: 1 / (rss / tss) });
      } catch {
        vif.push({ name: names[j], vif: Infinity });
      }
    }
  }

  return {
    durbinWatson: num / den,
    jarqueBera: { stat: jb, p: chi2Sf(jb, 2), skewness, kurtosis },
    breuschPagan,
    ljungBox: lbLags >= 1 ? ljungBox(resid, lbLags) : null,
    conditionNumber,
    vif,
  };
}

// ── Diseño con rezagos ──────────────────────────────────────────────────────

export interface RegressorSpec {
  /** Índice de la columna en los datos alineados. */
  column: number;
  name: string;
  /** Rezagos a incluir (0 = contemporáneo). */
  lags: number[];
}

export interface DesignMatrix {
  y: number[];
  x: number[][];
  names: string[];
  dates: string[];
  /** Observaciones iniciales descartadas por los rezagos. */
  dropped: number;
}

/**
 * Arma y y X con regresores rezagados y, opcionalmente, rezagos de la
 * dependiente (modelo autorregresivo con rezagos distribuidos, ARDL).
 * Las primeras max(rezago) observaciones se descartan: no se rellenan.
 */
export function buildDesign(
  dates: string[],
  columns: number[][],
  depColumn: number,
  depName: string,
  regressors: RegressorSpec[],
  depLags: number[] = [],
): DesignMatrix {
  const maxLag = Math.max(0, ...depLags, ...regressors.flatMap((r) => r.lags));
  const n = dates.length;
  if (n - maxLag < 3) throw new RegressionError("No quedan observaciones suficientes después de aplicar los rezagos");
  const names = [
    ...depLags.map((l) => `${depName} (t−${l})`),
    ...regressors.flatMap((r) => r.lags.map((l) => (l === 0 ? r.name : `${r.name} (t−${l})`))),
  ];
  const y: number[] = [];
  const x: number[][] = [];
  for (let t = maxLag; t < n; t++) {
    y.push(columns[depColumn][t]);
    x.push([...depLags.map((l) => columns[depColumn][t - l]), ...regressors.flatMap((r) => r.lags.map((l) => columns[r.column][t - l]))]);
  }
  return { y, x, names, dates: dates.slice(maxLag), dropped: maxLag };
}
