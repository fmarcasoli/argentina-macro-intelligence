import { cholesky } from "./linalg";
import { fitVar, forecastVar, impulseResponse, type VarModel } from "./var";

/**
 * Simulador macroeconómico. Distingue tres tipos de resultado, que nunca se
 * mezclan ni se presentan como equivalentes:
 *
 *  1. ARITMÉTICO: identidades contables exactas (p. ej. salario real =
 *     salario nominal / precios). El resultado es cierto DADOS los supuestos;
 *     no dice nada sobre si los supuestos son plausibles ni sobre causalidad.
 *  2. ESCENARIO DEL USUARIO: trayectorias mensuales que el usuario define para
 *     varias variables a la vez, encadenadas desde los últimos datos oficiales
 *     con las mismas identidades. Es un ejercicio de "qué pasaría si", no un
 *     pronóstico: las variables no reaccionan entre sí salvo por las
 *     identidades.
 *  3. MODELO ESTIMADO: respuestas a un shock según un VAR estimado con datos
 *     reales. Son regularidades estadísticas de forma reducida, sujetas a
 *     incertidumbre (bandas) y al orden de identificación; no son efectos
 *     causales validados.
 */

export type SimKind = "arithmetic" | "scenario" | "model";

export const SIM_KIND_LABEL: Record<SimKind, { title: string; disclaimer: string }> = {
  arithmetic: {
    title: "Simulación aritmética",
    disclaimer:
      "Identidad contable exacta: el resultado es cierto dados los supuestos que ingresaste. No es un modelo económico ni implica relaciones causales entre las variables.",
  },
  scenario: {
    title: "Escenario definido por el usuario",
    disclaimer:
      "Trayectorias supuestas por vos, encadenadas desde los últimos datos oficiales con identidades contables. No es un pronóstico: las variables no reaccionan entre sí más allá de esas identidades.",
  },
  model: {
    title: "Modelo estadístico estimado (VAR)",
    disclaimer:
      "Respuestas estimadas con datos históricos en un VAR de forma reducida. Describen regularidades estadísticas pasadas, dependen del orden de las variables (Cholesky) y del período de estimación, y no constituyen un modelo causal validado.",
  },
};

// ── 1. Identidades aritméticas ──────────────────────────────────────────────

export interface ArithmeticResult {
  kind: "arithmetic";
  formula: string;
  value: number;
  unit: string;
  steps: string[];
}

