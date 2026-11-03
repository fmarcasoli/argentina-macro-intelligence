import { cholesky, crossprod, inverse, leastSquares, matmul, symmetricEigen, transpose, type Matrix } from "./linalg";
import tables from "./tables.json";
import { stationarity } from "./unitroot";
import { forecastVar, type VarForecast } from "./var";

/**
 * Cointegración de Johansen y modelos de corrección de errores (VECM).
 *
 *   Δy_t = α β' y_{t−1} + Γ₁ Δy_{t−1} + … + Γ_{p−1} Δy_{t−p+1} + c + u_t
 *
 * Requisitos para usar un VECM: (1) todas las series integradas de orden 1
 * (I(1): raíz unitaria en niveles, estacionarias en diferencias) y (2) al
 * menos una relación de cointegración y menos que el número de series
 * (0 < r < k) según la prueba de traza de Johansen. Si no se cumplen, el
 * VECM no corresponde: con r = 0 se usa un VAR en diferencias; con r = k
 * las series son estacionarias y se usa un VAR en niveles.
 */

export class VecmError extends Error {}

const JOH = tables.johansen as unknown as Record<"-1" | "0" | "1", { maxeig: number[][]; trace: number[][] }>;

/** Residuos de la regresión de cada columna de Y sobre X (sin X: Y). */
function residualize(Y: Matrix, X: Matrix | null): Matrix {
  if (!X || !X[0]?.length) return Y.map((r) => r.slice());
  const cols = Y[0].map((_, j) => {
    const y = Y.map((r) => r[j]);
    const { beta } = leastSquares(X, y);
    return y.map((v, t) => v - X[t].reduce((s, x, i) => s + x * beta[i], 0));
  });
  return Y.map((_, t) => cols.map((c) => c[t]));
}

/** Quita una tendencia polinómica de orden `order` (−1: nada), columna por columna. */
function detrend(Y: Matrix, order: number): Matrix {
  if (order < 0) return Y.map((r) => r.slice());
  const n = Y.length;
  const X = Y.map((_, t) => Array.from({ length: order + 1 }, (_, j) => Math.pow(n > 1 ? -1 + (2 * t) / (n - 1) : 0, order - j)));
  return residualize(Y, X);
}

export interface JohansenResult {
  detOrder: -1 | 0 | 1;
  kArDiff: number;
  eigenvalues: number[];
  /** Estadístico de traza para H0: rango ≤ r (r = 0…k−1). */
  trace: number[];
  maxEig: number[];
  /** Valores críticos [90 %, 95 %, 99 %] de cada fila. */
  traceCrit: number[][];
  maxEigCrit: number[][];
  /** Rango seleccionado por la prueba de traza al 5 %. */
  rank: number;
  nobs: number;
}

/**
 * Prueba de Johansen, como `coint_johansen` de statsmodels
 * (detOrder: −1 sin términos deterministas, 0 constante, 1 tendencia lineal).
 */
