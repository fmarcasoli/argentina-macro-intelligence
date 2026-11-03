/**
 * Álgebra lineal mínima para el motor econométrico (sin dependencias).
 * Matrices densas como number[][] (filas). Tamaños típicos: decenas de
 * columnas y miles de filas, así que se prioriza la claridad y la estabilidad
 * numérica (QR de Householder, pivoteo parcial) sobre la velocidad.
 */

export type Matrix = number[][];
export type Vector = number[];

export class LinAlgError extends Error {}

export const zeros = (r: number, c: number): Matrix => Array.from({ length: r }, () => new Array<number>(c).fill(0));

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

export const transpose = (a: Matrix): Matrix =>
  a.length === 0 ? [] : a[0].map((_, j) => a.map((row) => row[j]));

export function matmul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = b[0]?.length ?? 0;
  const k = b.length;
  if ((a[0]?.length ?? 0) !== k) throw new LinAlgError(`Dimensiones incompatibles: ${n}×${a[0]?.length} · ${k}×${m}`);
  const out = zeros(n, m);
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    const oi = out[i];
    for (let p = 0; p < k; p++) {
      const v = ai[p];
      if (v === 0) continue;
      const bp = b[p];
      for (let j = 0; j < m; j++) oi[j] += v * bp[j];
    }
  }
  return out;
}

export const matvec = (a: Matrix, x: Vector): Vector => a.map((row) => dot(row, x));

export function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export const add = (a: Matrix, b: Matrix): Matrix => a.map((r, i) => r.map((v, j) => v + b[i][j]));
export const sub = (a: Matrix, b: Matrix): Matrix => a.map((r, i) => r.map((v, j) => v - b[i][j]));
export const scale = (a: Matrix, s: number): Matrix => a.map((r) => r.map((v) => v * s));

/** X'X sin formar la transpuesta. */
export function crossprod(x: Matrix, y: Matrix = x): Matrix {
  const k = x[0]?.length ?? 0;
  const m = y[0]?.length ?? 0;
  const out = zeros(k, m);
  for (let t = 0; t < x.length; t++) {
    const xt = x[t];
    const yt = y[t];
    for (let i = 0; i < k; i++) {
      const v = xt[i];
      if (v === 0) continue;
      const oi = out[i];
      for (let j = 0; j < m; j++) oi[j] += v * yt[j];
    }
  }
  return out;
}

/** Inversa por Gauss-Jordan con pivoteo parcial. */
export function inverse(a: Matrix): Matrix {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...identity(n)[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    const scaleRef = Math.max(...a.map((r) => Math.abs(r[c])), 1e-300);
    if (Math.abs(m[piv][c]) < 1e-13 * scaleRef) throw new LinAlgError("Matriz singular (colinealidad perfecta)");
    [m[c], m[piv]] = [m[piv], m[c]];
    const pv = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r) => r.slice(n));
}

/** Resuelve A x = b (A cuadrada). */
export const solve = (a: Matrix, b: Vector): Vector => matvec(inverse(a), b);

/** Cholesky: A = L L' (A simétrica definida positiva). */
export function cholesky(a: Matrix): Matrix {
  const n = a.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k];
      if (i === j) {
        if (s <= 0) throw new LinAlgError("La matriz no es definida positiva");
        l[i][i] = Math.sqrt(s);
      } else {
        l[i][j] = s / l[j][j];
      }
    }
  }
  return l;
}

/** log|det A| y signo, por eliminación con pivoteo. */
export function logDet(a: Matrix): { sign: number; logAbs: number } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  let sign = 1;
  let logAbs = 0;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (m[piv][c] === 0) return { sign: 0, logAbs: -Infinity };
    if (piv !== c) {
      [m[c], m[piv]] = [m[piv], m[c]];
      sign = -sign;
    }
    const pv = m[c][c];
    if (pv < 0) sign = -sign;
    logAbs += Math.log(Math.abs(pv));
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / pv;
      if (f === 0) continue;
      for (let j = c; j < n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return { sign, logAbs };
}

/**
 * Mínimos cuadrados por QR de Householder (estable aun con regresores en
 * escalas muy distintas). Devuelve β y (R'R)^{-1} = (X'X)^{-1}.
 */
