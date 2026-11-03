import type { Frequency } from "../connectors/types";
import type { Pt, SeriesData } from "../analysis/types";
import { defaultAggregation, FREQ_NAME, FREQ_RANK, lowestCommonFrequency, resample } from "../analysis/frequency";
import { acf, pacf } from "./acf";
import { autoArima, fitArima, forecastArima, type ArimaModel, type ArimaOrder } from "./arima";
import { backtest, seriesAsOf, type BacktestResult, type Revision, type VintageObservation } from "./backtest";
import { correlate, correlationMatrix, laggedCorrelations, rollingCorrelation, type CorrMethod } from "./correlation";
import { HP_LAMBDA, hpFilter, linearTrend, seasonalDecompose } from "./decompose";
import { runForecast, type ForecastSpec } from "./forecast";
import { buildDesign, ols, type CovType, type RegressorSpec } from "./regression";
import { simulateShock } from "./simulator";
import { ANNUAL_PERIODS, cagr, describe, movingAverage, rollingVolatility } from "./stats";
import { alignSeries, applyRecipe, describeRecipe, type TransformStep } from "./transforms";
import { adf, engleGranger, stationarity } from "./unitroot";
import { fevd, fitVar, forecastVar, grangerMatrix, impulseResponse, selectVarOrder } from "./var";
import { checkVecmRequirements, fitVecm, forecastVecm, johansen } from "./vecm";

/**
 * Tareas del motor econométrico. Se ejecutan en un Web Worker (fuera del hilo
 * de la interfaz y fuera de las funciones de Vercel): reciben series reales
 * con sus metadatos y devuelven resultados serializables.
 *
 * Toda tarea parte de un "dataset": series + receta de transformación por
 * serie + período + frecuencia. El dataset preparado incluye el registro de
 * cada paso para que el resultado sea reproducible.
 */

export interface DatasetSpec {
  series: SeriesData[];
  ipc?: Pt[];
  recipes: Record<string, TransformStep[]>;
  frequency?: Frequency;
  from?: string;
  to?: string;
}

export interface PreparedSeries {
  id: string;
  name: string;
  source: string;
  code: string | null;
  unit: string;
  recipe: string;
  log: string[];
  /** La serie sigue en niveles (sin tasas ni diferencias): tienen sentido CAGR y volatilidad. */
  isLevel: boolean;
}

export interface PreparedDataset {
  frequency: Frequency;
  dates: string[];
  columns: number[][];
  series: PreparedSeries[];
  notes: string[];
}

const RATE_OPS = new Set<TransformStep["op"]>(["log", "diff", "logdiff", "pct", "yoy"]);
const AGG_NAME = { avg: "promedio", sum: "suma", last: "último dato" } as const;

/**
 * Prepara el dataset: (1) lleva cada serie a la frecuencia común (sin
 * desagregar), (2) aplica la receta de transformaciones EN esa frecuencia
 * (así, la variación mensual de una serie diaria es la variación de su
 * promedio mensual, no el promedio de variaciones diarias) y (3) conserva
 * los períodos con datos en todas las series.
 */
