import { parseIsoDate, shiftPeriods, toIsoDate } from "../normalize/dates";
import { pctYoY } from "./transform";
import type { Pt } from "./types";

/**
 * Calculadoras económicas. Funciones puras sobre series oficiales: no estiman
 * datos faltantes. Si falta un dato necesario, lanzan CalcError con el motivo.
 */
export class CalcError extends Error {}

const DAY = 86_400_000;
const r = (v: number) => Number(v.toPrecision(12));

function valueMap(points: Pt[]): Map<string, number> {
  return new Map(points.filter((p) => p.v !== null).map((p) => [p.d, p.v as number]));
}

function prevMonth(month: string): string {
  return toIsoDate(shiftPeriods(parseIsoDate(month)!, "M", -1));
}

function monthsBetween(a: string, b: string): number {
  const x = parseIsoDate(a)!;
  const y = parseIsoDate(b)!;
  return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
}

// ─────────────────────────── Inflación ───────────────────────────

export interface InflationResult {
  fromMonth: string;
  toMonth: string;
  /** Mes base del índice: el anterior al mes inicial (la inflación del mes inicial se incluye). */
  baseMonth: string;
  baseIndex: number;
  endIndex: number;
  months: number;
  /** Inflación acumulada del período, en %. */
  accumulated: number;
  /** Promedio mensual geométrico, en %. */
  monthlyAverage: number;
  /** Tasa anualizada equivalente, en %. */
  annualized: number;
  /** Inflación interanual del mes final, en % (null si no hay dato de 12 meses antes). */
  yoyAtEnd: number | null;
  /** Variación mensual de cada mes del período, en %. */
  monthly: Pt[];
}

/**
 * Inflación entre dos meses con el IPC (índice). Incluye la inflación del mes
 * inicial: acumulada = IPC(final) / IPC(mes anterior al inicial) − 1.
 * Capitalización compuesta: promedio mensual = (1 + acumulada)^(1/n) − 1.
 */
export function inflationBetween(ipc: Pt[], fromMonth: string, toMonth: string): InflationResult {
  if (toMonth < fromMonth) throw new CalcError("El mes final debe ser posterior o igual al inicial.");
  const m = valueMap(ipc);
  const baseMonth = prevMonth(fromMonth);
  const baseIndex = m.get(baseMonth);
  const endIndex = m.get(toMonth);
  if (baseIndex === undefined) {
    throw new CalcError(`No hay IPC publicado para ${baseMonth.slice(0, 7)} (base del cálculo).`);
  }
  if (endIndex === undefined) throw new CalcError(`No hay IPC publicado para ${toMonth.slice(0, 7)}.`);
  const months = monthsBetween(baseMonth, toMonth);
  const monthly: Pt[] = [];
  for (let d = fromMonth; d <= toMonth; d = toIsoDate(shiftPeriods(parseIsoDate(d)!, "M", 1))) {
    const a = m.get(prevMonth(d));
    const b = m.get(d);
    if (a === undefined || b === undefined) throw new CalcError(`Falta el IPC de ${d.slice(0, 7)}: no se completa con estimaciones.`);
    monthly.push({ d, v: r((b / a - 1) * 100) });
  }
  const acc = endIndex / baseIndex - 1;
  const yearAgo = m.get(toIsoDate(shiftPeriods(parseIsoDate(toMonth)!, "M", -12)));
  return {
    fromMonth,
    toMonth,
    baseMonth,
    baseIndex,
    endIndex,
    months,
    accumulated: r(acc * 100),
    monthlyAverage: r((Math.pow(1 + acc, 1 / months) - 1) * 100),
    annualized: r((Math.pow(1 + acc, 12 / months) - 1) * 100),
    yoyAtEnd: yearAgo === undefined ? null : r((endIndex / yearAgo - 1) * 100),
    monthly,
  };
}

/** Actualiza un importe por inflación acumulada (en %). */
export function adjustAmount(amount: number, accumulatedPct: number): number {
  return r(amount * (1 + accumulatedPct / 100));
}