export function leastSquares(x: Matrix, y: Vector): { beta: Vector; xtxInv: Matrix; rank: number } {
  const n = x.length;
  const k = x[0]?.length ?? 0;
  if (n < k) throw new LinAlgError(`Hay menos observaciones (${n}) que parámetros (${k})`);
  const a = x.map((r) => [...r]);
  const b = [...y];
  const diag: number[] = [];
  // Escala de columnas para el umbral de rango.
  const colNorm = Array.from({ length: k }, (_, j) => Math.sqrt(a.reduce((s, r) => s + r[j] * r[j], 0)));
  for (let j = 0; j < k; j++) {
    let norm = 0;
    for (let i = j; i < n; i++) norm += a[i][j] * a[i][j];
    norm = Math.sqrt(norm);
    if (norm <= 1e-12 * Math.max(colNorm[j], 1e-300)) {
      throw new LinAlgError("Colinealidad perfecta entre regresores: quitá alguna variable o rezago");
    }
    const alpha = a[j][j] > 0 ? -norm : norm;
    const v = new Array<number>(n).fill(0);
    v[j] = a[j][j] - alpha;
    for (let i = j + 1; i < n; i++) v[i] = a[i][j];
    let vv = 0;
    for (let i = j; i < n; i++) vv += v[i] * v[i];
    if (vv > 0) {
      for (let c = j; c < k; c++) {
        let s = 0;
        for (let i = j; i < n; i++) s += v[i] * a[i][c];
        const f = (2 * s) / vv;
        for (let i = j; i < n; i++) a[i][c] -= f * v[i];
      }
      let s = 0;
      for (let i = j; i < n; i++) s += v[i] * b[i];
      const f = (2 * s) / vv;
      for (let i = j; i < n; i++) b[i] -= f * v[i];
    }
    diag.push(a[j][j]);
  }
  // Retrosustitución R β = Q'y
  const beta = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < k; j++) s -= a[i][j] * beta[j];
    beta[i] = s / a[i][i];
  }
  // (R'R)^{-1} = R^{-1} R^{-T}
  const rInv = zeros(k, k);
  for (let i = k - 1; i >= 0; i--) {
    rInv[i][i] = 1 / a[i][i];
    for (let j = i + 1; j < k; j++) {
      let s = 0;
      for (let p = i + 1; p <= j; p++) s += a[i][p] * rInv[p][j];
      rInv[i][j] = -s / a[i][i];
    }
  }
  const xtxInv = matmul(rInv, transpose(rInv));
  return { beta, xtxInv, rank: diag.length };
}

/**
 * Autovalores y autovectores de una matriz simétrica (método de Jacobi
 * cíclico). Devuelve autovalores en orden descendente y autovectores como
 * columnas de `vectors`.
 */
export function symmetricEigen(a: Matrix): { values: Vector; vectors: Matrix } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] * m[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-300) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = m.map((_, i) => i).sort((i, j) => m[j][j] - m[i][i]);
  return {
    values: order.map((i) => m[i][i]),
    vectors: v.map((row) => order.map((i) => row[i])),
  };
}

/**
 * Radio espectral de una matriz cuadrada cualquiera (fórmula de Gelfand:
 * ρ(A) = lim ‖A^k‖^{1/k}, con k = 2^40 por cuadrados sucesivos normalizados).
 * Se usa para verificar la estabilidad de VAR/AR a partir de la matriz compañera.
 */
export function spectralRadius(a: Matrix): number {
  let m = a.map((r) => [...r]);
  let logScale = 0;
  let k = 1;
  for (let it = 0; it < 40; it++) {
    const norm = Math.max(...m.map((r) => r.reduce((s, v) => s + Math.abs(v), 0)));
    if (norm === 0) return 0;
    m = scale(m, 1 / norm);
    logScale += Math.log(norm) / k;
    m = matmul(m, m);
    k *= 2;
  }
  const norm = Math.max(...m.map((r) => r.reduce((s, v) => s + Math.abs(v), 0)));
  return Math.exp(logScale + (norm > 0 ? Math.log(norm) / k : -Infinity));
}

/** Kronecker A ⊗ B. */
export function kron(a: Matrix, b: Matrix): Matrix {
  const out = zeros(a.length * b.length, (a[0]?.length ?? 0) * (b[0]?.length ?? 0));
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < a[0].length; j++)
      for (let p = 0; p < b.length; p++)
        for (let q = 0; q < b[0].length; q++) out[i * b.length + p][j * b[0].length + q] = a[i][j] * b[p][q];
  return out;
}
