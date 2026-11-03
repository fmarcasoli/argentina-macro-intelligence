import type { Frequency, RawObservation, ValueKind } from "../connectors/types";
import { alignToPeriodStart, parseIsoDate, toIsoDate } from "./dates";
import { todayAR } from "../utils/time";

export interface NormalizedObservation {
  /** Inicio del período de referencia (YYYY-MM-DD). */
  refDate: string;
  /** Fecha exactamente como la informó la fuente. */
  sourceRefDate: string;
  /** null = dato faltante en la fuente. Nunca se convierte a 0. */
  value: number | null;
  /** Valor original como texto, para trazabilidad. */
  rawValue: string | null;
  valueKind: ValueKind;
  /** La fuente publicó el dato con fecha futura (ej. UVA/CER programados). */
  isScheduled: boolean;
}

export type RejectReason =
  | "invalid_date"
  | "invalid_value"
  | "non_finite"
  | "duplicate_period"
  | "out_of_range";

export interface RejectedObservation {
  raw: RawObservation;
  reason: RejectReason;
  detail?: string;
}

export interface NormalizeOptions {
  frequency: Frequency;
  /**
   * Factor de escala. 1 = el valor se guarda tal cual (value_kind "original").
   * Distinto de 1 (ej. 100 para pasar proporciones a %) => "normalized".
   */
  scale?: number;
  /** Fecha de hoy (YYYY-MM-DD) para detectar datos programados. Inyectable en tests. */
  today?: string;
  /** Rechaza fechas anteriores a este límite (protección contra basura). */
  minDate?: string;
  /** Rechaza fechas posteriores a hoy + N días (datos programados permitidos dentro del margen). */
  maxFutureDays?: number;
}

export interface NormalizeResult {
  observations: NormalizedObservation[];
  rejected: RejectedObservation[];
  stats: { received: number; accepted: number; missing: number; scheduled: number; rejected: number };
}

/**
 * Convierte un valor crudo en número sin inventar datos:
 *   number finito      -> number
 *   null / "" / "NaN"  -> null (faltante)
 *   string numérico    -> number ("1234.5"; también "1.234,5" con formato local)
 *   cualquier otra cosa -> error
 */
export function parseValue(v: unknown): { ok: true; value: number | null } | { ok: false; reason: RejectReason } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { ok: true, value: null };
    if (!Number.isFinite(v)) return { ok: false, reason: "non_finite" };
    return { ok: true, value: v };
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || /^(nan|null|n\/?a|s\/?d|-)$/i.test(s)) return { ok: true, value: null };
    let normalized = s;
    // Formato local solo si no es ambiguo: "1.234,5", "1.234.567" o "12,5".
    // "1.234" se interpreta como decimal (formato de las APIs).
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d{1,3}(\.\d{3}){2,}$/.test(s) || /^-?\d+,\d+$/.test(s)) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    }
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(normalized)) return { ok: false, reason: "invalid_value" };
    const n = Number(normalized);
    if (!Number.isFinite(n)) return { ok: false, reason: "non_finite" };
    return { ok: true, value: n };
  }
  return { ok: false, reason: "invalid_value" };
}

/** Evita ruido de coma flotante al escalar (0.0211377 * 100 = 2.1137700000000003). */
function applyScale(value: number, scale: number): number {
  if (scale === 1) return value;
  return Number((value * scale).toPrecision(15));
}

export function normalizeObservations(raw: RawObservation[], opts: NormalizeOptions): NormalizeResult {
  const scale = opts.scale ?? 1;
  const valueKind: ValueKind = scale === 1 ? "original" : "normalized";
  const today = opts.today ?? todayAR();
  const maxFuture = opts.maxFutureDays ?? 400;
  const todayDate = parseIsoDate(today)!;
  const maxDate = new Date(todayDate.getTime() + maxFuture * 86_400_000);
  const minDate = parseIsoDate(opts.minDate ?? "1900-01-01")!;

  const rejected: RejectedObservation[] = [];
  const byPeriod = new Map<string, NormalizedObservation & { _src: number }>();

  for (const r of raw) {
    const d = parseIsoDate(r.date);
    if (!d) {
      rejected.push({ raw: r, reason: "invalid_date", detail: String(r.date) });
      continue;
    }
    if (d < minDate || d > maxDate) {
      rejected.push({ raw: r, reason: "out_of_range", detail: toIsoDate(d) });
      continue;
    }
    const parsed = parseValue(r.value);
    if (!parsed.ok) {
      rejected.push({ raw: r, reason: parsed.reason, detail: String(r.value) });
      continue;
    }
    const refDate = toIsoDate(alignToPeriodStart(d, opts.frequency));
    const obs = {
      refDate,
      sourceRefDate: toIsoDate(d),
      value: parsed.value === null ? null : applyScale(parsed.value, scale),
      rawValue: r.value === null || r.value === undefined ? null : String(r.value),
      valueKind,
      isScheduled: d > todayDate,
      _src: d.getTime(),
    };
    const prev = byPeriod.get(refDate);
    if (!prev) {
      byPeriod.set(refDate, obs);
      continue;
    }
    // Dos registros para el mismo período: si son idénticos es un duplicado
    // inocuo; si difieren, se conserva el de fecha de fuente más reciente y se
    // registra el descartado.
    if (prev.value === obs.value) continue;
    const [keep, drop] = obs._src >= prev._src ? [obs, prev] : [prev, obs];
    byPeriod.set(refDate, keep);
    rejected.push({
      raw: { date: drop.sourceRefDate, value: drop.rawValue },
      reason: "duplicate_period",
      detail: `período ${refDate}: se conserva ${keep.sourceRefDate}`,
    });
  }

  const observations = [...byPeriod.values()]
    .sort((a, b) => (a.refDate < b.refDate ? -1 : a.refDate > b.refDate ? 1 : 0))
    .map((o): NormalizedObservation => ({
      refDate: o.refDate,
      sourceRefDate: o.sourceRefDate,
      value: o.value,
      rawValue: o.rawValue,
      valueKind: o.valueKind,
      isScheduled: o.isScheduled,
    }));

  return {
    observations,
    rejected,
    stats: {
      received: raw.length,
      accepted: observations.length,
      missing: observations.filter((o) => o.value === null).length,
      scheduled: observations.filter((o) => o.isScheduled).length,
      rejected: rejected.length,
    },
  };
}