// ─────────────────────────── Tasas reales ───────────────────────────

export interface RealRateResult {
  /** Rendimiento nominal del período (TNA × días / 365), en %. */
  periodNominal: number;
  /** Tasa efectiva anual equivalente (capitalizando cada `days`), en %. */
  tea: number;
  /** Inflación del período, en %. */
  periodInflation: number;
  /** Tasa real del período por Fisher exacta: (1 + i) / (1 + π) − 1, en %. */
  periodReal: number;
  /** Tasa real efectiva anual, en %. */
  realAnnual: number;
  /** Aproximación lineal de Fisher (i − π), en %, solo como referencia. */
  fisherApprox: number;
}

/**
 * Tasa real con la ecuación de Fisher.
 * @param tna tasa nominal anual en % (convención de 365 días)
 * @param days plazo de la colocación en días
 * @param monthlyInflation inflación mensual en %, que se capitaliza al plazo
 */
export function realRate(tna: number, days: number, monthlyInflation: number): RealRateResult {
  if (!(days > 0)) throw new CalcError("El plazo debe ser mayor a cero.");
  if (!(tna > -100)) throw new CalcError("Tasa nominal inválida.");
  const i = (tna / 100) * (days / 365);
  const pi = Math.pow(1 + monthlyInflation / 100, days / (365 / 12)) - 1;
  const real = (1 + i) / (1 + pi) - 1;
  return {
    periodNominal: r(i * 100),
    tea: r((Math.pow(1 + i, 365 / days) - 1) * 100),
    periodInflation: r(pi * 100),
    periodReal: r(real * 100),
    realAnnual: r((Math.pow(1 + real, 365 / days) - 1) * 100),
    fisherApprox: r((i - pi) * 100),
  };
}

/** Inflación mensual de referencia a partir del IPC: último mes, promedio de 3 meses o equivalente mensual interanual. */
export function referenceMonthlyInflation(ipc: Pt[], mode: "last" | "avg3" | "yoy"): { value: number; month: string } {
  const pts = ipc.filter((p) => p.v !== null);
  if (pts.length < 13) throw new CalcError("No hay suficiente historia de IPC.");
  const last = pts[pts.length - 1];
  const back = (n: number) => {
    const target = toIsoDate(shiftPeriods(parseIsoDate(last.d)!, "M", -n));
    const p = pts.find((x) => x.d === target);
    if (!p) throw new CalcError(`Falta el IPC de ${target.slice(0, 7)}.`);
    return p.v as number;
  };
  const n = mode === "last" ? 1 : mode === "avg3" ? 3 : 12;
  const acc = (last.v as number) / back(n);
  return { value: r((Math.pow(acc, 1 / n) - 1) * 100), month: last.d };
}

// ─────────────────────────── Devaluación ───────────────────────────

/** Último dato disponible en o antes de la fecha pedida (sin interpolar). */
export function valueOnOrBefore(points: Pt[], date: string, maxDaysBack = 10): Pt | null {
  let found: Pt | null = null;
  for (const p of points) {
    if (p.d > date) break;
    if (p.v !== null) found = p;
  }
  if (!found) return null;
  const lag = (parseIsoDate(date)!.getTime() - parseIsoDate(found.d)!.getTime()) / DAY;
  return lag <= maxDaysBack ? found : null;
}

export interface DevaluationResult {
  start: Pt;
  end: Pt;
  days: number;
  /** Variación acumulada del tipo de cambio, en %. */
  accumulated: number;
  /** Equivalente anual, en % (solo si el período es de al menos 30 días). */
  annualized: number | null;
  /** Variación interanual a la fecha final, en %. */
  yoyAtEnd: number | null;
}

