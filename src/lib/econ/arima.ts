import { ljungBox, type LjungBox, acovf, durbinLevinson } from "./acf";
import { normalInv, tPValue } from "./dist";
import { inverse } from "./linalg";
import { hessian, minimize } from "./optimize";
import { kpss } from "./unitroot";

/**
 * Modelos ARIMA(p, d, q) estimados por máxima verosimilitud exacta
 * (filtro de Kalman sobre la representación en espacio de estados de Harvey).
 *
 *   (1 − φ₁L − … − φ_pL^p)(1 − L)^d (y_t) = c + (1 + θ₁L + … + θ_qL^q) ε_t
 *
 * La estacionariedad y la invertibilidad se imponen reparametrizando con
 * autocorrelaciones parciales (Monahan, 1984; Jones, 1980), como statsmodels.
 *
 * Supuestos: ε_t ruido blanco gaussiano con varianza constante; parámetros
 * estables en la muestra. Limitaciones: no captura quiebres estructurales,
 * cambios de régimen ni no linealidades; las bandas reflejan solo la
 * incertidumbre del ruido del modelo, no la de los parámetros ni la del modelo.
 */

export class ArimaError extends Error {}

export interface ArimaOrder {
  p: number;
  d: number;
  q: number;
}

export interface ArimaParam {
  name: string;
  value: number;
  se: number | null;
  z: number | null;
  p: number | null;
}

export interface ArimaModel {
  order: ArimaOrder;
  constant: boolean;
  /** Media (d = 0) o deriva (d ≥ 1) de la serie diferenciada. */
  mu: number;
  phi: number[];
  theta: number[];
  sigma2: number;
  params: ArimaParam[];
  llf: number;
  aic: number;
  aicc: number;
  bic: number;
  /** Observaciones usadas en la verosimilitud (n − d). */
  nobs: number;
  /** Innovaciones (errores de pronóstico a un paso) de la serie diferenciada. */
  residuals: number[];
  ljungBox: LjungBox | null;
  /** Estado del filtro al final de la muestra (para pronosticar). */
  state: { a: number[]; P: number[][] };
  /** Últimos valores de y y de sus diferencias (para integrar los pronósticos). */
  lastLevels: number[];
  warnings: string[];
}

// ── Reparametrización ────────────────────────────────────────────────────────

/** u ∈ ℝ^p → coeficientes AR estacionarios (vía autocorrelaciones parciales). */
export function constrainStationary(u: number[]): number[] {
  let phi: number[] = [];
  for (let k = 0; k < u.length; k++) {
    const r = u[k] / Math.sqrt(1 + u[k] * u[k]);
    const next = phi.map((p, j) => p - r * phi[k - 1 - j]);
    next.push(r);
    phi = next;
  }
  return phi;
}

/** Inversa: coeficientes AR estacionarios → u. Devuelve null si no son estacionarios. */
export function unconstrainStationary(phi: number[]): number[] | null {
  let cur = phi.slice();
  const r: number[] = new Array(phi.length);
  for (let k = phi.length; k >= 1; k--) {
    const rk = cur[k - 1];
    if (!(Math.abs(rk) < 1)) return null;
    r[k - 1] = rk;
    const prev: number[] = [];
    for (let j = 0; j < k - 1; j++) prev.push((cur[j] + rk * cur[k - 2 - j]) / (1 - rk * rk));
    cur = prev;
  }
  return r.map((x) => x / Math.sqrt(1 - x * x));
}

// ── Filtro de Kalman ─────────────────────────────────────────────────────────

interface FilterOut {
  llf: number;
  sigma2: number;
  resid: number[];
  a: number[];
  P: number[][];
}

/** Resuelve A x = b por eliminación gaussiana con pivoteo (A densa, n×n, en un arreglo plano). */
function gaussSolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[piv * n + c])) piv = r;
    if (Math.abs(A[piv * n + c]) < 1e-14) return null;
    if (piv !== c) {
      for (let j = 0; j < n; j++) {
        const t = A[c * n + j];
        A[c * n + j] = A[piv * n + j];
        A[piv * n + j] = t;
      }
      const t = b[c];
      b[c] = b[piv];
      b[piv] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (f === 0) continue;
      for (let j = c; j < n; j++) A[r * n + j] -= f * A[c * n + j];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return x;
}

/**
 * Filtro de Kalman para un ARMA en la forma de Harvey (matriz de transición
 * compañera). Usa la estructura de T para operar en O(r²) por período y deja
 * de actualizar la covarianza cuando converge al estado estacionario
 * (resultado idéntico, mucho más rápido).
 */
