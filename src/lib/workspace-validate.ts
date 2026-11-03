import { LIMITS } from "./workspace-limits";

/** Valida el cuerpo de un análisis guardado (título, tipo, definición). */
const KINDS = new Set(["analysis", "chart", "calculator"]);

export function validateAnalysisBody(body: unknown):
  | { ok: true; title: string; kind: string; definition: Record<string, unknown>; ids: string[] }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Cuerpo inválido" };
  const b = body as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > LIMITS.title) return { ok: false, error: `Título obligatorio (máx. ${LIMITS.title} caracteres)` };
  const kind = typeof b.kind === "string" && KINDS.has(b.kind) ? b.kind : "analysis";
  if (!b.definition || typeof b.definition !== "object" || Array.isArray(b.definition)) {
    return { ok: false, error: "definition debe ser un objeto" };
  }
  const definition = b.definition as Record<string, unknown>;
  if (JSON.stringify(definition).length > LIMITS.definitionBytes) return { ok: false, error: "Definición demasiado grande" };
  const ids = Array.isArray(definition.ids)
    ? (definition.ids as unknown[]).filter((x): x is string => typeof x === "string" && /^[\w.\-]{1,120}$/.test(x)).slice(0, 8)
    : [];
  return { ok: true, title, kind, definition, ids };
}

