import { fSf, normalInv, tPValue } from "./dist";
import { cholesky, crossprod, inverse, logDet, matmul, spectralRadius, transpose, zeros, type Matrix } from "./linalg";

/**
 * Vectores autorregresivos VAR(p) con constante, estimados por MCO ecuación
 * por ecuación; selección de rezagos (AIC, BIC, HQ, FPE); causalidad de
 * Granger; funciones impulso-respuesta (simples y ortogonalizadas por
 * Cholesky); descomposición de la varianza; pronósticos con bandas.
 *
 * Supuestos: variables estacionarias (o diferenciadas), relaciones lineales
 * y estables, errores ruido blanco. Limitaciones: es un modelo de forma
 * reducida; los impulsos ortogonalizados dependen del ORDEN de las variables
 * (identificación recursiva de Cholesky) y no identifican shocks
 * estructurales; "causalidad de Granger" significa capacidad predictiva, no
 * causalidad económica.
 */

export class VarError extends Error {}

export interface VarModel {
  names: string[];
  p: number;
  k: number;
  /** Observaciones efectivas (n − p). */
  nobs: number;
  /** Constante de cada ecuación. */
  intercept: number[];
  /** A[l][i][j]: efecto de y_j(t−l−1) en y_i(t). */
  A: number[][][];
  /** Errores estándar con el mismo formato (constante en `interceptSe`). */
  ASe: number[][][];
  interceptSe: number[];
  /** Σ_u con corrección por grados de libertad. */
  sigmaU: Matrix;
  sigmaUMle: Matrix;
  residuals: number[][];
  /** (Z'Z)^{-1}, para inferencia y simulaciones. */
  zzInv: Matrix;
  dfResid: number;
  llf: number;
  aic: number;
  bic: number;
  hqic: number;
  fpe: number;
  /** Radio espectral de la matriz compañera (< 1: estable). */
  spectralRadius: number;
  stable: boolean;
  /** Últimas p observaciones (la más reciente al final), para pronosticar. */
  lastObs: number[][];
  r2: number[];
}

/** Construye Y (T×k) y Z (T×(1+kp)) usando las observaciones desde `offset`. */
function design(data: number[][], p: number, offset = 0) {
  const n = data.length;
  const Y: number[][] = [];
  const Z: number[][] = [];
  for (let t = offset + p; t < n; t++) {
    Y.push(data[t].slice());
    const z = [1];
    for (let l = 1; l <= p; l++) z.push(...data[t - l]);
    Z.push(z);
  }
  return { Y, Z };
}

/** Información de criterios con la misma muestra (como statsmodels select_order). */
function infoCriteria(sigmaMle: Matrix, nobs: number, k: number, p: number) {
  const free = p * k * k + k;
  const ld = logDet(sigmaMle).logAbs;
  const dfModel = 1 + k * p;
  const dfResid = nobs - dfModel;
  return {
    aic: ld + (2 / nobs) * free,
    bic: ld + (Math.log(nobs) / nobs) * free,
    hqic: ld + ((2 * Math.log(Math.log(nobs))) / nobs) * free,
    fpe: Math.pow((nobs + dfModel) / dfResid, k) * Math.exp(ld),
  };
}

/** data[t][j]: observación t de la variable j (alineadas, sin faltantes). */
export function fitVar(data: number[][], names: string[], p: number, offset = 0): VarModel {
  const k = names.length;
  if (k < 2) throw new VarError("Un VAR necesita al menos dos variables");
  if (!Number.isInteger(p) || p < 1) throw new VarError("El orden del VAR debe ser un entero ≥ 1");
  const { Y, Z } = design(data, p, offset);
  const T = Y.length;
  const m = 1 + k * p;
  if (T - m < k + 2) throw new VarError(`Muy pocas observaciones (${T}) para un VAR(${p}) con ${k} variables (${m} parámetros por ecuación)`);
  const zz = crossprod(Z);
  let zzInv: Matrix;
  try {
    zzInv = inverse(zz);
  } catch {
    throw new VarError("Colinealidad perfecta entre las variables o rezagos del VAR");
  }
  const B = matmul(zzInv, crossprod(Z, Y)); // m × k
  const U = Y.map((y, t) => y.map((v, j) => v - Z[t].reduce((s, z, i) => s + z * B[i][j], 0)));
  const uu = crossprod(U);
  const dfResid = T - m;
  const sigmaU = uu.map((r) => r.map((v) => v / dfResid));
  const sigmaUMle = uu.map((r) => r.map((v) => v / T));
  const intercept = B[0].slice();
  const A = Array.from({ length: p }, (_, l) => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => B[1 + l * k + j][i])));
  const se = (row: number, eq: number) => Math.sqrt(sigmaU[eq][eq] * zzInv[row][row]);
  const ASe = Array.from({ length: p }, (_, l) => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => se(1 + l * k + j, i))));
  const interceptSe = Array.from({ length: k }, (_, i) => se(0, i));

  // Matriz compañera
  const C = zeros(k * p, k * p);
  for (let l = 0; l < p; l++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) C[i][l * k + j] = A[l][i][j];
  for (let i = k; i < k * p; i++) C[i][i - k] = 1;
  const rho = spectralRadius(C);

  const ic = infoCriteria(sigmaUMle, T, k, p);
  const ld = logDet(sigmaUMle).logAbs;
  const llf = -(T * k / 2) * Math.log(2 * Math.PI) - (T / 2) * ld - (T * k) / 2;
  const r2 = Array.from({ length: k }, (_, j) => {
    const mean = Y.reduce((s, y) => s + y[j], 0) / T;
    const tss = Y.reduce((s, y) => s + (y[j] - mean) ** 2, 0);
    return 1 - uu[j][j] / tss;
  });
  return {
    names,
    p,
    k,
    nobs: T,
    intercept,
    A,
    ASe,
    interceptSe,
    sigmaU,
    sigmaUMle,
    residuals: U,
    zzInv,
    dfResid,
    llf,
    ...ic,
    spectralRadius: rho,
    stable: rho < 1 - 1e-8,
    lastObs: data.slice(-p).map((r) => r.slice()),
    r2,
  };
}