function armaFilter(z: number[], phi: number[], theta: number[]): FilterOut | null {
  const p = phi.length;
  const q = theta.length;
  const r = Math.max(p, q + 1);
  const ph = new Float64Array(r);
  for (let i = 0; i < p; i++) ph[i] = phi[i];
  const R = new Float64Array(r);
  R[0] = 1;
  for (let i = 1; i < r; i++) R[i] = theta[i - 1] ?? 0;
  // P0: P = T P T' + R R' → (I − T⊗T) vec(P) = vec(RR')
  const r2 = r * r;
  const A = new Float64Array(r2 * r2);
  const rhs = new Float64Array(r2);
  const Tm = (i: number, j: number) => (j === 0 ? ph[i] : j === i + 1 ? 1 : 0);
  for (let i = 0; i < r; i++)
    for (let j = 0; j < r; j++) {
      const row = i * r + j;
      rhs[row] = R[i] * R[j];
      for (let k = 0; k < r; k++)
        for (let l = 0; l < r; l++) A[row * r2 + k * r + l] = (row === k * r + l ? 1 : 0) - Tm(i, k) * Tm(j, l);
    }
  const P0 = gaussSolve(A, rhs, r2);
  if (!P0) return null;
  let P: Float64Array = P0;
  let Pn: Float64Array = new Float64Array(r2);
  const TP = new Float64Array(r2);
  const K = new Float64Array(r);
  const a = new Float64Array(r);
  const an = new Float64Array(r);
  let steady = false;
  let sumLogF = 0;
  let sumSq = 0;
  const resid: number[] = new Array(z.length);
  for (let t = 0; t < z.length; t++) {
    const v = z[t] - a[0];
    const F = P[0];
    if (!(F > 0)) return null;
    sumLogF += Math.log(F);
    sumSq += (v * v) / F;
    resid[t] = v;
    // K = T P[:,0] / F, con (T x)_i = φ_i x_0 + x_{i+1}
    for (let i = 0; i < r; i++) K[i] = (ph[i] * P[0] + (i + 1 < r ? P[(i + 1) * r] : 0)) / F;
    for (let i = 0; i < r; i++) an[i] = ph[i] * a[0] + (i + 1 < r ? a[i + 1] : 0) + K[i] * v;
    a.set(an);
    if (steady) continue;
    // TP = T P;  P' = (TP) T' + RR' − K K' F
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) TP[i * r + j] = ph[i] * P[j] + (i + 1 < r ? P[(i + 1) * r + j] : 0);
    let diff = 0;
    for (let i = 0; i < r; i++)
      for (let j = 0; j < r; j++) {
        const val = TP[i * r] * ph[j] + (j + 1 < r ? TP[i * r + j + 1] : 0) + R[i] * R[j] - K[i] * K[j] * F;
        Pn[i * r + j] = val;
        diff = Math.max(diff, Math.abs(val - P[i * r + j]));
      }
    const tmp = P;
    P = Pn;
    Pn = tmp === P0 ? new Float64Array(r2) : tmp;
    if (diff < 1e-13 * (1 + Math.abs(P[0]))) steady = true;
  }
  const n = z.length;
  const sigma2 = sumSq / n;
  const llf = -(n / 2) * (Math.log(2 * Math.PI) + 1 + Math.log(sigma2)) - 0.5 * sumLogF;
  return {
    llf,
    sigma2,
    resid,
    a: Array.from(a),
    P: Array.from({ length: r }, (_, i) => Array.from(P.subarray(i * r, i * r + r))),
  };
}

export function difference(y: number[], d: number): number[] {
  let w = y.slice();
  for (let i = 0; i < d; i++) w = w.slice(1).map((v, j) => v - w[j]);
  return w;
}

