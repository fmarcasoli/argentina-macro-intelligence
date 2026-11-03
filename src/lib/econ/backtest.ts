import type { Frequency } from "../connectors/types";
import { runForecast, type ForecastSpec } from "./forecast";

/**
 * Backtesting (evaluación histórica de pronósticos) con origen móvil y
 * ventana expansiva: en cada fecha de origen el modelo se estima SOLO con los
 * datos disponibles hasta ese momento, se pronostica h períodos y se compara
 * con lo observado después.
 *
 * Información futura: el entrenamiento se corta en el origen (incluida la
 * selección automática del modelo, que se rehace en cada origen). Para las
 * revisiones estadísticas, si se provee `vintage`, en cada origen se usa la
 * serie tal como estaba publicada en ese momento (reconstruida con el
 * historial de revisiones); si no, se usan los datos vigentes y se advierte.
 */

export class BacktestError extends Error {}

export interface VintageProvider {
  /** Serie disponible al momento en que se publicó la observación `originDate`, o null si no hay registro. */
  (originDate: string): { dates: string[]; y: number[] } | null;
}

export interface BacktestSpec {
  forecast: ForecastSpec;
  /** Primer origen (fecha de la última observación usada en la primera estimación). */
  start: string;
  /** Cada cuántos períodos se mueve el origen. */
  step?: number;
  /** Observaciones mínimas de entrenamiento. */
  minTrain?: number;
}

export interface ErrorStats {
  n: number;
  mae: number;
  rmse: number;
  /** null cuando no es apropiado (valores cercanos a cero o cambio de signo). */
  mape: number | null;
  /** Sesgo medio: promedio de (pronóstico − observado). Positivo = sobreestima. */
  bias: number;
}

export interface BacktestResult {
  origins: number;
  horizon: number;
  /** Errores por horizonte (1…h). */
  byHorizon: (ErrorStats & { h: number; naiveRmse: number | null; relRmse: number | null })[];
  overall: ErrorStats & { naiveRmse: number | null; relRmse: number | null };
  /** Detalle de cada pronóstico. */
  records: { origin: string; target: string; h: number; forecast: number; actual: number; lower95: number | null; upper95: number | null; vintage: boolean }[];
  /** Cobertura empírica de la banda del 95 %. */
  coverage95: number | null;
  mapeNote: string | null;
  failures: { origin: string; error: string }[];
  notes: string[];
}

export function errorStats(fc: number[], actual: number[]): Omit<ErrorStats, "mape"> & { mape: number } {
  const n = fc.length;
  let ae = 0;
  let se = 0;
  let ape = 0;
  let bias = 0;
  for (let i = 0; i < n; i++) {
    const e = fc[i] - actual[i];
    ae += Math.abs(e);
    se += e * e;
    ape += Math.abs(e / actual[i]);
    bias += e;
  }
  return { n, mae: ae / n, rmse: Math.sqrt(se / n), mape: (ape / n) * 100, bias: bias / n };
}

/** MAPE solo tiene sentido si la serie es positiva (o negativa) y lejos de cero. */
export function mapeAppropriate(actual: number[]): string | null {
  const pos = actual.every((v) => v > 0);
  const neg = actual.every((v) => v < 0);
  if (!pos && !neg) return "MAPE no es apropiado: la serie toma valores de distinto signo o iguales a cero.";
  const absMean = actual.reduce((a, v) => a + Math.abs(v), 0) / actual.length;
  if (Math.min(...actual.map(Math.abs)) < 0.05 * absMean) {
    return "MAPE no es apropiado: hay valores muy cercanos a cero que inflan los errores porcentuales.";
  }
  return null;
}

