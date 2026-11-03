import { fail, guard, sql } from "@/lib/ai/memory";

/**
 * Controles de privacidad de la memoria de investigación.
 *   GET    exporta todo (espacios, conversaciones y conclusiones) en JSON
 *   DELETE borra todo de forma permanente
 */
export async function GET() {
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ spaces: [], conversations: [], notes: [] });
  try {
    const db = sql();
    const [spaces, conversations, notes] = await Promise.all([
      db`select id, name, description, created_at from research_spaces where workspace_id = ${g.ws}`,
      db`select id, title, space_id, turns, created_at, updated_at from ai_conversations where workspace_id = ${g.ws}`,
      db`select id, title, body, blocks, sources, space_id, conversation_id, created_at from research_notes where workspace_id = ${g.ws}`,
    ]);
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), spaces, conversations, notes }, null, 1), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="macro-ai-memoria-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE() {
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ ok: true, deleted: 0 });
  try {
    const db = sql();
    const r = await db.begin(async (tx) => {
      const a = await tx`delete from research_notes where workspace_id = ${g.ws}`;
      const b = await tx`delete from ai_conversations where workspace_id = ${g.ws}`;
      const c = await tx`delete from research_spaces where workspace_id = ${g.ws}`;
      return a.count + b.count + c.count;
    });
    return Response.json({ ok: true, deleted: r });
  } catch (e) {
    return fail(e);
  }
}
