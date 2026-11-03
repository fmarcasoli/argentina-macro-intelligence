/**
 * Vocabulario económico → series del catálogo, y lectura de períodos en
 * español ("últimos 24 meses", "desde 2020", "entre 2020 y 2025").
 * Lo usa el planificador sin modelo y sirve de pista al modelo de lenguaje.
 */

export interface Concept {
  /** Serie del catálogo. */
  id: string;
  label: string;
  /** Receta por defecto para analizarla (clave de RECIPES del motor econométrico). */
  recipe: "level" | "logdiff" | "yoy" | "pct";
  /** Expresiones que la identifican (sin acentos, minúsculas). */
  patterns: RegExp[];
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const normalizeText = strip;

/** Ordenados de lo más específico a lo más general. */
export const CONCEPTS: Concept[] = [
  { id: "calc.salarios_reales", label: "Salario real", recipe: "level", patterns: [/salario(s)? real(es)?/, /poder adquisitivo/] },
  { id: "indec.salarios", label: "Índice de salarios", recipe: "level", patterns: [/salario(s)?/, /sueldo(s)?/] },
  { id: "bcra.reservas", label: "Reservas internacionales", recipe: "level", patterns: [/reserva(s)?/] },
  { id: "bcra.base_monetaria", label: "Base monetaria", recipe: "level", patterns: [/base monetaria/, /emision/, /expansion monetaria/] },
  { id: "bcra.m2", label: "M2", recipe: "level", patterns: [/\bm2\b/, /agregados? monetarios?/] },
  { id: "bcra.m1", label: "M1", recipe: "level", patterns: [/\bm1\b/] },
  { id: "bcra.m3", label: "M3", recipe: "level", patterns: [/\bm3\b/] },
  { id: "indec.ipc_nivel_general", label: "Inflación (IPC)", recipe: "logdiff", patterns: [/inflacion/, /\bipc\b/, /precios al consumidor/] },
  { id: "bcra.tc_mayorista", label: "Tipo de cambio mayorista", recipe: "level", patterns: [/tipo de cambio/, /\bdolar\b/, /cambiari[oa]/, /devaluacion/] },
  { id: "bcra.plazo_fijo_30d", label: "Tasa de plazo fijo", recipe: "level", patterns: [/plazo fijo/] },
  { id: "bcra.tamar", label: "Tasa TAMAR", recipe: "level", patterns: [/tamar/] },
  { id: "bcra.badlar", label: "Tasa BADLAR", recipe: "level", patterns: [/badlar/, /tasas? de interes/, /\btasas?\b/] },
  { id: "bcra.prestamos_privados", label: "Préstamos al sector privado", recipe: "level", patterns: [/prestamos?/, /credito/] },
  { id: "bcra.depositos_privados_pesos", label: "Depósitos privados en pesos", recipe: "level", patterns: [/depositos?/] },
  { id: "indec.emae_desest", label: "EMAE desestacionalizado", recipe: "level", patterns: [/\bemae\b/, /actividad( economica)?/] },
  { id: "indec.pib_real", label: "PIB real", recipe: "level", patterns: [/\bpbi\b/, /\bpib\b/, /producto bruto/] },
  { id: "indec.exportaciones", label: "Exportaciones", recipe: "level", patterns: [/exportacion(es)?/] },
  { id: "indec.importaciones", label: "Importaciones", recipe: "level", patterns: [/importacion(es)?/] },
  { id: "indec.desempleo", label: "Tasa de desocupación", recipe: "level", patterns: [/desocupacion/, /desempleo/] },
  { id: "bcra.cer", label: "CER", recipe: "level", patterns: [/\bcer\b/] },
  { id: "bcra.uva", label: "UVA", recipe: "level", patterns: [/\buva\b/] },
];

/** Conceptos mencionados en el texto, en el orden en que aparecen, sin duplicados. */
export function findConcepts(text: string): Concept[] {
  const t = strip(text);
  const hits: { c: Concept; pos: number }[] = [];
  const taken: [number, number][] = [];
  for (const c of CONCEPTS) {
    for (const p of c.patterns) {
      const m = p.exec(t);
      if (!m) continue;
      const span: [number, number] = [m.index, m.index + m[0].length];
      // Un tramo de texto se asigna al concepto más específico (el primero de la lista).
      if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue;
      taken.push(span);
      if (!hits.some((h) => h.c.id === c.id)) hits.push({ c, pos: m.index });
      break;
    }
  }
  return hits.sort((a, b) => a.pos - b.pos).map((h) => h.c);
}

export interface Period {
  from?: string;
  to?: string;
  /** Descripción legible de lo entendido. */
  label: string;
}

const NUM: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, diez: 10, doce: 12 };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
function monthYear(s: string): { y: number; m: number } | null {
  const mm = new RegExp(`(${MONTHS.join("|")}|setiembre)\\s+(?:de\\s+)?(\\d{4})`).exec(s);
  if (mm) return { y: Number(mm[2]), m: mm[1] === "setiembre" ? 9 : MONTHS.indexOf(mm[1]) + 1 };
  return null;
}