export interface LagSelection {
  maxLags: number;
  table: { p: number; aic: number; bic: number; hqic: number; fpe: number }[];
  selected: { aic: number; bic: number; hqic: number; fpe: number };
}

/** Selección de rezagos 1…maxLags sobre una muestra común. */
export function selectVarOrder(data: number[][], names: string[], maxLags: number): LagSelection {
  const table: LagSelection["table"] = [];
  for (let p = 1; p <= maxLags; p++) {
    try {
      const m = fitVar(data, names, p, maxLags - p);
      table.push({ p, aic: m.aic, bic: m.bic, hqic: m.hqic, fpe: m.fpe });
    } catch {
      break;
    }
  }
  if (!table.length) throw new VarError("No hay observaciones suficientes para comparar rezagos");
  const argmin = (key: "aic" | "bic" | "hqic" | "fpe") => table.reduce((b, r) => (r[key] < b[key] ? r : b)).p;
  return { maxLags, table, selected: { aic: argmin("aic"), bic: argmin("bic"), hqic: argmin("hqic"), fpe: argmin("fpe") } };
}

export interface GrangerResult {
  causing: string;
  caused: string;
  f: number;
  df1: number;
  df2: number;
  p: number;
}

/**
 * Causalidad de Granger dentro del VAR: H0 "los rezagos de `causing` no
 * ayudan a predecir `caused`". Prueba F de la ecuación de `caused`.
 */
export function grangerTest(data: number[][], names: string[], p: number, causing: number, caused: number): GrangerResult {
  const full = design(data, p);
  const T = full.Y.length;
  const y = full.Y.map((r) => r[caused]);
  const k = names.length;
  const keep = full.Z[0].map((_, c) => c).filter((c) => c === 0 || (c - 1) % k !== causing);
  const rss = (Z: number[][]) => {
    const zz = inverse(crossprod(Z));
    const zy = Z[0].map((_, i) => Z.reduce((s, z, t) => s + z[i] * y[t], 0));
    const b = zz.map((r) => r.reduce((s, v, j) => s + v * zy[j], 0));
    return y.reduce((s, v, t) => s + (v - Z[t].reduce((a, z, i) => a + z * b[i], 0)) ** 2, 0);
  };
  const rssU = rss(full.Z);
  const rssR = rss(full.Z.map((z) => keep.map((c) => z[c])));
  const df1 = p;
  const df2 = T - (1 + k * p);
  const f = ((rssR - rssU) / df1) / (rssU / df2);
  return { causing: names[causing], caused: names[caused], f, df1, df2, p: fSf(f, df1, df2) };
}

/** Matriz de causalidad de Granger para todos los pares. */
export function grangerMatrix(data: number[][], names: string[], p: number): GrangerResult[] {
  const out: GrangerResult[] = [];
  for (let i = 0; i < names.length; i++) for (let j = 0; j < names.length; j++) if (i !== j) out.push(grangerTest(data, names, p, i, j));
  return out;
}

/** Matrices de medias móviles Φ_0…Φ_h (Φ_0 = I). */
export function maCoefficients(A: number[][][], h: number): Matrix[] {
  const k = A[0].length;
  const phi: Matrix[] = [Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)))];
  for (let s = 1; s <= h; s++) {
    let acc = zeros(k, k);
    for (let j = 1; j <= Math.min(s, A.length); j++) {
      const prod = matmul(phi[s - j], A[j - 1]);
      acc = acc.map((r, a) => r.map((v, b) => v + prod[a][b]));
    }
    phi.push(acc);
  }
  return phi;
}

export interface Irf {
  orthogonalized: boolean;
  /** irf[s][i][j]: respuesta de la variable i en el período s a un impulso en j. */
  irf: number[][][];
  lower: number[][][] | null;
  upper: number[][][] | null;
  level: number;
  draws: number;
}

