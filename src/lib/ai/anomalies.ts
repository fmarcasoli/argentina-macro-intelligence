import { correlate } from "../econ/correlation";
import { median } from "../econ/stats";
import { normalSf } from "../econ/dist";

/**
 * Detección de anomalías con criterios estadísticos explícitos. Cada alerta
 * informa el criterio, el umbral y el valor que lo superó, para que pueda
 * verificarse. Son señales para investigar, no conclusiones.
 */

export type AnomalyKind = "unusual_change" | "extreme" | "acceleration" | "deceleration" | "trend_change" | "divergence" | "correlation_change";

export interface Anomaly {
  kind: AnomalyKind;
  d: string;
  /** Descripción con la cifra. */
  message: string;
  /** Criterio estadístico usado (con umbral). */
  criterion: string;
  score: number;
}

export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  unusual_change: "Variación inusual",
  extreme: "Valor extremo",
  acceleration: "Aceleración",
  deceleration: "Desaceleración",
  trend_change: "Cambio de tendencia",
  divergence: "Divergencia",
  correlation_change: "Cambio de correlación",
};

const fmt = (v: number, d = 2) => v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Anomalías de una serie de variaciones (p. ej. variación % mensual).
 * `dates`/`x` deben ser consecutivos y sin nulos.
 */