/** Ajusta un ARIMA(p, d, q). `constant`: media (d = 0) o deriva (d = 1). */
export function fitArima(y: number[], order: ArimaOrder, opts: { constant?: boolean; computeSe?: boolean } = {}): ArimaModel {
  const { p, d, q } = order;
  if ([p, d, q].some((v) => !Number.isInteger(v) || v < 0)) throw new ArimaError("Los órdenes deben ser enteros no negativos");
  if (d > 2) throw new ArimaError("Se admiten hasta dos diferencias (d ≤ 2)");
  if (p > 6 || q > 6) throw new ArimaError("Se admiten órdenes p, q ≤ 6");
  if (y.some((v) => !Number.isFinite(v))) throw new ArimaError("La serie tiene valores faltantes: ARIMA exige observaciones consecutivas");
  const constant = opts.constant ?? d < 2;
  if (constant && d >= 2) throw new ArimaError("Con dos diferencias no se incluye constante (implicaría una tendencia cuadrática)");
  const w = difference(y, d);
  const n = w.length;
  const k = (constant ? 1 : 0) + p + q;
  if (n < Math.max(10, 3 * (k + 1))) throw new ArimaError(`Muy pocas observaciones (${n}) para un ARIMA(${p},${d},${q})`);

  const wm = w.reduce((a, b) => a + b, 0) / n;
  const ws = Math.sqrt(w.reduce((s, v) => s + (v - wm) ** 2, 0) / n) || 1;
  const unpack = (x: number[]) => {
    let i = 0;
    const mu = constant ? wm + ws * x[i++] : 0;
    const phi = constrainStationary(x.slice(i, i + p));
    i += p;
    const theta = constrainStationary(x.slice(i, i + q)).map((v) => -v);
    return { mu, phi, theta };
  };
  const negLlf = (x: number[]) => {
    const { mu, phi, theta } = unpack(x);
    const f = armaFilter(w.map((v) => v - mu), phi, theta);
    return f ? -f.llf : Infinity;
  };

  // Valores iniciales: ceros y Yule-Walker para la parte AR.
  const starts: number[][] = [new Array<number>(k).fill(0)];
  if (p > 0) {
    const yw = durbinLevinson(acovf(w, p), p);
    const u = unconstrainStationary(yw.phi);
    if (u) starts.push([...(constant ? [0] : []), ...u.map((v) => v * 0.9), ...new Array<number>(q).fill(0)]);
  }
  const best = minimize(negLlf, starts);
  const { mu, phi, theta } = unpack(best.x);
  const f = armaFilter(w.map((v) => v - mu), phi, theta)!;

  // Errores estándar: hessiana numérica de la log-verosimilitud perfilada
  // en los parámetros naturales (μ, φ, θ).
  const natural = [...(constant ? [mu] : []), ...phi, ...theta];
  const names = [...(constant ? [d === 0 ? "Constante (media)" : "Deriva"] : []), ...phi.map((_, i) => `AR(${i + 1})`), ...theta.map((_, i) => `MA(${i + 1})`)];
  const negLlfNatural = (x: number[]) => {
    let i = 0;
    const m = constant ? x[i++] : 0;
    const ph = x.slice(i, i + p);
    const th = x.slice(i + p, i + p + q);
    const out = armaFilter(w.map((v) => v - m), ph, th);
    return out ? -out.llf : Infinity;
  };
  const warnings: string[] = [];
  let ses: (number | null)[] = natural.map(() => null);
  if (natural.length && opts.computeSe !== false) {
    try {
      const cov = inverse(hessian(negLlfNatural, natural));
      ses = cov.map((r, i) => (r[i] > 0 ? Math.sqrt(r[i]) : null));
      if (ses.some((s) => s === null)) warnings.push("La hessiana no es definida positiva: algunos errores estándar no están disponibles (posible sobreparametrización).");
    } catch {
      warnings.push("No se pudieron calcular los errores estándar (hessiana singular): el modelo puede estar sobreparametrizado.");
    }
  }
  const params: ArimaParam[] = natural.map((v, i) => {
    const se = ses[i];
    const z = se ? v / se : null;
    return { name: names[i], value: v, se, z, p: z === null ? null : tPValue(z, Infinity) };
  });
  params.push({ name: "σ² (varianza de innovaciones)", value: f.sigma2, se: null, z: null, p: null });

  // Raíces cercanas al círculo unitario.
  if (phi.length && Math.abs(phi.reduce((a, b) => a + b, 0)) > 0.98) {
    warnings.push("La suma de coeficientes AR está cerca de 1: posible raíz unitaria no modelada (considerá diferenciar).");
  }
  if (theta.length && Math.abs(theta.reduce((a, b) => a + b, 0) + 1) < 0.02) {
    warnings.push("La parte MA está cerca de no ser invertible: posible sobrediferenciación.");
  }

  const kAll = k + 1; // + σ²
  const llf = f.llf;
  const lbLags = Math.min(10, Math.floor(n / 5));
  const lastLevels: number[] = [];
  let cur = y.slice();
  for (let i = 0; i < d; i++) {
    lastLevels.push(cur[cur.length - 1]);
    cur = cur.slice(1).map((v, j) => v - cur[j]);
  }
  return {
    order,
    constant,
    mu,
    phi,
    theta,
    sigma2: f.sigma2,
    params,
    llf,
    aic: -2 * llf + 2 * kAll,
    aicc: -2 * llf + 2 * kAll + (2 * kAll * (kAll + 1)) / Math.max(1, n - kAll - 1),
    bic: -2 * llf + Math.log(n) * kAll,
    nobs: n,
    residuals: f.resid,
    ljungBox: lbLags >= 2 && lbLags > p + q ? ljungBox(f.resid, lbLags, p + q) : null,
    state: { a: f.a, P: f.P },
    lastLevels,
    warnings,
  };
}

