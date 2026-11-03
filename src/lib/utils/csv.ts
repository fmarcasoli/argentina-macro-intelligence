/**
 * Parser CSV RFC 4180 (comillas, comas y saltos de línea dentro de campos).
 * Devuelve un objeto por fila usando la primera fila como encabezado.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = r[j] ?? "";
    out.push(obj);
  }
  return out;
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
