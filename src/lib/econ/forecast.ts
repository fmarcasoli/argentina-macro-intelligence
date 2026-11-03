import type { Frequency } from "../connectors/types";
import { parseIsoDate, shiftPeriods, toIsoDate } from "../normalize/dates";
import { autoArima, fitArima, forecastArima, type ArimaModel, type ArimaOrder } from "./arima";
import { normalInv, tInv } from "./dist";
import { leastSquares } from "./linalg";
import { fitVar, forecastVar } from "./var";

/**
 * Proyecciones estadísticas con bandas de incertidumbre.
 *
 * Una proyección es la continuación de regularidades pasadas bajo el supuesto
 * de que el proceso no cambia. No es una predicción cierta: las bandas
 * cubren solo la incertidumbre que el modelo puede medir (no los cambios de
 * política, régimen o shocks nunca vistos en la muestra).
 */

export class ForecastError extends Error {}

export type ForecastMethod = "naive" | "drift" | "mean" | "arima" | "auto_arima" | "regression" | "var";

export const METHOD_LABEL: Record<ForecastMethod, string> = {
  naive: "Paseo aleatorio (último valor)",
  drift: "Paseo aleatorio con deriva",
  mean: "Media histórica",
  arima: "ARIMA (orden elegido)",
  auto_arima: "ARIMA automático (AICc)",
  regression: "Regresión con escenario de variables explicativas",
  var: "VAR (vector autorregresivo)",
};

export interface ForecastSpec {
  method: ForecastMethod;
  horizon: number;
  /** Modelar en logaritmos (series positivas: precios, stocks, tipo de cambio). */
  log?: boolean;
  order?: ArimaOrder;
  constant?: boolean;
  /** Regresión: trayectorias futuras de cada explicativa (horizon valores cada una). */
  exogFuture?: number[][];
  /** VAR: orden. */
  varLags?: number;
  levels?: number[];
  /** Estimación rápida (backtesting): grilla ARIMA reducida y sin errores estándar. */
  fast?: boolean;
}

export interface ForecastPoint {
  d: string;
  mean: number;
  bands: { level: number; lower: number; upper: number }[];
}

export interface ForecastResult {
  method: ForecastMethod;
  label: string;
  estimation: { from: string; to: string; n: number };
  points: ForecastPoint[];
  /** Descripción del modelo estimado (parámetros, criterios). */
  details: { name: string; value: string }[];
  arima?: ArimaModel;
  warnings: string[];
}

/** Fechas futuras: períodos de calendario; diaria = días hábiles (lunes a viernes). */
export function futureDates(last: string, freq: Frequency, h: number): string[] {
  const out: string[] = [];
  let d = parseIsoDate(last)!;
  while (out.length < h) {
    if (freq === "D") {
      d = new Date(d.getTime() + 86_400_000);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    } else {
      d = shiftPeriods(d, freq, 1);
    }
    out.push(toIsoDate(d));
  }
  return out;
}

const fmt = (v: number, d = 4) => v.toLocaleString("es-AR", Math.abs(v) >= 1e4 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: d });

/**
 * Proyección univariada (o con explicativas). `y` debe tener observaciones
 * consecutivas (sin huecos) y `exog` (regresión/VAR) debe estar alineado.
 */