export function detectAnomalies(dates: string[], x: number[], opts: { unit: string; recent?: number; name?: string } = { unit: "%" }): Anomaly[] {
  const out: Anomaly[] = [];
  const n = x.length;
  if (n < 15) return out;
  const recent = opts.recent ?? 12;
  const u = opts.unit;

  // 1. Variación inusual: z robusto de Iglewicz-Hoaglin, |0,6745 (x − mediana) / MAD| > 3,5.
  const med = median(x);
  const mad = median(x.map((v) => Math.abs(v - med)));
  if (mad > 0) {
    for (let i = Math.max(0, n - recent); i < n; i++) {
      const z = (0.6745 * (x[i] - med)) / mad;
      if (Math.abs(z) > 3.5) {
        out.push({
          kind: "unusual_change",
          d: dates[i],
          message: `${fmt(x[i])} ${u}, lejos de la mediana histórica (${fmt(med)} ${u}).`,
          criterion: `z robusto (mediana/MAD) = ${fmt(z, 1)}; umbral |z| > 3,5 (Iglewicz y Hoaglin).`,
          score: Math.abs(z),
        });
      }
    }
  }

  // 2. Extremos: el último dato es el máximo o mínimo de toda la muestra.
  const last = x[n - 1];
  const max = Math.max(...x.slice(0, -1));
  const min = Math.min(...x.slice(0, -1));
  if (last > max || last < min) {
    out.push({
      kind: "extreme",
      d: dates[n - 1],
      message: `${fmt(last)} ${u} es el ${last > max ? "máximo" : "mínimo"} de la serie desde ${dates[0]}.`,
      criterion: `Supera el ${last > max ? "máximo" : "mínimo"} previo de ${n - 1} observaciones (${fmt(last > max ? max : min)} ${u}).`,
      score: 5,
    });
  }

  // 3. Aceleración / desaceleración: promedio de los últimos 3 vs. los 12 previos, en desvíos de las variaciones.
  if (n >= 15) {
    const l3 = x.slice(-3);
    const p12 = x.slice(-15, -3);
    const a = l3.reduce((s, v) => s + v, 0) / 3;
    const b = p12.reduce((s, v) => s + v, 0) / 12;
    const sd = Math.sqrt(p12.reduce((s, v) => s + (v - b) ** 2, 0) / 11);
    const se = sd * Math.sqrt(1 / 3 + 1 / 12);
    if (se > 0) {
      const t = (a - b) / se;
      if (Math.abs(t) > 2) {
        out.push({
          kind: t > 0 ? "acceleration" : "deceleration",
          d: dates[n - 1],
          message: `Promedio de los últimos 3 períodos ${fmt(a)} ${u} vs. ${fmt(b)} ${u} en los 12 anteriores.`,
          criterion: `Diferencia de medias / error estándar = ${fmt(t, 1)}; umbral |t| > 2 (≈ 95 %).`,
          score: Math.abs(t),
        });
      }
    }
  }

  // 4. Cambio de tendencia: la pendiente de los últimos 6 períodos cambia de signo respecto de los 6 previos, y ambas son relevantes.
  if (n >= 12) {
    const slope = (y: number[]) => {
      const m = (y.length - 1) / 2;
      const ym = y.reduce((s, v) => s + v, 0) / y.length;
      let num = 0;
      let den = 0;
      y.forEach((v, i) => {
        num += (i - m) * (v - ym);
        den += (i - m) ** 2;
      });
      return num / den;
    };
    const s1 = slope(x.slice(-12, -6));
    const s2 = slope(x.slice(-6));
    const scale = Math.sqrt(x.slice(-12).reduce((s, v, _, arr) => s + (v - arr.reduce((a, b) => a + b, 0) / arr.length) ** 2, 0) / 11) / 6;
    if (Math.sign(s1) !== Math.sign(s2) && Math.abs(s1) > scale && Math.abs(s2) > scale) {
      out.push({
        kind: "trend_change",
        d: dates[n - 1],
        message: `La tendencia pasó de ${s1 > 0 ? "subir" : "bajar"} (${fmt(s1)} ${u} por período) a ${s2 > 0 ? "subir" : "bajar"} (${fmt(s2)} ${u} por período).`,
        criterion: "Pendiente MCO de los últimos 6 períodos vs. los 6 anteriores con signo opuesto y magnitud mayor a σ/6 de la ventana.",
        score: Math.abs(s2 - s1) / (scale || 1),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Divergencia y cambio de correlación entre dos series de variaciones:
 * compara la correlación de la ventana reciente con la del período previo
 * (prueba z de Fisher para dos correlaciones independientes, p < 0,05).
 */
export function detectCorrelationChange(dates: string[], x: number[], y: number[], names: [string, string], window = 24): Anomaly[] {
  const n = x.length;
  if (n < window + 12) return [];
  const out: Anomaly[] = [];
  const recent = correlate(x.slice(-window), y.slice(-window));
  const before = correlate(x.slice(0, -window), y.slice(0, -window));
  const z = (Math.atanh(recent.r) - Math.atanh(before.r)) / Math.sqrt(1 / (recent.n - 3) + 1 / (before.n - 3));
  const p = 2 * normalSf(Math.abs(z));
  if (p < 0.05) {
    out.push({
      kind: "correlation_change",
      d: dates[n - 1],
      message: `La correlación entre ${names[0]} y ${names[1]} pasó de ${fmt(before.r)} a ${fmt(recent.r)} en los últimos ${window} períodos.`,
      criterion: `Prueba z de Fisher para dos correlaciones: z = ${fmt(z, 2)}, p = ${fmt(p, 3)} (umbral p < 0,05).`,
      score: Math.abs(z),
    });
  }
  // Divergencia: en los últimos 6 períodos se mueven en sentido opuesto siendo que históricamente se asocian positivamente.
  const k = 6;
  const sx = x.slice(-k).reduce((s, v) => s + v, 0);
  const sy = y.slice(-k).reduce((s, v) => s + v, 0);
  if (before.r > 0.3 && before.p < 0.05 && Math.sign(sx) !== Math.sign(sy) && sx !== 0 && sy !== 0) {
    out.push({
      kind: "divergence",
      d: dates[n - 1],
      message: `En los últimos ${k} períodos ${names[0]} acumula ${fmt(sx)} y ${names[1]} ${fmt(sy)}: se mueven en sentido opuesto.`,
      criterion: `Signos opuestos de la suma de variaciones de ${k} períodos, con correlación histórica positiva y significativa (r = ${fmt(before.r)}, p < 0,05).`,
      score: 3,
    });
  }
  return out;
}
