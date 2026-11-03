/** Zona horaria de referencia de los datos oficiales. */
export const AR_TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * Fecha de hoy (YYYY-MM-DD) en hora argentina. Usar UTC haría que después
 * de las 21 h los datos programados de mañana (UVA, CER) se tomen como observados.
 */
export function todayAR(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