export function prepare(ds: DatasetSpec): PreparedDataset {
  if (!ds.series.length) throw new Error("Elegí al menos una serie");
  const notes: string[] = [];
  const natural = lowestCommonFrequency(ds.series.map((s) => s.meta.frequency));
  let target = ds.frequency ?? natural;
  if (FREQ_RANK[target] < FREQ_RANK[natural]) {
    notes.push(`No se puede llevar a frecuencia ${FREQ_NAME[target]} sin inventar datos: se usa ${FREQ_NAME[natural]}.`);
    target = natural;
  }
  const prepared: PreparedSeries[] = [];
  const inputs = ds.series.map((s) => {
    const steps = ds.recipes[s.meta.id] ?? [];
    let pts = s.points;
    const log: string[] = [];
    if (s.meta.frequency !== target) {
      const agg = defaultAggregation(s.meta.unit, s.meta.name);
      const rs = resample(pts, s.meta.frequency, target, agg);
      pts = rs.points;
      log.push(`0. Frecuencia: ${FREQ_NAME[s.meta.frequency]} → ${FREQ_NAME[target]} (${AGG_NAME[agg]} del período)`);
      if (rs.incomplete.length) notes.push(`${s.meta.name}: ${rs.incomplete.length} período(s) incompleto(s) excluido(s) al agregar.`);
    }
    const r = applyRecipe(pts, steps, { freq: target, unit: s.meta.unit, ipcMonthly: ds.ipc });
    prepared.push({
      id: s.meta.id,
      name: s.meta.name,
      source: s.meta.source_id,
      code: s.meta.source_code,
      unit: r.unit,
      recipe: describeRecipe(steps),
      log: [...log, ...r.log],
      isLevel: !steps.some((st) => RATE_OPS.has(st.op)),
    });
    notes.push(...r.notes.map((n) => `${s.meta.name}: ${n}`));
    return { id: s.meta.id, name: s.meta.name, unit: r.unit, freq: target, points: r.points };
  });
  const a = alignSeries(inputs, { frequency: target, from: ds.from, to: ds.to });
  notes.push(...a.notes);
  if (a.dates.length < 3) throw new Error("Quedan menos de 3 observaciones comunes en el período: ampliá el período o revisá las transformaciones");
  return { frequency: a.frequency, dates: a.dates, columns: a.columns, series: prepared, notes };
}

/** Datos consecutivos (sin huecos de calendario) requeridos por los modelos de series temporales. */
function assertConsecutive(d: PreparedDataset) {
  if (d.frequency === "D" || d.frequency === "W") return;
  const step: Record<string, number> = { M: 1, Q: 3, S: 6, A: 12 };
  for (let i = 1; i < d.dates.length; i++) {
    const [y0, m0] = d.dates[i - 1].split("-").map(Number);
    const [y1, m1] = d.dates[i].split("-").map(Number);
    if ((y1 - y0) * 12 + (m1 - m0) !== step[d.frequency]) {
      throw new Error(`Hay un hueco entre ${d.dates[i - 1]} y ${d.dates[i]}: los modelos de series temporales requieren períodos consecutivos. Acotá el período.`);
    }
  }
}

const SEASON: Partial<Record<Frequency, number>> = { M: 12, Q: 4, S: 2 };

export type EconTask =
  | { kind: "describe"; ds: DatasetSpec; window: number }
  | { kind: "correlation"; ds: DatasetSpec; method: CorrMethod; pair: [number, number]; maxLag: number; window: number }
  | { kind: "regression"; ds: DatasetSpec; dep: number; regressors: RegressorSpec[]; depLags: number[]; covType: CovType; constant: boolean }
  | { kind: "univariate"; ds: DatasetSpec; column: number; trend: "c" | "ct"; model: "additive" | "multiplicative"; arima: ArimaOrder | "auto"; constant: boolean; horizon: number }
  | { kind: "var"; ds: DatasetSpec; p: number | "aic" | "bic"; maxLags: number; horizon: number; orthogonalized: boolean }
  | { kind: "cointegration"; ds: DatasetSpec; kArDiff: number; rank: number | "auto"; horizon: number }
  | { kind: "forecast"; ds: DatasetSpec; target: number; spec: ForecastSpec; exogColumns: number[] }
  | { kind: "backtest"; ds: DatasetSpec; target: number; spec: ForecastSpec; exogColumns: number[]; start: string; step: number; vintages?: { observations: VintageObservation[]; revisions: Revision[]; recipe: TransformStep[] } }
  | { kind: "shock"; ds: DatasetSpec; p: number; shockVar: number; shockSize: number; horizon: number };

