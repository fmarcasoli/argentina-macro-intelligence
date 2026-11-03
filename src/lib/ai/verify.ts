import type { Block, ToolResult } from "./types";

/**
 * Verificación de cifras: cada número que el modelo escribe en su respuesta
 * debe aparecer (con el redondeo usado) en los resultados de las
 * herramientas. Los que no aparecen se marcan como "no verificados".
 * Se ignoran años, fechas y enteros chicos (rezagos, cantidad de meses).
 */

/** Convierte "1.234,56" o "1234.56" o "33,5" a número. */
export function parseNumber(raw: string): { value: number; decimals: number } | null {
  let s = raw.replace(/\s/g, "").replace(/^[+−-]/, (m) => (m === "+" ? "" : "-"));
  let decimals = 0;
  if (/,\d+$/.test(s)) {
    decimals = s.split(",")[1].length;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{1,2}$/.test(s) && !/\.\d{3}$/.test(s)) {
    decimals = s.split(".").pop()!.length;
  } else {
    s = s.replace(/\./g, "");
  }
  const v = Number(s);
  return Number.isFinite(v) ? { value: v, decimals } : null;
}

const NUM_RE = /[+−-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[+−-]?\d+(?:[.,]\d+)?/g;

function referenceNumbers(results: ToolResult[]): number[] {
  const out: number[] = [];
  const add = (txt: string) => {
    for (const m of txt.match(NUM_RE) ?? []) {
      const p = parseNumber(m);
      if (p) out.push(p.value);
    }
  };
  const fromBlock = (b: Block) => {
    if (b.type === "table") b.rows.forEach((r) => r.forEach((c) => (typeof c === "number" ? out.push(c) : typeof c === "string" ? add(c) : null)));
    else if (b.type === "stats") b.items.forEach((i) => add(`${i.value} ${i.note ?? ""}`));
    else if (b.type === "chart") b.rows.forEach((r) => Object.values(r).forEach((c) => (typeof c === "number" ? out.push(c) : null)));
    else if (b.type === "text" || b.type === "notes") add(b.type === "text" ? b.text : b.items.join(" "));
  };
  for (const r of results) {
    add(r.summary);
    r.blocks.forEach(fromBlock);
  }
  return out;
}

export function verifyNumbers(answer: string, results: ToolResult[]): string[] {
  const refs = referenceNumbers(results);
  const unverified: string[] = [];
  const text = answer.replace(/\b(19|20)\d{2}-\d{2}(-\d{2})?\b/g, " ").replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ");
  for (const m of text.match(NUM_RE) ?? []) {
    const p = parseNumber(m);
    if (!p) continue;
    const v = p.value;
    if (Number.isInteger(v) && p.decimals === 0 && ((v >= 1900 && v <= 2100) || Math.abs(v) <= 36)) continue;
    const tol = 0.5 * Math.pow(10, -p.decimals) + 1e-9;
    const ok = refs.some((r) => Math.abs(r - v) <= tol || Math.abs(Math.abs(r) - Math.abs(v)) <= tol || (Math.abs(r) > 1 && Math.abs(r - v) / Math.abs(r) < 0.005));
    if (!ok && !unverified.includes(m.trim())) unverified.push(m.trim());
  }
  return unverified;
}