export function runForecast(
  dates: string[],
  y: number[],
  freq: Frequency,
  spec: ForecastSpec,
  extra: { exog?: number[][]; exogNames?: string[]; varNames?: string[] } = {},
): ForecastResult {
  const h = spec.horizon;
  if (!Number.isInteger(h) || h < 1 || h > 120) throw new ForecastError("El horizonte debe estar entre 1 y 120 períodos");
  if (y.length !== dates.length) throw new ForecastError("Fechas y valores no coinciden");
  if (y.length < 8) throw new ForecastError("Hacen falta al menos 8 observaciones para estimar");
  const levels = spec.levels ?? [0.8, 0.95];
  const warnings: string[] = [];
  if (spec.log && y.some((v) => v <= 0)) throw new ForecastError("No se puede usar logaritmos: la serie tiene valores ≤ 0");
  const z = spec.log ? y.map(Math.log) : y;
  const n = z.length;
  const fd = futureDates(dates[n - 1], freq, h);
  let mean: number[];
  let se: number[];
  let quantile = (lvl: number) => normalInv(1 - (1 - lvl) / 2);
  const details: ForecastResult["details"] = [];
  let arimaModel: ArimaModel | undefined;

  switch (spec.method) {
    case "naive":
    case "drift": {
      const dz = z.slice(1).map((v, i) => v - z[i]);
      const c = spec.method === "drift" ? dz.reduce((a, b) => a + b, 0) / dz.length : 0;
      const s = Math.sqrt(dz.reduce((a, v) => a + (v - c) ** 2, 0) / (dz.length - (spec.method === "drift" ? 1 : 0)));
      mean = fd.map((_, i) => z[n - 1] + c * (i + 1));
      se = fd.map((_, i) => s * Math.sqrt((i + 1) * (spec.method === "drift" ? 1 + (i + 1) / (n - 1) : 1)));
      details.push({ name: "σ de las variaciones", value: fmt(s) });
      if (spec.method === "drift") details.push({ name: "Deriva por período", value: fmt(c) });
      break;
    }
    case "mean": {
      const m = z.reduce((a, b) => a + b, 0) / n;
      const s = Math.sqrt(z.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
      mean = fd.map(() => m);
      se = fd.map(() => s * Math.sqrt(1 + 1 / n));
      quantile = (lvl) => tInv(1 - (1 - lvl) / 2, n - 1);
      details.push({ name: "Media", value: fmt(m) }, { name: "Desvío", value: fmt(s) });
      warnings.push("La media histórica supone que la serie fluctúa alrededor de un nivel fijo: solo es razonable para series estacionarias.");
      break;
    }
    case "arima":
    case "auto_arima": {
      if (spec.method === "arima") {
        if (!spec.order) throw new ForecastError("Indicá el orden (p, d, q) del ARIMA");
        arimaModel = fitArima(z, spec.order, { constant: spec.constant, computeSe: !spec.fast });
      } else {
        // En backtesting (muchas reestimaciones) se usa una grilla más chica y sin errores estándar.
        arimaModel = autoArima(z, spec.fast ? { maxP: 2, maxQ: 2, computeSe: false } : {}).best;
      }
      const fc = forecastArima(arimaModel, h, levels);
      mean = fc.mean;
      se = fc.se;
      const o = arimaModel.order;
      details.push({ name: "Modelo", value: `ARIMA(${o.p},${o.d},${o.q})${arimaModel.constant ? (o.d ? " con deriva" : " con media") : ""}` });
      for (const p of arimaModel.params) details.push({ name: p.name, value: `${fmt(p.value)}${p.se ? ` (e.e. ${fmt(p.se, 3)})` : ""}` });
      details.push({ name: "AICc", value: fmt(arimaModel.aicc, 6) });
      if (arimaModel.ljungBox && arimaModel.ljungBox.p < 0.05) {
        warnings.push(`Los residuos tienen autocorrelación (Ljung-Box p = ${arimaModel.ljungBox.p.toFixed(3)}): el modelo no captura toda la dinámica.`);
      }
      warnings.push(...arimaModel.warnings);
      break;
    }
    case "regression": {
      const X = extra.exog;
      const fut = spec.exogFuture;
      if (!X?.length || !fut?.length) throw new ForecastError("La regresión necesita variables explicativas y su escenario futuro");
      if (fut.some((p) => p.length !== h)) throw new ForecastError(`Cada explicativa necesita ${h} valores futuros`);
      const k = X.length;
      const design = z.map((_, t) => [1, ...X.map((c) => c[t])]);
      const { beta, xtxInv } = leastSquares(design, z);
      const resid = z.map((v, t) => v - design[t].reduce((s, x, j) => s + x * beta[j], 0));
      const df = n - (k + 1);
      const s2 = resid.reduce((a, e) => a + e * e, 0) / df;
      mean = [];
      se = [];
      for (let i = 0; i < h; i++) {
        const x0 = [1, ...fut.map((p) => p[i])];
        mean.push(x0.reduce((s, x, j) => s + x * beta[j], 0));
        const q = x0.reduce((s, a, r) => s + a * x0.reduce((t, b, c) => t + b * xtxInv[r][c], 0), 0);
        se.push(Math.sqrt(s2 * (1 + q)));
      }
      quantile = (lvl) => tInv(1 - (1 - lvl) / 2, df);
      details.push({ name: "Constante", value: fmt(beta[0]) });
      extra.exogNames?.forEach((nm, j) => details.push({ name: nm, value: fmt(beta[j + 1]) }));
      warnings.push(
        "La proyección es condicional al escenario de las explicativas que definiste: no las proyecta el modelo.",
        "Los coeficientes son asociaciones estimadas en la muestra, no efectos causales; si las variables tienen tendencia común la regresión puede ser espuria.",
      );
      break;
    }
    case "var": {
      const others = extra.exog ?? [];
      if (!others.length) throw new ForecastError("El VAR necesita al menos otra variable");
      const data = z.map((v, t) => [v, ...others.map((c) => c[t])]);
      const names = ["objetivo", ...(extra.varNames ?? others.map((_, i) => `x${i + 1}`))];
      const m = fitVar(data, names, spec.varLags ?? 2);
      const fc = forecastVar(m, h, levels);
      mean = fc.mean.map((r) => r[0]);
      se = fc.se.map((r) => r[0]);
      details.push({ name: "Rezagos", value: String(m.p) }, { name: "AIC", value: fmt(m.aic, 5) });
      if (!m.stable) warnings.push("El VAR estimado no es estable (raíz ≥ 1): los pronósticos divergen. Usá variables estacionarias (variaciones).");
      warnings.push("El VAR proyecta todas las variables a la vez: no impone un escenario para las demás.");
      break;
    }
  }

  const points: ForecastPoint[] = fd.map((d, i) => {
    const bands = levels.map((level) => {
      const q = quantile(level);
      const lo = mean[i] - q * se[i];
      const hi = mean[i] + q * se[i];
      return { level, lower: spec.log ? Math.exp(lo) : lo, upper: spec.log ? Math.exp(hi) : hi };
    });
    return { d, mean: spec.log ? Math.exp(mean[i]) : mean[i], bands };
  });
  if (spec.log) warnings.push("Modelo estimado en logaritmos: la proyección central es la mediana (exp de la media del log) y las bandas son asimétricas.");
  warnings.push("Proyección estadística: supone que las regularidades del período de estimación se mantienen. No es una predicción cierta.");
  return {
    method: spec.method,
    label: METHOD_LABEL[spec.method],
    estimation: { from: dates[0], to: dates[n - 1], n },
    points,
    details,
    arima: arimaModel,
    warnings,
  };
}
