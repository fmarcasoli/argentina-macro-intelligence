import type { Frequency } from "../connectors/types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/** Parsea "YYYY-MM-DD" (ignora hora si viene) a fecha UTC. Devuelve null si es inválida. */
export function parseIsoDate(input: string): Date | null {
  if (typeof input !== "string") return null;
  const m = ISO_DATE.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Rechaza fechas imposibles (ej. 2026-02-30) que Date "corrige" en silencio.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Alinea una fecha al inicio de su período de referencia.
 * Ej.: BCRA informa los datos mensuales al 31/08 y el INDEC al 01/08:
 * ambos se guardan como 2026-08-01.
 */
export function alignToPeriodStart(d: Date, freq: Frequency): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (freq) {
    case "D":
    case "W":
      return new Date(Date.UTC(y, m, d.getUTCDate()));
    case "M":
      return new Date(Date.UTC(y, m, 1));
    case "Q":
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
    case "S":
      return new Date(Date.UTC(y, m < 6 ? 0 : 6, 1));
    case "A":
      return new Date(Date.UTC(y, 0, 1));
  }
}

/** Desplaza una fecha alineada `n` períodos (n puede ser negativo). */
export function shiftPeriods(d: Date, freq: Frequency, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (freq) {
    case "D":
      return new Date(Date.UTC(y, m, day + n));
    case "W":
      return new Date(Date.UTC(y, m, day + 7 * n));
    case "M":
      return new Date(Date.UTC(y, m + n, 1));
    case "Q":
      return new Date(Date.UTC(y, m + 3 * n, 1));
    case "S":
      return new Date(Date.UTC(y, m + 6 * n, 1));
    case "A":
      return new Date(Date.UTC(y + n, 0, 1));
  }
}

/** Cantidad de períodos en un año para cada frecuencia (para variaciones interanuales). */
export const PERIODS_PER_YEAR: Record<Exclude<Frequency, "D">, number> = { W: 52, M: 12, Q: 4, S: 2, A: 1 };

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) throw new Error(`Fecha inválida: ${iso}`);
  return toIsoDate(new Date(d.getTime() + days * 86_400_000));
}

/** Etiqueta legible del período: 2026-08-01 (M) → "ago 2026". */
export function formatPeriod(iso: string, freq: Frequency): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (freq) {
    case "D":
    case "W":
      return `${String(d.getUTCDate()).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${y}`;
    case "M":
      return `${months[m]} ${y}`;
    case "Q":
      return `T${Math.floor(m / 3) + 1} ${y}`;
    case "S":
      return `S${m < 6 ? 1 : 2} ${y}`;
    case "A":
      return String(y);
  }
}
