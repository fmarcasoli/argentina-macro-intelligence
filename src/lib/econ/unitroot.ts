import { normalCdf } from "./dist";
import { leastSquares } from "./linalg";
import { ols } from "./regression";
import tables from "./tables.json";

/**
 * Pruebas de raíz unitaria y cointegración:
 *  - ADF (Dickey-Fuller aumentada), H0: hay raíz unitaria (no estacionaria).
 *  - KPSS, H0: la serie es estacionaria (en nivel o alrededor de una tendencia).
 *  - Engle-Granger, H0: no hay cointegración.
 *
 * Replican el algoritmo de statsmodels (adfuller, kpss, coint); los p-valores
 * y valores críticos usan las superficies de respuesta de MacKinnon
 * (1994, 2010), exportadas de statsmodels a tables.json.
 */

export class UnitRootError extends Error {}

export type DetTerm = "n" | "c" | "ct";

interface AdfTable {
  max: (number | null)[];
  min: number[];
  star: number[];
  smallp: number[][];
  largep: number[][];
  crit2010: number[][][];
}
const ADF = tables.adf as unknown as Record<DetTerm | "ctt", AdfTable>;

/** p-valor aproximado de MacKinnon (1994) para el estadístico τ con N series. */
export function mackinnonP(stat: number, regression: DetTerm, N = 1): number {
  const t = ADF[regression];
  if (N < 1 || N > t.max.length) throw new UnitRootError(`MacKinnon: N debe estar entre 1 y ${t.max.length}`);
  if (stat > (t.max[N - 1] ?? Infinity)) return 1;
  if (stat < t.min[N - 1]) return 0;
  const coef = stat <= t.star[N - 1] ? t.smallp[N - 1] : t.largep[N - 1];
  let poly = 0;
  for (let i = coef.length - 1; i >= 0; i--) poly = poly * stat + coef[i];
  return normalCdf(poly);
}

/** Valores críticos de MacKinnon (2010) al 1 %, 5 % y 10 % para `nobs` observaciones. */
export function mackinnonCrit(regression: DetTerm, N: number, nobs: number): { "1%": number; "5%": number; "10%": number } {
  const c = ADF[regression].crit2010[N - 1];
  const v = c.map((row) => row.reduce((s, b, j) => s + b / Math.pow(nobs, j), 0));
  return { "1%": v[0], "5%": v[1], "10%": v[2] };
}

export interface AdfResult {
  stat: number;
  p: number;
  usedLag: number;
  nobs: number;
  regression: DetTerm;
  crit: { "1%": number; "5%": number; "10%": number };
  icBest: number | null;
}

const trendCols = (n: number, regression: DetTerm): number[][] =>
  Array.from({ length: n }, (_, t) => (regression === "n" ? [] : regression === "c" ? [1] : [1, t + 1]));

function olsFit(y: number[], X: number[][]) {
  const { beta, xtxInv } = leastSquares(X, y);
  const n = y.length;
  const k = X[0].length;
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - X[i].reduce((s, v, j) => s + v * beta[j], 0);
    ssr += e * e;
  }
  const llf = -(n / 2) * (Math.log(2 * Math.PI) + Math.log(ssr / n) + 1);
  return { beta, xtxInv, ssr, llf, aic: -2 * llf + 2 * k, bic: -2 * llf + Math.log(n) * k, sigma2: ssr / (n - k) };
}

/** Matriz [x(t), Δx(t−1)…Δx(t−lag)] y Δx(t) con recorte "both" (como lagmat). */
function adfDesign(x: number[], lag: number) {
  const dx = x.slice(1).map((v, i) => v - x[i]);
  const rows: number[][] = [];
  const y: number[] = [];
  for (let t = lag; t < dx.length; t++) {
    const r = [x[t]];
    for (let l = 1; l <= lag; l++) r.push(dx[t - l]);
    rows.push(r);
    y.push(dx[t]);
  }
  return { rows, y };
}