export function runTask(task: EconTask): unknown {
  const d = prepare(task.ds);
  const base = { dataset: d };
  switch (task.kind) {
    case "describe":
      return {
        ...base,
        stats: d.series.map((s, j) => {
          const pts = d.dates.map((dt, t) => ({ d: dt, v: d.columns[j][t] }));
          // CAGR y volatilidad solo tienen sentido sobre niveles (no sobre tasas o diferencias).
          let growth: ReturnType<typeof cagr> | null = null;
          if (s.isLevel) {
            try {
              growth = cagr(pts);
            } catch {
              growth = null;
            }
          }
          const positive = s.isLevel && pts.every((p) => p.v > 0);
          return {
            describe: describe(pts),
            cagr: growth,
            ma: movingAverage(pts, task.window),
            volatility: positive && pts.length > task.window + 1 ? rollingVolatility(pts, task.window, d.frequency) : null,
            annualization: ANNUAL_PERIODS[d.frequency],
          };
        }),
      };
    case "correlation": {
      const names = d.series.map((s) => s.name);
      const [a, b] = task.pair;
      const warnings = correlationWarnings(d, task.pair);
      return {
        ...base,
        matrix: correlationMatrix(d.columns, names, task.method),
        pair: d.columns.length > 1 ? correlate(d.columns[a], d.columns[b], task.method) : null,
        lagged: d.columns.length > 1 ? laggedCorrelations(d.columns[a], d.columns[b], task.maxLag, task.method) : [],
        rolling: d.columns.length > 1 && d.dates.length > task.window ? rollingCorrelation(d.dates, d.columns[a], d.columns[b], task.window, task.method) : [],
        warnings,
      };
    }
    case "regression": {
      const design = buildDesign(d.dates, d.columns, task.dep, d.series[task.dep].name, task.regressors, task.depLags);
      const r = ols(design.y, design.x, design.names, { covType: task.covType, constant: task.constant });
      const warnings: string[] = [
        "Los coeficientes miden asociaciones condicionales en la muestra; no son efectos causales.",
      ];
      const nonStat = [task.dep, ...task.regressors.map((x) => x.column)].filter((c, i, arr) => arr.indexOf(c) === i).filter((c) => {
        try {
          return adf(d.columns[c]).p > 0.1;
        } catch {
          return false;
        }
      });
      if (nonStat.length) {
        warnings.push(
          `Posible regresión espuria: ADF no rechaza raíz unitaria en ${nonStat.map((c) => d.series[c].name).join(", ")}. Con variables con tendencia, un R² alto puede no significar nada; usá variaciones o verificá cointegración.`,
        );
      }
      if (r.diagnostics.durbinWatson < 1.5 || r.diagnostics.durbinWatson > 2.5) {
        warnings.push(`Durbin-Watson = ${r.diagnostics.durbinWatson.toFixed(2)}: los residuos están autocorrelacionados; los errores estándar clásicos no son confiables (usá Newey-West).`);
      }
      if (r.diagnostics.vif.some((v) => v.vif > 10)) warnings.push("Multicolinealidad alta (VIF > 10): los coeficientes individuales son imprecisos.");
      return { ...base, design: { dates: design.dates, dropped: design.dropped, y: design.y }, result: r, warnings };
    }
    case "univariate": {
      assertConsecutive(d);
      const y = d.columns[task.column];
      const dy = y.slice(1).map((v, i) => v - y[i]);
      const period = SEASON[d.frequency];
      let decomposition: ReturnType<typeof seasonalDecompose> | null = null;
      let decompError: string | null = null;
      if (period) {
        try {
          decomposition = seasonalDecompose(y, period, task.model);
        } catch (e) {
          decompError = (e as Error).message;
        }
      } else decompError = `Una serie ${FREQ_NAME[d.frequency]} no tiene ciclo estacional fijo.`;
      const lambda = HP_LAMBDA[d.frequency];
      const positive = y.every((v) => v > 0);
      let model: ArimaModel | null = null;
      let tried: { order: ArimaOrder; aicc: number | null; error?: string }[] = [];
      let arimaError: string | null = null;
      try {
        if (task.arima === "auto") {
          const r = autoArima(y);
          model = r.best;
          tried = r.tried;
        } else model = fitArima(y, task.arima, { constant: task.constant });
      } catch (e) {
        arimaError = (e as Error).message;
      }
      const nl = Math.min(24, Math.floor(y.length / 4));
      return {
        ...base,
        levels: stationarity(y, task.trend),
        diffs: dy.length > 10 ? stationarity(dy, "c") : null,
        decomposition,
        decompError,
        hp: lambda && y.length >= 8 ? { lambda, ...hpFilter(y, lambda) } : null,
        trend: linearTrend(y, positive),
        trendLog: positive,
        acf: acf(y, nl),
        pacf: pacf(y, nl),
        acfDiff: dy.length > 10 ? acf(dy, Math.min(nl, Math.floor(dy.length / 4))) : null,
        arima: model,
        arimaTried: tried,
        arimaError,
        forecast: model ? forecastArima(model, task.horizon) : null,
      };
    }
    case "var": {
      assertConsecutive(d);
      if (d.columns.length < 2) throw new Error("El VAR necesita al menos dos series");
      const data = d.dates.map((_, t) => d.columns.map((c) => c[t]));
      const names = d.series.map((s) => s.name);
      const selection = selectVarOrder(data, names, task.maxLags);
      const p = task.p === "aic" ? selection.selected.aic : task.p === "bic" ? selection.selected.bic : task.p;
      const m = fitVar(data, names, p);
      const nonStat = d.columns.map((c, j) => ({ j, p: adf(c).p })).filter((x) => x.p > 0.1);
      const warnings: string[] = [];
      if (nonStat.length) {
        warnings.push(`ADF no rechaza raíz unitaria en ${nonStat.map((x) => names[x.j]).join(", ")}: un VAR en niveles puede ser engañoso. Usá variaciones o, si hay cointegración, un VECM.`);
      }
      if (!m.stable) warnings.push("El VAR estimado no es estable: las respuestas y los pronósticos no son interpretables.");
      return {
        ...base,
        selection,
        model: { ...m, residuals: undefined, zzInv: undefined },
        granger: grangerMatrix(data, names, p),
        irf: impulseResponse(m, task.horizon, { orthogonalized: task.orthogonalized }),
        fevd: fevd(m, task.horizon),
        forecast: forecastVar(m, Math.min(task.horizon, 24)),
        warnings,
      };
    }
    case "cointegration": {
      assertConsecutive(d);
      if (d.columns.length < 2) throw new Error("La cointegración necesita al menos dos series");
      const data = d.dates.map((_, t) => d.columns.map((c) => c[t]));
      const names = d.series.map((s) => s.name);
      const req = checkVecmRequirements(data, names, task.kArDiff);
      const eg = d.columns.length <= 6 ? engleGranger(d.columns[0], d.columns.slice(1)) : null;
      const joh = req.johansen ?? johansen(data, 0, task.kArDiff);
      let vecm = null;
      let vecmForecast = null;
      let vecmError: string | null = null;
      const rank = task.rank === "auto" ? joh.rank : task.rank;
      if (req.ok || task.rank !== "auto") {
        try {
          const m = fitVecm(data, names, rank, task.kArDiff);
          vecm = { ...m, varForm: undefined };
          vecmForecast = forecastVecm(m, task.horizon);
        } catch (e) {
          vecmError = (e as Error).message;
        }
      }
      return { ...base, requirements: req, engleGranger: eg, johansen: joh, rank, vecm, vecmForecast, vecmError, forcedRank: task.rank !== "auto" && !req.ok };
    }
    case "forecast": {
      assertConsecutive(d);
      const exog = task.exogColumns.map((c) => d.columns[c]);
      return {
        ...base,
        history: d.dates.map((dt, t) => ({ d: dt, v: d.columns[task.target][t] })),
        result: runForecast(d.dates, d.columns[task.target], d.frequency, task.spec, {
          exog,
          exogNames: task.exogColumns.map((c) => d.series[c].name),
          varNames: task.exogColumns.map((c) => d.series[c].name),
        }),
      };
    }
    case "backtest": {
      assertConsecutive(d);
      const exog = task.exogColumns.map((c) => d.columns[c]);
      let vintage: ((origin: string) => { dates: string[]; y: number[] } | null) | undefined;
      // Vintages solo si la serie objetivo no cambia de frecuencia al alinear (si no, habría que reagregar cada versión).
      if (task.vintages && task.vintages.observations.length && task.ds.series[task.target].meta.frequency === d.frequency) {
        const v = task.vintages;
        const byDate = new Map(v.observations.map((o) => [o.d, o]));
        const trackedFrom = v.observations.reduce((m, o) => (o.availableAt < m ? o.availableAt : m), "9999");
        vintage = (origin) => {
          const o = byDate.get(origin);
          if (!o || o.availableAt <= trackedFrom) return null; // sin registro real de esa publicación
          const pts = seriesAsOf(v.observations, v.revisions, o.availableAt);
          const s = task.ds.series[task.target];
          const tr = applyRecipe(pts, v.recipe, { freq: s.meta.frequency, unit: s.meta.unit, ipcMonthly: task.ds.ipc });
          const ok = tr.points.filter((p) => p.v !== null && (!task.ds.from || p.d >= task.ds.from));
          return { dates: ok.map((p) => p.d), y: ok.map((p) => p.v as number) };
        };
      }
      const r: BacktestResult = backtest(
        d.dates,
        d.columns[task.target],
        d.frequency,
        { forecast: task.spec, start: task.start, step: task.step },
        { exog, varNames: task.exogColumns.map((c) => d.series[c].name), vintage: task.exogColumns.length ? undefined : vintage, maxOrigins: 240 },
      );
      return { ...base, result: r };
    }
    case "shock": {
      assertConsecutive(d);
      const data = d.dates.map((_, t) => d.columns.map((c) => c[t]));
      return { ...base, result: simulateShock(data, d.series.map((s) => s.name), { p: task.p, shockVar: task.shockVar, shockSize: task.shockSize, horizon: task.horizon }) };
    }
  }
}