export function johansen(data: number[][], detOrder: -1 | 0 | 1 = 0, kArDiff = 1): JohansenResult {
  const n = data.length;
  const k = data[0]?.length ?? 0;
  if (k < 2) throw new VecmError("La prueba de Johansen necesita al menos dos series");
  if (k > 12) throw new VecmError("La prueba de Johansen admite hasta 12 series");
  if (kArDiff < 1) throw new VecmError("Se necesita al menos un rezago en diferencias");
  if (n - kArDiff - 1 < 3 * k + kArDiff * k) throw new VecmError("Muy pocas observaciones para la prueba de Johansen");
  const f = detOrder > -1 ? 0 : -1;
  const x = detrend(data, detOrder);
  const dx = x.slice(1).map((r, t) => r.map((v, j) => v - x[t][j]));
  // z: rezagos de Δx (1…k), recortados
  const z = dx.slice(kArDiff).map((_, i) => {
    const t = i + kArDiff;
    const row: number[] = [];
    for (let l = 1; l <= kArDiff; l++) row.push(...dx[t - l]);
    return row;
  });
  const zD = detrend(z, f);
  const dxD = detrend(dx.slice(kArDiff), f);
  const r0t = residualize(dxD, zD);
  // Nivel rezagado k períodos (forma de Johansen original; mismos autovalores).
  const lx = x.slice(1, x.length - kArDiff);
  const rkt = residualize(detrend(lx, f), zD);
  const T = rkt.length;
  const skk = crossprod(rkt).map((r) => r.map((v) => v / T));
  const sk0 = crossprod(rkt, r0t).map((r) => r.map((v) => v / T));
  const s00 = crossprod(r0t).map((r) => r.map((v) => v / T));
  const sig = matmul(matmul(sk0, inverse(s00)), transpose(sk0));
  // Problema generalizado sig v = λ skk v → simétrico con L = chol(skk).
  const L = cholesky(skk);
  const Li = inverse(L);
  const M = matmul(matmul(Li, sig), transpose(Li));
  const sym = M.map((r, i) => r.map((v, j) => (v + M[j][i]) / 2));
  const eig = symmetricEigen(sym).values.map((v) => Math.min(Math.max(v, 0), 1 - 1e-15));
  const trace: number[] = [];
  const maxEig: number[] = [];
  const traceCrit: number[][] = [];
  const maxEigCrit: number[][] = [];
  for (let i = 0; i < k; i++) {
    trace.push(-T * eig.slice(i).reduce((s, a) => s + Math.log(1 - a), 0));
    maxEig.push(-T * Math.log(1 - eig[i]));
    traceCrit.push(JOH[String(detOrder) as "0"].trace[k - i - 1]);
    maxEigCrit.push(JOH[String(detOrder) as "0"].maxeig[k - i - 1]);
  }
  let rank = 0;
  while (rank < k && trace[rank] > traceCrit[rank][1]) rank++;
  return { detOrder, kArDiff, eigenvalues: eig, trace, maxEig, traceCrit, maxEigCrit, rank, nobs: T };
}

export interface VecmModel {
  names: string[];
  rank: number;
  kArDiff: number;
  /** α (k × r): velocidades de ajuste al equilibrio. */
  alpha: Matrix;
  /** β (k × r): vectores de cointegración normalizados (primeras r filas = I). */
  beta: Matrix;
  /** Γ_i (k × k), i = 1…kArDiff. */
  gamma: Matrix[];
  /** Constante (fuera de la relación de cointegración). */
  constant: number[];
  sigmaU: Matrix;
  nobs: number;
  /** Representación como VAR en niveles (para pronosticar e impulso-respuesta). */
  varForm: { intercept: number[]; A: number[][][]; sigmaU: Matrix; lastObs: number[][] };
}