/**
 * Dickey-Fuller aumentada. Con `autolag` ("AIC" o "BIC") elige el rezago entre
 * 0 y maxlag sobre una muestra común, y reestima con el rezago elegido.
 */
export function adf(
  x: number[],
  opts: { regression?: DetTerm; maxlag?: number; autolag?: "AIC" | "BIC" | null } = {},
): AdfResult {
  const regression = opts.regression ?? "c";
  const autolag = opts.autolag === undefined ? "AIC" : opts.autolag;
  const nobs = x.length;
  if (x.some((v) => !Number.isFinite(v))) throw new UnitRootError("La serie tiene valores faltantes");
  const ntrend = regression === "n" ? 0 : regression.length;
  let maxlag = opts.maxlag ?? Math.ceil(12 * Math.pow(nobs / 100, 1 / 4));
  maxlag = Math.min(Math.floor(nobs / 2) - ntrend - 1, maxlag);
  if (maxlag < 0) throw new UnitRootError("Muy pocas observaciones para la prueba ADF");

  let usedLag = maxlag;
  let icBest: number | null = null;
  if (autolag) {
    const { rows, y } = adfDesign(x, maxlag);
    const tr = trendCols(rows.length, regression);
    const full = rows.map((r, i) => [...tr[i], ...r]); // tendencia primero (prepend)
    const start = ntrend + 1;
    let best: { ic: number; lag: number } | null = null;
    for (let cols = start; cols <= start + maxlag; cols++) {
      const fit = olsFit(y, full.map((r) => r.slice(0, cols)));
      const ic = autolag === "AIC" ? fit.aic : fit.bic;
      if (!best || ic < best.ic) best = { ic, lag: cols };
    }
    usedLag = best!.lag - start;
    icBest = best!.ic;
  }
  const { rows, y } = adfDesign(x, usedLag);
  const tr = trendCols(rows.length, regression);
  const X = rows.map((r, i) => [...r, ...tr[i]]); // tendencia al final (append)
  const fit = olsFit(y, X);
  const stat = fit.beta[0] / Math.sqrt(fit.sigma2 * fit.xtxInv[0][0]);
  return {
    stat,
    p: mackinnonP(stat, regression, 1),
    usedLag,
    nobs: rows.length,
    regression,
    crit: mackinnonCrit(regression, 1, rows.length),
    icBest,
  };
}

export interface KpssResult {
  stat: number;
  /** Interpolado en la tabla de KPSS (1992): queda acotado a [0,01; 0,10]. */
  p: number;
  pBound: "lower" | "upper" | null;
  lags: number;
  regression: "c" | "ct";
  crit: { "10%": number; "5%": number; "2.5%": number; "1%": number };
}

/** KPSS con selección automática del ancho de banda (Hobijn, Franses y Ooms, 1998). */
export function kpss(x: number[], opts: { regression?: "c" | "ct"; lags?: number } = {}): KpssResult {
  const regression = opts.regression ?? "c";
  const n = x.length;
  if (n < 4) throw new UnitRootError("Muy pocas observaciones para la prueba KPSS");
  let resid: number[];
  let crit: number[];
  if (regression === "ct") {
    const X = x.map((_, t) => [1, t + 1]);
    const { beta } = leastSquares(X, x);
    resid = x.map((v, t) => v - beta[0] - beta[1] * (t + 1));
    crit = [0.119, 0.146, 0.176, 0.216];
  } else {
    const m = x.reduce((a, b) => a + b, 0) / n;
    resid = x.map((v) => v - m);
    crit = [0.347, 0.463, 0.574, 0.739];
  }
  const dotLag = (i: number) => {
    let s = 0;
    for (let t = i; t < n; t++) s += resid[t] * resid[t - i];
    return s;
  };
  let lags = opts.lags;
  if (lags === undefined) {
    const covlags = Math.floor(Math.pow(n, 2 / 9));
    let s0 = dotLag(0) / n;
    let s1 = 0;
    for (let i = 1; i <= covlags; i++) {
      const prod = dotLag(i) / (n / 2);
      s0 += prod;
      s1 += i * prod;
    }
    const sHat = s1 / s0;
    const gamma = 1.1447 * Math.pow(sHat * sHat, 1 / 3);
    lags = Math.floor(gamma * Math.pow(n, 1 / 3));
    lags = Math.min(lags, n - 1);
  }
  let cum = 0;
  let eta = 0;
  for (const e of resid) {
    cum += e;
    eta += cum * cum;
  }
  eta /= n * n;
  let s = dotLag(0);
  for (let i = 1; i <= lags; i++) s += 2 * dotLag(i) * (1 - i / (lags + 1));
  s /= n;
  const stat = eta / s;
  const pvals = [0.1, 0.05, 0.025, 0.01];
  let p: number;
  let pBound: KpssResult["pBound"] = null;
  if (stat <= crit[0]) {
    p = pvals[0];
    pBound = "upper";
  } else if (stat >= crit[3]) {
    p = pvals[3];
    pBound = "lower";
  } else {
    let i = 0;
    while (stat > crit[i + 1]) i++;
    p = pvals[i] + ((stat - crit[i]) / (crit[i + 1] - crit[i])) * (pvals[i + 1] - pvals[i]);
  }
  return { stat, p, pBound, lags, regression, crit: { "10%": crit[0], "5%": crit[1], "2.5%": crit[2], "1%": crit[3] } };
}