/** Número en formato argentino (coma decimal, punto de miles). */
const nf = (v: number, d = 2) => v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${nf(v)} %`;

/** Variación real a partir de la nominal y la inflación (Fisher exacta). */
export function realVariation(nominalPct: number, inflationPct: number): ArithmeticResult {
  const v = ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
  return {
    kind: "arithmetic",
    formula: "real = (1 + nominal) / (1 + inflación) − 1",
    value: v,
    unit: "%",
    steps: [`(1 + ${pct(nominalPct)}) / (1 + ${pct(inflationPct)}) − 1 = ${pct(v)}`],
  };
}

/** Capitalización compuesta de una tasa mensual constante durante n meses. */
export function compound(monthlyPct: number, months: number): ArithmeticResult {
  const v = (Math.pow(1 + monthlyPct / 100, months) - 1) * 100;
  return {
    kind: "arithmetic",
    formula: "acumulada = (1 + mensual)^n − 1",
    value: v,
    unit: "%",
    steps: [`(1 + ${pct(monthlyPct)})^${months} − 1 = ${pct(v)}`],
  };
}

/** Variación del tipo de cambio real bilateral: (1 + devaluación)(1 + inflación externa)/(1 + inflación local) − 1. */
export function realExchangeChange(devaluationPct: number, inflationPct: number, foreignInflationPct: number): ArithmeticResult {
  const v = (((1 + devaluationPct / 100) * (1 + foreignInflationPct / 100)) / (1 + inflationPct / 100) - 1) * 100;
  return {
    kind: "arithmetic",
    formula: "TCR = (1 + devaluación)(1 + inflación externa) / (1 + inflación local) − 1",
    value: v,
    unit: "%",
    steps: [
      `(1 + ${pct(devaluationPct)})(1 + ${pct(foreignInflationPct)}) / (1 + ${pct(inflationPct)}) − 1 = ${pct(v)}`,
      v > 0 ? "Positivo: depreciación real (el peso se abarata en términos reales)." : "Negativo: apreciación real (el peso se encarece en términos reales).",
    ],
  };
}

/** Tasa real mensual a partir de una TNA (plazo fijo a 30 días) y la inflación mensual. */
export function realRateMonthly(tnaPct: number, inflationMonthlyPct: number): ArithmeticResult {
  const tem = (tnaPct / 100) * (30 / 365);
  const v = ((1 + tem) / (1 + inflationMonthlyPct / 100) - 1) * 100;
  return {
    kind: "arithmetic",
    formula: "TEM = TNA × 30/365;  real = (1 + TEM) / (1 + inflación) − 1",
    value: v,
    unit: "% mensual",
    steps: [`TEM = ${pct(tnaPct)} × 30/365 = ${pct(tem * 100)}`, `(1 + ${pct(tem * 100)}) / (1 + ${pct(inflationMonthlyPct)}) − 1 = ${pct(v)}`],
  };
}

/** Stock al cabo de n meses con flujos constantes: S_n = S_0 + n · flujo. */
export function stockPath(start: number, monthlyFlow: number, months: number): ArithmeticResult {
  const v = start + monthlyFlow * months;
  return {
    kind: "arithmetic",
    formula: "S(n) = S(0) + n × flujo mensual",
    value: v,
    unit: "",
    steps: [`${nf(start, 0)} + ${months} × ${nf(monthlyFlow, 0)} = ${nf(v, 0)}`],
  };
}

// ── 2. Escenarios del usuario ───────────────────────────────────────────────

export interface Segment {
  months: number;
  value: number;
}

/** Expande tramos [{meses, valor}] a una trayectoria mensual de `n` valores (el último tramo se extiende). */
export function expandPath(segments: Segment[], n: number): number[] {
  const out: number[] = [];
  for (const s of segments) for (let i = 0; i < s.months && out.length < n; i++) out.push(s.value);
  const last = segments[segments.length - 1]?.value ?? 0;
  while (out.length < n) out.push(last);
  return out;
}

export interface ScenarioStart {
  /** Mes de partida (último dato oficial común). */
  date: string;
  ipc: number;
  fx: number;
  base: number;
  reserves: number;
  wage: number;
}

export interface ScenarioPaths {
  /** Inflación mensual (%). */
  inflation: number[];
  /** Devaluación mensual del tipo de cambio mayorista (%). */
  devaluation: number[];
  /** Crecimiento mensual de la base monetaria (%). */
  baseGrowth: number[];
  /** Variación neta de reservas (millones de US$ por mes). */
  reserveFlow: number[];
  /** Aumento mensual del salario nominal (%). */
  wageGrowth: number[];
  /** Tasa nominal anual (TNA, %), plazo fijo a 30 días. */
  rate: number[];
  /** Inflación mensual externa (%), para el tipo de cambio real. */
  foreignInflation: number[];
}

export interface ScenarioRow {
  d: string;
  ipc: number;
  inflationAcc: number;
  fx: number;
  devaluationAcc: number;
  realFxIndex: number;
  base: number;
  realBase: number;
  reserves: number;
  wageIndex: number;
  realWageIndex: number;
  realRateMonthly: number;
  /** $100 en plazo fijo renovado, en pesos constantes del inicio. */
  realDepositValue: number;
}

export interface ScenarioResult {
  kind: "scenario";
  start: ScenarioStart;
  rows: ScenarioRow[];
  summary: { name: string; value: string }[];
  notes: string[];
}

function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

/** Encadena las trayectorias desde los últimos datos oficiales. */
export function runScenario(start: ScenarioStart, paths: ScenarioPaths): ScenarioResult {
  const n = paths.inflation.length;
  const rows: ScenarioRow[] = [];
  let P = 1;
  let E = 1;
  let Pf = 1;
  let B = start.base;
  let R = start.reserves;
  let W = 1;
  let dep = 100;
  for (let t = 0; t < n; t++) {
    const pi = paths.inflation[t] / 100;
    P *= 1 + pi;
    E *= 1 + paths.devaluation[t] / 100;
    Pf *= 1 + paths.foreignInflation[t] / 100;
    B *= 1 + paths.baseGrowth[t] / 100;
    R += paths.reserveFlow[t];
    W *= 1 + paths.wageGrowth[t] / 100;
    const tem = (paths.rate[t] / 100) * (30 / 365);
    dep *= (1 + tem) / (1 + pi);
    rows.push({
      d: addMonths(start.date, t + 1),
      ipc: start.ipc * P,
      inflationAcc: (P - 1) * 100,
      fx: start.fx * E,
      devaluationAcc: (E - 1) * 100,
      realFxIndex: ((E * Pf) / P) * 100,
      base: B,
      realBase: B / P,
      reserves: R,
      wageIndex: W * 100,
      realWageIndex: (W / P) * 100,
      realRateMonthly: ((1 + tem) / (1 + pi) - 1) * 100,
      realDepositValue: dep,
    });
  }
  const last = rows[rows.length - 1];
  const notes: string[] = [];
  if (last.realFxIndex < 100) notes.push(`El tipo de cambio real termina ${nf((100 - last.realFxIndex), 1)} % por debajo del inicio (apreciación real).`);
  if (last.realWageIndex < 100) notes.push(`El salario real cae ${nf((100 - last.realWageIndex), 1)} % en el escenario.`);
  if (rows.some((r) => r.reserves < 0)) notes.push("Las reservas brutas se vuelven negativas: el escenario es inconsistente contablemente.");
  if (rows.filter((r) => r.realRateMonthly < 0).length > n / 2) notes.push("La tasa real es negativa en la mayor parte del horizonte.");
  return {
    kind: "scenario",
    start,
    rows,
    summary: last
      ? [
          { name: "Inflación acumulada", value: pct(last.inflationAcc) },
          { name: "Devaluación acumulada", value: pct(last.devaluationAcc) },
          { name: "Tipo de cambio final", value: nf(last.fx, 2) },
          { name: "Tipo de cambio real (inicio = 100)", value: nf(last.realFxIndex, 1) },
          { name: "Base monetaria real (pesos del inicio)", value: `${pct((last.realBase / start.base - 1) * 100)}` },
          { name: "Reservas finales (millones US$)", value: nf(last.reserves, 0) },
          { name: "Salario real (inicio = 100)", value: nf(last.realWageIndex, 1) },
          { name: "$100 en plazo fijo, en pesos constantes", value: nf(last.realDepositValue, 1) },
        ]
      : [],
    notes,
  };
}

// ── 3. Modelo estadístico estimado ──────────────────────────────────────────

export interface ModelShockResult {
  kind: "model";
  model: Pick<VarModel, "names" | "p" | "nobs" | "aic" | "stable" | "spectralRadius">;
  shockVar: number;
  shockSize: number;
  /** response[i][s]: respuesta de la variable i, s períodos después del shock (en sus unidades). */
  response: number[][];
  lower: number[][];
  upper: number[][];
  /** Respuesta acumulada (útil cuando las variables son tasas de variación). */
  cumulative: number[][];
  level: number;
  baseline: { mean: number[][]; lower: number[][]; upper: number[][] };
  notes: string[];
}

/**
 * Shock en un VAR: respuesta ortogonalizada (Cholesky, en el orden dado)
 * reescalada para que el impacto inicial en `shockVar` sea `shockSize`.
 */
export function simulateShock(
  data: number[][],
  names: string[],
  opts: { p: number; shockVar: number; shockSize: number; horizon: number; level?: number; draws?: number },
): ModelShockResult {
  const m = fitVar(data, names, opts.p);
  const level = opts.level ?? 0.9;
  const irf = impulseResponse(m, opts.horizon, { orthogonalized: true, level, draws: opts.draws ?? 500 });
  const P = cholesky(m.sigmaU);
  const scale = opts.shockSize / P[opts.shockVar][opts.shockVar];
  const j = opts.shockVar;
  const pick = (arr: number[][][]) => names.map((_, i) => arr.map((mat) => mat[i][j] * scale));
  const response = pick(irf.irf);
  let lower = pick(irf.lower!);
  let upper = pick(irf.upper!);
  if (scale < 0) [lower, upper] = [upper, lower];
  const cumulative = response.map((r) => {
    let acc = 0;
    return r.map((v) => (acc += v));
  });
  const fc = forecastVar(m, opts.horizon, [level]);
  const notes = [
    `Shock de ${opts.shockSize} en ${names[j]} (un desvío estándar del shock estimado equivale a ${nf(P[j][j], 3)}).`,
    `Identificación recursiva (Cholesky) en el orden: ${names.join(" → ")}. Cambiar el orden puede cambiar las respuestas.`,
    `Bandas al ${Math.round(level * 100)} % por simulación de Monte Carlo de los coeficientes (${irf.draws} réplicas, semilla fija).`,
  ];
  if (!m.stable) notes.push("El VAR no es estable: las respuestas no se disipan y no deben interpretarse.");
  if (Math.abs(opts.shockSize) > 4 * P[j][j]) {
    notes.push("El shock es más de 4 veces el desvío típico observado: el modelo lineal se está extrapolando fuera de lo visto en la muestra.");
  }
  return {
    kind: "model",
    model: { names: m.names, p: m.p, nobs: m.nobs, aic: m.aic, stable: m.stable, spectralRadius: m.spectralRadius },
    shockVar: j,
    shockSize: opts.shockSize,
    response,
    lower,
    upper,
    cumulative,
    level,
    baseline: {
      mean: names.map((_, i) => fc.mean.map((r) => r[i])),
      lower: names.map((_, i) => fc.bands[0].lower.map((r) => r[i])),
      upper: names.map((_, i) => fc.bands[0].upper.map((r) => r[i])),
    },
    notes,
  };
}