export function backtest(
  dates: string[],
  y: number[],
  freq: Frequency,
  spec: BacktestSpec,
  opts: { exog?: number[][]; exogNames?: string[]; varNames?: string[]; vintage?: VintageProvider; maxOrigins?: number } = {},
): BacktestResult {
  const h = spec.forecast.horizon;
  const step = spec.step ?? 1;
  const minTrain = spec.minTrain ?? 24;
  if (spec.forecast.method === "regression") {
    throw new BacktestError("El backtesting de una regresión requeriría conocer las explicativas futuras (información futura): usá un modelo univariado o un VAR.");
  }
  let first = dates.findIndex((d) => d >= spec.start);
  if (first < 0) throw new BacktestError("La fecha de inicio es posterior al último dato");
  first = Math.max(first, minTrain - 1);
  const originIdx: number[] = [];
  for (let i = first; i < dates.length - 1; i += step) originIdx.push(i);
  if (!originIdx.length) throw new BacktestError("No hay orígenes con datos posteriores para comparar");
  if (opts.maxOrigins && originIdx.length > opts.maxOrigins) {
    throw new BacktestError(`Demasiados orígenes (${originIdx.length}): aumentá el paso o acortá el período (máximo ${opts.maxOrigins}).`);
  }

  const records: BacktestResult["records"] = [];
  const failures: BacktestResult["failures"] = [];
  const naive: { h: number; fc: number; actual: number }[] = [];
  let usedVintages = 0;
  for (const i of originIdx) {
    const origin = dates[i];
    // Entrenamiento: SOLO hasta el origen.
    let trainDates = dates.slice(0, i + 1);
    let trainY = y.slice(0, i + 1);
    let fromVintage = false;
    const v = opts.vintage?.(origin);
    if (v && v.dates.length && v.dates[v.dates.length - 1] <= origin) {
      trainDates = v.dates;
      trainY = v.y;
      fromVintage = true;
      usedVintages++;
    }
    const exog = opts.exog?.map((c) => c.slice(0, i + 1));
    try {
      if (trainDates.length < minTrain) throw new BacktestError("Entrenamiento insuficiente");
      const r = runForecast(trainDates, trainY, freq, { ...spec.forecast, levels: [0.95], fast: true }, { exog, exogNames: opts.exogNames, varNames: opts.varNames });
      for (let s = 1; s <= h && i + s < dates.length; s++) {
        const p = r.points[s - 1];
        records.push({
          origin,
          target: dates[i + s],
          h: s,
          forecast: p.mean,
          actual: y[i + s],
          lower95: p.bands[0]?.lower ?? null,
          upper95: p.bands[0]?.upper ?? null,
          vintage: fromVintage,
        });
        naive.push({ h: s, fc: trainY[trainY.length - 1], actual: y[i + s] });
      }
    } catch (e) {
      failures.push({ origin, error: (e as Error).message });
    }
  }
  if (!records.length) throw new BacktestError(`Ningún pronóstico pudo estimarse${failures[0] ? `: ${failures[0].error}` : ""}`);

  const actualAll = records.map((r) => r.actual);
  const mapeNote = mapeAppropriate(actualAll);
  const withMape = <T extends { mape: number }>(s: T) => ({ ...s, mape: mapeNote ? null : s.mape });
  const naiveFor = (hh: number | null) => {
    const sel = naive.filter((x) => hh === null || x.h === hh);
    if (!sel.length) return null;
    return Math.sqrt(sel.reduce((a, x) => a + (x.fc - x.actual) ** 2, 0) / sel.length);
  };
  const byHorizon: BacktestResult["byHorizon"] = [];
  for (let s = 1; s <= h; s++) {
    const sel = records.filter((r) => r.h === s);
    if (!sel.length) continue;
    const st = withMape(errorStats(sel.map((r) => r.forecast), sel.map((r) => r.actual)));
    const nr = naiveFor(s);
    byHorizon.push({ h: s, ...st, naiveRmse: nr, relRmse: nr ? st.rmse / nr : null });
  }
  const ov = withMape(errorStats(records.map((r) => r.forecast), actualAll));
  const nrAll = naiveFor(null);
  const covered = records.filter((r) => r.lower95 !== null && r.upper95 !== null);
  const notes: string[] = [
    "En cada origen el modelo se reestima solo con datos hasta esa fecha (ventana expansiva); la selección automática del modelo también se rehace en cada origen.",
    "Error relativo = RMSE del modelo / RMSE de un paseo aleatorio (último valor): < 1 indica que el modelo mejora al pronóstico ingenuo.",
  ];
  if (usedVintages === originIdx.length) {
    notes.push("Se usaron las versiones de los datos publicadas en cada fecha (vintages), reconstruidas con el historial de revisiones.");
  } else if (usedVintages > 0) {
    notes.push(`Se usaron vintages en ${usedVintages} de ${originIdx.length} orígenes; en el resto, los datos vigentes (no hay registro de la versión publicada en esa fecha).`);
  } else {
    notes.push(
      "Se usan los datos vigentes (última revisión publicada): no hay registro de las versiones publicadas en esas fechas. En series que se revisan (EMAE, PIB, comercio exterior) el desempeño puede verse algo mejor que el que se habría obtenido en tiempo real.",
    );
  }
  return {
    origins: originIdx.length,
    horizon: h,
    byHorizon,
    overall: { ...ov, naiveRmse: nrAll, relRmse: nrAll ? ov.rmse / nrAll : null },
    records,
    coverage95: covered.length ? covered.filter((r) => r.actual >= r.lower95! && r.actual <= r.upper95!).length / covered.length : null,
    mapeNote,
    failures,
    notes,
  };
}

// ── Vintages ────────────────────────────────────────────────────────────────

export interface VintageObservation {
  d: string;
  v: number | null;
  /** Fecha (ISO) en que el dato estuvo disponible: publicación informada por la fuente o primera vez visto. */
  availableAt: string;
}

export interface Revision {
  d: string;
  oldValue: number | null;
  revisedAt: string;
}

/**
 * Reconstruye la serie tal como estaba publicada en `asOf`: excluye datos
 * aún no disponibles y, si un valor fue revisado después, usa el valor previo.
 */
export function seriesAsOf(obs: VintageObservation[], revisions: Revision[], asOf: string): { d: string; v: number | null }[] {
  const firstRevAfter = new Map<string, Revision>();
  for (const r of [...revisions].sort((a, b) => a.revisedAt.localeCompare(b.revisedAt))) {
    if (r.revisedAt > asOf && !firstRevAfter.has(r.d)) firstRevAfter.set(r.d, r);
  }
  return obs
    .filter((o) => o.availableAt <= asOf)
    .map((o) => ({ d: o.d, v: firstRevAfter.has(o.d) ? firstRevAfter.get(o.d)!.oldValue : o.v }));
}
