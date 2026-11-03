/**
 * Optimización sin derivadas (Nelder-Mead adaptativo, Gao y Han 2012) y
 * hessiana numérica por diferencias centrales.
 */

export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number; step?: number } = {},
): { x: number[]; fx: number; iterations: number } {
  const n = x0.length;
  if (n === 0) return { x: [], fx: f([]), iterations: 0 };
  const maxIter = opts.maxIter ?? 2000 * n;
  const tol = opts.tol ?? 1e-10;
  const step = opts.step ?? 0.1;
  const alpha = 1;
  const beta = 1 + 2 / n;
  const gamma = 0.75 - 1 / (2 * n);
  const delta = 1 - 1 / n;
  const safe = (x: number[]) => {
    const v = f(x);
    return Number.isFinite(v) ? v : Infinity;
  };
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] = x[i] !== 0 ? x[i] * (1 + step) : step;
    simplex.push(x);
  }
  let values = simplex.map(safe);
  let it = 0;
  for (; it < maxIter; it++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    const spread = Math.abs(values[n] - values[0]);
    const size = Math.max(...simplex.slice(1).map((x) => Math.max(...x.map((v, j) => Math.abs(v - simplex[0][j])))));
    if (spread <= tol * (Math.abs(values[0]) + tol) && size <= 1e-8 * (1 + Math.max(...simplex[0].map(Math.abs)))) break;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const xr = centroid.map((c, j) => c + alpha * (c - worst[j]));
    const fr = safe(xr);
    if (fr < values[0]) {
      const xe = centroid.map((c, j) => c + beta * (xr[j] - c));
      const fe = safe(xe);
      if (fe < fr) {
        simplex[n] = xe;
        values[n] = fe;
      } else {
        simplex[n] = xr;
        values[n] = fr;
      }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr;
      values[n] = fr;
    } else {
      const outside = fr < values[n];
      const xc = outside
        ? centroid.map((c, j) => c + gamma * (xr[j] - c))
        : centroid.map((c, j) => c + gamma * (worst[j] - c));
      const fc = safe(xc);
      if (fc < (outside ? fr : values[n])) {
        simplex[n] = xc;
        values[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[0].map((b, j) => b + delta * (simplex[i][j] - b));
          values[i] = safe(simplex[i]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (values[i] < values[best]) best = i;
  return { x: simplex[best], fx: values[best], iterations: it };
}

/** Minimiza con reinicios (Nelder-Mead tiende a estancarse en un primer intento). */
export function minimize(f: (x: number[]) => number, starts: number[][], restarts = 3) {
  let best: { x: number[]; fx: number } | null = null;
  for (const s of starts) {
    let r = nelderMead(f, s);
    for (let i = 0; i < restarts; i++) {
      const again = nelderMead(f, r.x, { step: 0.05 });
      if (again.fx >= r.fx - 1e-12) break;
      r = again;
    }
    if (!best || r.fx < best.fx) best = r;
  }
  return best!;
}

/** Hessiana numérica (diferencias centrales). */
export function hessian(f: (x: number[]) => number, x: number[]): number[][] {
  const n = x.length;
  const h = x.map((v) => 1e-4 * Math.max(Math.abs(v), 1e-2));
  const H = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const fx = f(x);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        const xp = x.slice();
        const xm = x.slice();
        xp[i] += h[i];
        xm[i] -= h[i];
        H[i][i] = (f(xp) - 2 * fx + f(xm)) / (h[i] * h[i]);
      } else {
        const pp = x.slice();
        const pm = x.slice();
        const mp = x.slice();
        const mm = x.slice();
        pp[i] += h[i];
        pp[j] += h[j];
        pm[i] += h[i];
        pm[j] -= h[j];
        mp[i] -= h[i];
        mp[j] += h[j];
        mm[i] -= h[i];
        mm[j] -= h[j];
        H[i][j] = H[j][i] = (f(pp) - f(pm) - f(mp) + f(mm)) / (4 * h[i] * h[j]);
      }
    }
  }
  return H;
}