/** VECM por máxima verosimilitud (Johansen; Lütkepohl, 2005, cap. 7), constante sin restringir. */
export function fitVecm(data: number[][], names: string[], rank: number, kArDiff = 1): VecmModel {
  const k = names.length;
  if (rank < 1 || rank >= k) throw new VecmError(`El rango de cointegración debe estar entre 1 y ${k - 1}`);
  const p = kArDiff + 1;
  const n = data.length;
  const dy = data.slice(1).map((r, t) => r.map((v, j) => v - data[t][j]));
  // t = p … n−1 (índices de nivel)
  const rows = n - p;
  const DY: Matrix = [];
  const YL: Matrix = [];
  const DX: Matrix = [];
  for (let t = p; t < n; t++) {
    DY.push(dy[t - 1]);
    YL.push(data[t - 1]);
    const r: number[] = [];
    for (let l = 1; l <= kArDiff; l++) r.push(...dy[t - 1 - l]);
    r.push(1);
    DX.push(r);
  }
  const T = rows;
  const r0 = residualize(DY, DX);
  const r1 = residualize(YL, DX);
  const s00 = crossprod(r0).map((r) => r.map((v) => v / T));
  const s01 = crossprod(r0, r1).map((r) => r.map((v) => v / T));
  const s11 = crossprod(r1).map((r) => r.map((v) => v / T));
  const L = cholesky(s11);
  const Li = inverse(L);
  const M = matmul(matmul(matmul(matmul(Li, transpose(s01)), inverse(s00)), s01), transpose(Li));
  const sym = M.map((r, i) => r.map((v, j) => (v + M[j][i]) / 2));
  const { vectors } = symmetricEigen(sym);
  let beta = matmul(transpose(Li), vectors).map((r) => r.slice(0, rank));
  // Normalización: primeras r filas = identidad.
  const top = inverse(beta.slice(0, rank));
  beta = matmul(beta, top);
  const alpha = matmul(matmul(s01, beta), inverse(matmul(matmul(transpose(beta), s11), beta)));
  const ab = matmul(alpha, transpose(beta)); // k × k
  // Γ y constante: MCO de (Δy − αβ'y_{t−1}) sobre DX.
  const lhs = DY.map((r, t) => r.map((v, i) => v - ab[i].reduce((s, a, j) => s + a * YL[t][j], 0)));
  const coef = Array.from({ length: k }, (_, i) => leastSquares(DX, lhs.map((r) => r[i])).beta); // k × (k·kArDiff + 1)
  const gamma = Array.from({ length: kArDiff }, (_, l) => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => coef[i][l * k + j])));
  const constant = coef.map((c) => c[c.length - 1]);
  const U = lhs.map((r, t) => r.map((v, i) => v - DX[t].reduce((s, x, j) => s + x * coef[i][j], 0)));
  const sigmaU = crossprod(U).map((r) => r.map((v) => v / T));
  // VAR en niveles: A1 = I + αβ' + Γ1; Ai = Γi − Γ(i−1); Ap = −Γ(p−1)
  const I = (i: number, j: number) => (i === j ? 1 : 0);
  const A: number[][][] = [];
  for (let l = 0; l < p; l++) {
    A.push(
      Array.from({ length: k }, (_, i) =>
        Array.from({ length: k }, (_, j) => {
          if (l === 0) return I(i, j) + ab[i][j] + (kArDiff >= 1 ? gamma[0][i][j] : 0);
          if (l < kArDiff) return gamma[l][i][j] - gamma[l - 1][i][j];
          return -gamma[l - 1][i][j];
        }),
      ),
    );
  }
  return {
    names,
    rank,
    kArDiff,
    alpha,
    beta,
    gamma,
    constant,
    sigmaU,
    nobs: T,
    varForm: { intercept: constant, A, sigmaU, lastObs: data.slice(-p).map((r) => r.slice()) },
  };
}

export const forecastVecm = (m: VecmModel, h: number, levels?: number[]): VarForecast => forecastVar(m.varForm, h, levels);

export interface VecmRequirements {
  ok: boolean;
  integration: { name: string; levels: string; diffs: string; i1: boolean }[];
  johansen: JohansenResult | null;
  reasons: string[];
}

/** Verifica los requisitos del VECM: series I(1) y 0 < r < k. */
export function checkVecmRequirements(data: number[][], names: string[], kArDiff = 1): VecmRequirements {
  const reasons: string[] = [];
  const integration = names.map((name, j) => {
    const col = data.map((r) => r[j]);
    const lv = stationarity(col, "c");
    const df = stationarity(col.slice(1).map((v, t) => v - col[t]), "c");
    // I(1): ADF no rechaza la raíz unitaria en niveles y las diferencias no tienen raíz unitaria.
    const levelsI0 = lv.adf.p < 0.05;
    const i1 = !levelsI0 && df.verdict !== "unit_root";
    if (!i1) {
      reasons.push(
        levelsI0
          ? `${name} es estacionaria en niveles según ADF (I(0)): no corresponde un VECM con ella.`
          : `${name} no es estacionaria tampoco en primeras diferencias (podría ser I(2)).`,
      );
    }
    return { name, levels: lv.verdict, diffs: df.verdict, i1 };
  });
  let joh: JohansenResult | null = null;
  try {
    joh = johansen(data, 0, kArDiff);
    if (joh.rank === 0) reasons.push("La prueba de traza no encuentra cointegración (r = 0): usá un VAR en diferencias.");
    if (joh.rank === names.length) reasons.push("La prueba de traza indica rango completo (r = k): las series serían estacionarias; usá un VAR en niveles.");
  } catch (e) {
    reasons.push((e as Error).message);
  }
  return { ok: reasons.length === 0, integration, johansen: joh, reasons };
}