function correlationWarnings(d: PreparedDataset, pair: [number, number]): string[] {
  const w = [
    "Correlación no implica causalidad: dos series pueden moverse juntas por una tercera causa común o por casualidad.",
  ];
  const trending = d.columns
    .map((c, j) => ({ j, p: c.length > 10 ? (() => { try { return adf(c).p; } catch { return 0; } })() : 0 }))
    .filter((x) => x.p > 0.1);
  if (trending.length) {
    w.push(
      `Las series ${trending.map((x) => d.series[x.j].name).join(", ")} parecen tener tendencia o raíz unitaria (ADF p > 0,10): la correlación en niveles puede ser espuria. Probá con variaciones porcentuales o diferencias.`,
    );
  }
  if (d.columns.length > 1) {
    const [a, b] = pair;
    const ra = acf(d.columns[a], 1)[1];
    const rb = acf(d.columns[b], 1)[1];
    if (ra > 0.5 && rb > 0.5) {
      const neff = Math.max(3, Math.round(d.dates.length * ((1 - ra * rb) / (1 + ra * rb))));
      w.push(
        `Ambas series tienen autocorrelación alta (ρ₁ = ${ra.toFixed(2)} y ${rb.toFixed(2)}): el p-valor clásico supone observaciones independientes y sobreestima la significancia. Tamaño efectivo aproximado (Bartlett): ${neff} observaciones.`,
      );
    }
  }
  if (d.dates.length < 30) w.push(`Muestra corta (${d.dates.length} observaciones): las estimaciones son imprecisas.`);
  return w;
}