/** Devaluación entre dos fechas, usando el último dato publicado en o antes de cada fecha. */
export function devaluation(points: Pt[], from: string, to: string): DevaluationResult {
  if (to <= from) throw new CalcError("La fecha final debe ser posterior a la inicial.");
  const start = valueOnOrBefore(points, from);
  const end = valueOnOrBefore(points, to);
  if (!start) throw new CalcError(`No hay cotización publicada en los 10 días previos a ${from}.`);
  if (!end) throw new CalcError(`No hay cotización publicada en los 10 días previos a ${to}.`);
  const days = Math.round((parseIsoDate(end.d)!.getTime() - parseIsoDate(start.d)!.getTime()) / DAY);
  const acc = (end.v as number) / (start.v as number) - 1;
  const yoy = pctYoY(points.filter((p) => p.d <= end.d), "D");
  const last = yoy[yoy.length - 1];
  return {
    start,
    end,
    days,
    accumulated: r(acc * 100),
    annualized: days >= 30 ? r((Math.pow(1 + acc, 365 / days) - 1) * 100) : null,
    yoyAtEnd: last && last.d === end.d ? last.v : null,
  };
}

/** Variación real: deflacta una variación nominal por la inflación del mismo período (ambas en %). */
export function realChange(nominalPct: number, inflationPct: number): number {
  return r(((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100);
}

// ─────────────────────────── Salarios y agregados reales ───────────────────────────

/**
 * Serie real: (X_t / X_base) / (IPC_t / IPC_base) × 100. Solo meses con ambos datos.
 * Si no se indica base, se usa el primer mes común.
 */
export function realIndex(nominal: Pt[], ipc: Pt[], baseMonth?: string): { points: Pt[]; base: string } {
  const p = valueMap(ipc);
  const common = nominal.filter((x) => x.v !== null && p.has(x.d));
  if (!common.length) throw new CalcError("No hay meses con datos de ambas series.");
  const base = baseMonth ? common.find((x) => x.d >= baseMonth) : common[0];
  if (!base) throw new CalcError("No hay datos en el mes base elegido.");
  const nb = base.v as number;
  const pb = p.get(base.d)!;
  return {
    base: base.d,
    points: common.map((x) => ({ d: x.d, v: r(((x.v as number) / nb / (p.get(x.d)! / pb)) * 100) })),
  };
}

/** Expresa una serie nominal en pesos constantes de `refMonth` (por defecto, el último IPC). */
export function toConstantPesos(nominal: Pt[], ipc: Pt[], refMonth?: string): { points: Pt[]; refMonth: string } {
  const p = valueMap(ipc);
  const ref = refMonth ?? [...p.keys()].sort().pop();
  if (!ref || !p.has(ref)) throw new CalcError("No hay IPC para el mes de referencia.");
  const pr = p.get(ref)!;
  return {
    refMonth: ref,
    points: nominal.filter((x) => p.has(x.d)).map((x) => ({ d: x.d, v: x.v === null ? null : r((x.v * pr) / p.get(x.d)!) })),
  };
}

export interface WageComparison {
  /** Monto que en `toMonth` equivale al poder adquisitivo de `amountFrom` en `fromMonth`. */
  equivalentAtEnd: number;
  /** Salario de `toMonth` expresado en pesos de `fromMonth`. */
  realOfEndInStartPesos: number | null;
  /** Variación real del salario entre ambos meses, en % (si se informó el salario final). */
  realChangePct: number | null;
  inflationPct: number;
}

/** Compara dos salarios nominales en el tiempo con el IPC. */
export function compareWages(ipc: Pt[], fromMonth: string, amountFrom: number, toMonth: string, amountTo?: number): WageComparison {
  const p = valueMap(ipc);
  const a = p.get(fromMonth);
  const b = p.get(toMonth);
  if (a === undefined) throw new CalcError(`No hay IPC para ${fromMonth.slice(0, 7)}.`);
  if (b === undefined) throw new CalcError(`No hay IPC para ${toMonth.slice(0, 7)}.`);
  const infl = b / a - 1;
  return {
    equivalentAtEnd: r(amountFrom * (b / a)),
    realOfEndInStartPesos: amountTo === undefined ? null : r(amountTo * (a / b)),
    realChangePct: amountTo === undefined ? null : r(((amountTo / amountFrom) / (b / a) - 1) * 100),
    inflationPct: r(infl * 100),
  };
}