export interface EngleGrangerResult {
  stat: number;
  p: number;
  crit: { "1%": number; "5%": number; "10%": number };
  usedLag: number;
  /** Coeficientes de la regresión de cointegración (constante, pendientes). */
  coefficients: number[];
  residuals: number[];
}

/** Engle-Granger: ADF sin constante sobre los residuos de y0 = a + b·y1 + … */
export function engleGranger(y0: number[], others: number[][], opts: { autolag?: "AIC" | "BIC" } = {}): EngleGrangerResult {
  const N = others.length + 1;
  if (N > 6) throw new UnitRootError("Engle-Granger admite hasta 6 series");
  const X = y0.map((_, t) => others.map((c) => c[t]));
  const reg = ols(y0, X, others.map((_, i) => `x${i + 1}`), { constant: true });
  const a = adf(reg.residuals, { regression: "n", autolag: opts.autolag ?? "AIC" });
  return {
    stat: a.stat,
    p: mackinnonP(a.stat, "c", N),
    crit: mackinnonCrit("c", N, y0.length - 1),
    usedLag: a.usedLag,
    coefficients: reg.coefficients.map((c) => c.coef),
    residuals: reg.residuals,
  };
}

export interface StationarityVerdict {
  adf: AdfResult;
  kpss: KpssResult;
  /** Lectura conjunta de ADF y KPSS al 5 %. */
  verdict: "stationary" | "unit_root" | "inconclusive";
  text: string;
}

/** Combina ADF y KPSS: la conclusión es firme solo cuando ambas coinciden. */
export function stationarity(x: number[], regression: "c" | "ct" = "c"): StationarityVerdict {
  const a = adf(x, { regression });
  const k = kpss(x, { regression });
  const adfRejects = a.p < 0.05;
  const kpssRejects = k.stat > k.crit["5%"];
  let verdict: StationarityVerdict["verdict"];
  let text: string;
  if (adfRejects && !kpssRejects) {
    verdict = "stationary";
    text = "ADF rechaza la raíz unitaria y KPSS no rechaza la estacionariedad: la serie se comporta como estacionaria.";
  } else if (!adfRejects && kpssRejects) {
    verdict = "unit_root";
    text = "ADF no rechaza la raíz unitaria y KPSS rechaza la estacionariedad: la serie tiene raíz unitaria (conviene diferenciarla).";
  } else {
    verdict = "inconclusive";
    text = adfRejects
      ? "Ambas pruebas rechazan su hipótesis nula: resultado ambiguo (posible quiebre estructural o memoria larga)."
      : "Ninguna prueba rechaza su hipótesis nula: la muestra no alcanza para distinguir (baja potencia).";
  }
  return { adf: a, kpss: k, verdict, text };
}