/**
 * Período pedido en el texto. `today` = fecha de referencia (último dato o hoy).
 * Devuelve un rango vacío si no se menciona ninguno.
 */
export function parsePeriod(text: string, today: string): Period {
  const t = strip(text);
  const [ty, tm] = today.split("-").map(Number);
  const back = (months: number) => {
    const total = ty * 12 + (tm - 1) - months;
    return iso(Math.floor(total / 12), (total % 12) + 1);
  };
  let m = /ultim[oa]s?\s+(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|diez|doce)?\s*(mes(es)?|anos?|años?)/.exec(t);
  if (m) {
    const n = m[1] ? (NUM[m[1]] ?? Number(m[1])) : 1;
    const months = /mes/.test(m[2]) ? n : n * 12;
    return { from: back(months - 1), label: `últimos ${n} ${/mes/.test(m[2]) ? (n === 1 ? "mes" : "meses") : n === 1 ? "año" : "años"}` };
  }
  const a = monthYear(t.slice(t.search(/(desde|entre|de)\s/) >= 0 ? t.search(/(desde|entre|de)\s/) : 0));
  m = /entre\s+(?:(?:el\s+)?(?:\d{1,2}\s+de\s+)?)?([a-z]+\s+(?:de\s+)?)?(\d{4})\s+y\s+(?:(?:el\s+)?(?:\d{1,2}\s+de\s+)?)?([a-z]+\s+(?:de\s+)?)?(\d{4})/.exec(t);
  if (m) {
    const m1 = m[1] ? MONTHS.indexOf(m[1].replace(/\s+de\s*$/, "").trim()) + 1 : 1;
    const m2 = m[3] ? MONTHS.indexOf(m[3].replace(/\s+de\s*$/, "").trim()) + 1 : 12;
    return { from: iso(Number(m[2]), m1 > 0 ? m1 : 1), to: iso(Number(m[4]), m2 > 0 ? m2 : 12), label: `${m[1] ?? ""}${m[2]} a ${m[3] ?? ""}${m[4]}`.trim() };
  }
  m = /(?:desde|a partir de)\s+(?:(?:el\s+)?(?:\d{1,2}\s+de\s+)?)?([a-z]+\s+(?:de\s+)?)?(\d{4})/.exec(t);
  if (m) {
    const mo = m[1] ? MONTHS.indexOf(m[1].replace(/\s+de\s*$/, "").trim()) + 1 : 1;
    return { from: iso(Number(m[2]), mo > 0 ? mo : 1), label: `desde ${m[1] ?? ""}${m[2]}` };
  }
  m = /\ben(?: el)?(?: ano)?\s+(\d{4})\b/.exec(t);
  if (m) return { from: iso(Number(m[1]), 1), to: iso(Number(m[1]), 12), label: `año ${m[1]}` };
  if (a) return { from: iso(a.y, a.m), label: `desde ${MONTHS[a.m - 1]} ${a.y}` };
  return { label: "período completo disponible" };
}
