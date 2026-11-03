import type { Frequency } from "./connectors/types";
import { formatPeriod } from "./normalize/dates";

const LOCALE = "es-AR";

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  D: "Diaria",
  W: "Semanal",
  M: "Mensual",
  Q: "Trimestral",
  S: "Semestral",
  A: "Anual",
};

/** La unidad es una tasa o variación: los cambios se expresan en puntos porcentuales. */
export function isPercentUnit(unit: string): boolean {
  return /%|porcentaje|variaci[oó]n/i.test(unit);
}

function decimalsFor(v: number): number {
  if (Number.isInteger(v)) return 0;
  return Math.abs(v) >= 1 ? 2 : 4;
}

export function formatNumber(v: number | null | undefined, opts: { decimals?: number; compact?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (opts.compact && abs >= 1e6) {
    return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 2 }).format(v);
  }
  const d = opts.decimals ?? decimalsFor(v);
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

/** Valor con sufijo de unidad corto cuando es obvio (%). */
export function formatValue(v: number | null | undefined, unit: string, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const s = formatNumber(v, { compact: opts.compact });
  return isPercentUnit(unit) ? `${s} %` : s;
}

export interface Change {
  value: number;
  /** "pp" (puntos porcentuales) o "%" (variación relativa). */
  kind: "pp" | "%";
}

export function computeChange(last: number | null, prev: number | null, unit: string): Change | null {
  if (last === null || prev === null) return null;
  if (isPercentUnit(unit)) return { value: last - prev, kind: "pp" };
  if (prev === 0) return null;
  return { value: (last / prev - 1) * 100, kind: "%" };
}

export function formatChange(c: Change | null): string {
  if (!c) return "—";
  const sign = c.value > 0 ? "+" : c.value < 0 ? "−" : "";
  const n = formatNumber(Math.abs(c.value), { decimals: 2 });
  return c.kind === "pp" ? `${sign}${n} pp` : `${sign}${n} %`;
}

export function periodLabel(iso: string | null, freq: Frequency): string {
  return iso ? formatPeriod(iso, freq) : "—";
}

export function formatDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(d));
}

/** Unidad abreviada para encabezados de tabla. */
export function shortUnit(unit: string): string {
  return unit
    .replace(/^En /i, "")
    .replace(/millones de/i, "M")
    .replace(/miles de/i, "miles")
    .replace(/Pesos argentinos por dólar estadounidense/i, "$/USD")
    .replace(/porcentaje nominal anual/i, "% TNA")
    .replace(/porcentaje efectivo anual/i, "% TEA");
}
