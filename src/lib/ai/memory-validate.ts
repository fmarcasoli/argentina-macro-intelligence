/** Validación de la memoria de investigación (sin dependencias del servidor, testeable). */
export const MEMORY_LIMITS = { conversations: 300, spaces: 50, notes: 500, conversationBytes: 2_000_000, noteBlocksBytes: 500_000 };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ok<T> = { ok: true; value: T } | { ok: false; error: string };

const title = (v: unknown, max = 160): string | null => (typeof v === "string" && v.trim().length >= 1 ? v.trim().slice(0, max) : null);
const optUuid = (v: unknown): string | null | undefined => (v === null ? null : v === undefined ? undefined : typeof v === "string" && UUID.test(v) ? v : undefined);

export function validateConversation(body: unknown, partial = false): Ok<{ title?: string; space_id?: string | null; turns?: unknown[] }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: { title?: string; space_id?: string | null; turns?: unknown[] } = {};
  if (b.title !== undefined || !partial) {
    const t = title(b.title);
    if (!t) return { ok: false, error: "Título inválido" };
    out.title = t;
  }
  if (b.space_id !== undefined) {
    const s = optUuid(b.space_id);
    if (s === undefined) return { ok: false, error: "Espacio inválido" };
    out.space_id = s;
  }
  if (b.turns !== undefined || !partial) {
    if (!Array.isArray(b.turns)) return { ok: false, error: "turns debe ser una lista" };
    if (b.turns.length > 400) return { ok: false, error: "Conversación demasiado larga" };
    for (const t of b.turns) {
      const r = (t as { role?: unknown })?.role;
      if (r !== "user" && r !== "assistant") return { ok: false, error: "Mensaje inválido" };
      if (typeof (t as { content?: unknown }).content !== "string") return { ok: false, error: "Mensaje inválido" };
    }
    if (JSON.stringify(b.turns).length > MEMORY_LIMITS.conversationBytes) return { ok: false, error: "La conversación supera 2 MB" };
    out.turns = b.turns;
  }
  return { ok: true, value: out };
}

export function validateSpace(body: unknown): Ok<{ name: string; description: string | null }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = title(b.name, 120);
  if (!name) return { ok: false, error: "Nombre inválido" };
  const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 1000) : null;
  return { ok: true, value: { name, description } };
}

export function validateNote(body: unknown): Ok<{ title: string; body: string; blocks: unknown[]; sources: unknown[]; space_id: string | null; conversation_id: string | null }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const t = title(b.title);
  if (!t) return { ok: false, error: "Título inválido" };
  if (typeof b.body !== "string" || b.body.length > 20000) return { ok: false, error: "Texto inválido" };
  const blocks = Array.isArray(b.blocks) ? b.blocks : [];
  const sources = Array.isArray(b.sources) ? b.sources : [];
  if (JSON.stringify(blocks).length > MEMORY_LIMITS.noteBlocksBytes) return { ok: false, error: "Los gráficos asociados superan 500 KB" };
  const space = optUuid(b.space_id ?? null);
  const conv = optUuid(b.conversation_id ?? null);
  if (space === undefined || conv === undefined) return { ok: false, error: "Referencia inválida" };
  return { ok: true, value: { title: t, body: b.body, blocks, sources, space_id: space, conversation_id: conv } };
}
