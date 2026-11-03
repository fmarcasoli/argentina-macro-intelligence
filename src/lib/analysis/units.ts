/**
 * Clasificación de unidades para decidir qué series pueden compartir un eje y
 * qué transformaciones tienen sentido. Las fuentes escriben las unidades como
 * texto libre ("En millones de ARS", "Porcentaje", "Índice 2004=100"…).
 */
export type UnitFamily = "percent" | "index" | "fx" | "ars" | "usd" | "count" | "other";

export function unitFamily(unit: string, name = ""): UnitFamily {
  const u = unit.toLowerCase();
  const n = name.toLowerCase();
  if (/%|porcentaje|por ciento|\btna\b|\btea\b/.test(u) || /^tasa de inter/.test(n)) return "percent";
  if (/\$\s*\/\s*usd|pesos? argentinos? por d[oó]lar|ars\s*\/\s*usd|tipo de cambio/.test(u) || /^tipo de cambio/.test(n)) return "fx";
  if (/[ií]ndice|=\s*100|base\s|coeficiente|\bcer\b|\buva\b|\buvi\b/.test(u)) return "index";
  if (/usd|d[oó]lares/.test(u)) return "usd";
  if (/\bars\b|pesos|\$/.test(u)) return "ars";
  if (/personas|habitantes|noches|puestos|unidades|cantidad/.test(u)) return "count";
  return "other";
}

/** Escala declarada en la unidad ("millones de", "miles de"), para no comparar magnitudes distintas. */
export function unitScale(unit: string): number {
  const u = unit.toLowerCase();
  if (/miles de millones/.test(u)) return 1e9;
  if (/millones/.test(u)) return 1e6;
  if (/miles/.test(u)) return 1e3;
  return 1;
}

/** Normaliza el texto de la unidad para comparar igualdad ("En millones de ARS" == "millones de ars"). */
export function normalizeUnit(unit: string): string {
  return unit
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^en\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Base declarada de un índice (ej. "2004=100" → "2004", "dic-2016=100" → "dic-2016"). */
export function indexBase(text: string): string | null {
  const m = /(?:base\s+)?((?:(?<![a-záéíóúñ])(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*[-\s.]?)?(?:19|20)\d{2})\s*=\s*(?:100|1\b)/i.exec(text);
  if (m) return m[1].toLowerCase().replace(/\s+/g, "");
  const b = /base\s+((?:[a-z]+\s+)?(?:19|20)\d{2})/i.exec(text);
  return b ? b[1].toLowerCase().replace(/\s+/g, "") : null;
}

/** Series en pesos corrientes: las únicas que se pueden deflactar por IPC. */
export function isNominalPesos(unit: string, name: string): boolean {
  return unitFamily(unit, name) === "ars" && !/constantes|reales?\b/i.test(`${unit} ${name}`);
}