/** Generador pseudoaleatorio con semilla (mulberry32): resultados reproducibles. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = uniform();
    v = uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}

function irfFrom(A: number[][][], sigma: Matrix, h: number, orth: boolean): number[][][] {
  const phi = maCoefficients(A, h);
  if (!orth) return phi;
  const P = cholesky(sigma);
  return phi.map((m) => matmul(m, P));
}

/**
 * Impulso-respuesta con bandas por simulación de Monte Carlo de los
 * coeficientes (distribución asintótica normal, Σ_u fija), semilla fija.
 */
export function impulseResponse(m: VarModel, h: number, opts: { orthogonalized?: boolean; draws?: number; level?: number; seed?: number } = {}): Irf {
  const orth = opts.orthogonalized ?? true;
  const draws = opts.draws ?? 500;
  const level = opts.level ?? 0.9;
  const irf = irfFrom(m.A, m.sigmaU, h, orth);
  if (!draws) return { orthogonalized: orth, irf, lower: null, upper: null, level, draws: 0 };
  const k = m.k;
  const p = m.p;
  const mm = 1 + k * p;
  // vec(B) ~ N(vec(B̂), Σ_u ⊗ (Z'Z)^{-1}): por ecuación i, B_i = B̂_i + chol(Σ ⊗ ZZ⁻¹)·z
  const Lz = cholesky(m.zzInv);
  const Ls = cholesky(m.sigmaU);
  const r = rng(opts.seed ?? 20261103);
  const sims: number[][][][] = [];
  for (let d = 0; d < draws; d++) {
    // E = Lz · N · Ls' (mm × k) tiene covarianza Σ ⊗ ZZ⁻¹ en vec.
    const N = Array.from({ length: mm }, () => Array.from({ length: k }, () => r.normal()));
    const E = matmul(matmul(Lz, N), transpose(Ls));
    const A = Array.from({ length: p }, (_, l) =>
      Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => m.A[l][i][j] + E[1 + l * k + j][i])),
    );
    sims.push(irfFrom(A, m.sigmaU, h, orth));
  }
  const q = (lvl: number) =>
    irf.map((ms, s) =>
      ms.map((row, i) =>
        row.map((_, j) => {
          const v = sims.map((x) => x[s][i][j]).sort((a, b) => a - b);
          const pos = lvl * (v.length - 1);
          const lo = Math.floor(pos);
          return v[lo] + (pos - lo) * (v[Math.ceil(pos)] - v[lo]);
        }),
      ),
    );
  return { orthogonalized: orth, irf, lower: q((1 - level) / 2), upper: q(1 - (1 - level) / 2), level, draws };
}

/** Descomposición de la varianza del error de pronóstico (Cholesky): fevd[s][i][j] = parte de la varianza de i explicada por j. */
export function fevd(m: VarModel, h: number): number[][][] {
  const theta = irfFrom(m.A, m.sigmaU, h - 1, true);
  const k = m.k;
  const out: number[][][] = [];
  const acc = zeros(k, k);
  for (let s = 0; s < h; s++) {
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) acc[i][j] += theta[s][i][j] ** 2;
    out.push(acc.map((row) => {
      const tot = row.reduce((a, b) => a + b, 0);
      return row.map((v) => v / tot);
    }));
  }
  return out;
}

export interface VarForecast {
  mean: number[][];
  se: number[][];
  bands: { level: number; lower: number[][]; upper: number[][] }[];
}

/** Pronóstico h pasos con bandas normales (MSE asintótico de Lütkepohl, sin incertidumbre de parámetros). */
export function forecastVar(
  m: { intercept: number[]; A: number[][][]; sigmaU: Matrix; lastObs: number[][] },
  h: number,
  levels: number[] = [0.8, 0.95],
): VarForecast {
  const k = m.intercept.length;
  const p = m.A.length;
  const hist = m.lastObs.map((r) => r.slice());
  const mean: number[][] = [];
  for (let s = 0; s < h; s++) {
    const y = m.intercept.slice();
    for (let l = 1; l <= p; l++) {
      const prev = hist[hist.length - l];
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) y[i] += m.A[l - 1][i][j] * prev[j];
    }
    mean.push(y);
    hist.push(y);
  }
  const phi = maCoefficients(m.A, h);
  const se: number[][] = [];
  const mse = zeros(k, k);
  for (let s = 0; s < h; s++) {
    const t = matmul(matmul(phi[s], m.sigmaU), transpose(phi[s]));
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) mse[i][j] += t[i][j];
    se.push(mse.map((r, i) => Math.sqrt(r[i])));
  }
  return {
    mean,
    se,
    bands: levels.map((level) => {
      const z = normalInv(1 - (1 - level) / 2);
      return { level, lower: mean.map((r, s) => r.map((v, i) => v - z * se[s][i])), upper: mean.map((r, s) => r.map((v, i) => v + z * se[s][i])) };
    }),
  };
}

/** p-valores de los coeficientes del VAR (normal asintótica, como statsmodels). */
export const varPValue = (coef: number, se: number) => tPValue(coef / se, Infinity);