/** Pesos ψ del ARIMA completo (incluye las diferencias) para la varianza del pronóstico. */
export function psiWeights(phi: number[], theta: number[], d: number, h: number): number[] {
  // a(L) = (1 − φ₁L − …)(1 − L)^d
  let a = [1, ...phi.map((v) => -v)];
  for (let i = 0; i < d; i++) {
    const next = new Array<number>(a.length + 1).fill(0);
    a.forEach((c, j) => {
      next[j] += c;
      next[j + 1] -= c;
    });
    a = next;
  }
  const phiStar = a.slice(1).map((v) => -v);
  const psi = [1];
  for (let j = 1; j < h; j++) {
    let s = theta[j - 1] ?? 0;
    for (let i = 1; i <= Math.min(j, phiStar.length); i++) s += phiStar[i - 1] * psi[j - i];
    psi.push(s);
  }
  return psi;
}

export interface Forecast {
  mean: number[];
  se: number[];
  /** Bandas por nivel de confianza (p.ej. 0,8 y 0,95). */
  bands: { level: number; lower: number[]; upper: number[] }[];
}

/** Pronóstico h pasos con bandas (normales) para los niveles pedidos. */
export function forecastArima(m: ArimaModel, h: number, levels: number[] = [0.8, 0.95]): Forecast {
  const { phi, theta, mu } = m;
  const r = m.state.a.length;
  const T: number[][] = Array.from({ length: r }, (_, i) => Array.from({ length: r }, (_, j) => (j === 0 ? (phi[i] ?? 0) : 0)));
  for (let i = 0; i < r - 1; i++) T[i][i + 1] = 1;
  let a = m.state.a.slice();
  const wf: number[] = [];
  for (let s = 0; s < h; s++) {
    wf.push(mu + a[0]);
    a = T.map((row) => row.reduce((acc, x, j) => acc + x * a[j], 0));
  }
  // Integrar d veces.
  let series = wf;
  for (let k = m.order.d - 1; k >= 0; k--) {
    let last = m.lastLevels[k];
    series = series.map((v) => (last = last + v));
  }
  const psi = psiWeights(phi, theta, m.order.d, h);
  const se: number[] = [];
  let acc = 0;
  for (let j = 0; j < h; j++) {
    acc += psi[j] * psi[j];
    se.push(Math.sqrt(m.sigma2 * acc));
  }
  return {
    mean: series,
    se,
    bands: levels.map((level) => {
      const z = normalInv(1 - (1 - level) / 2);
      return { level, lower: series.map((v, i) => v - z * se[i]), upper: series.map((v, i) => v + z * se[i]) };
    }),
  };
}

/** Número de diferencias sugerido por KPSS sucesivas al 5 % (como auto.arima). */
export function suggestDifferences(y: number[], maxD = 2): number {
  let w = y.slice();
  for (let d = 0; d < maxD; d++) {
    if (w.length < 12) return d;
    const k = kpss(w, { regression: "c" });
    if (k.stat <= k.crit["5%"]) return d;
    w = difference(w, 1);
  }
  return maxD;
}

export interface AutoArimaResult {
  best: ArimaModel;
  tried: { order: ArimaOrder; aicc: number | null; error?: string }[];
}

/** Selección automática: d por KPSS y (p, q) por AICc en una grilla. */
export function autoArima(y: number[], opts: { maxP?: number; maxQ?: number; d?: number; computeSe?: boolean } = {}): AutoArimaResult {
  const d = opts.d ?? suggestDifferences(y);
  const maxP = opts.maxP ?? 3;
  const maxQ = opts.maxQ ?? 3;
  const tried: AutoArimaResult["tried"] = [];
  let best: ArimaModel | null = null;
  for (let p = 0; p <= maxP; p++)
    for (let q = 0; q <= maxQ; q++) {
      const order = { p, d, q };
      try {
        // En la grilla no hacen falta errores estándar: solo el criterio.
        const m = fitArima(y, order, { constant: d < 2, computeSe: false });
        tried.push({ order, aicc: m.aicc });
        if (!best || m.aicc < best.aicc) best = m;
      } catch (e) {
        tried.push({ order, aicc: null, error: (e as Error).message });
      }
    }
  if (!best) throw new ArimaError("Ningún modelo de la grilla pudo estimarse");
  if (opts.computeSe === false) return { best, tried };
  return { best: fitArima(y, best.order, { constant: best.constant }), tried };
}
