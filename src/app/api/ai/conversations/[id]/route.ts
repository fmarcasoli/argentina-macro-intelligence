import type { NextRequest } from "next/server";
import type postgres from "postgres";
import { fail, guard, sql } from "@/lib/ai/memory";
import { UUID, validateConversation } from "@/lib/ai/memory-validate";

/** Una conversación: GET · PUT { title?, space_id?, turns? } · DELETE */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/ai/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ error: "No encontrada" }, { status: 404 });
  try {
    const [row] = await sql()`select id, title, space_id, turns, created_at, updated_at from ai_conversations where id = ${id} and workspace_id = ${g.ws}`;
    return row ? Response.json({ conversation: row }) : Response.json({ error: "No encontrada" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/ai/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  const v = validateConversation(await req.json().catch(() => null), true);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ error: "No encontrada" }, { status: 404 });
  try {
    const db = sql();
    if (v.value.space_id) {
      const own = await db`select 1 from research_spaces where id = ${v.value.space_id} and workspace_id = ${g.ws}`;
      if (!own.length) return Response.json({ error: "Espacio inexistente" }, { status: 404 });
    }
    const [row] = await db`
      update ai_conversations set
        title = coalesce(${v.value.title ?? null}, title),
        space_id = ${v.value.space_id === undefined ? db`space_id` : v.value.space_id},
        turns = coalesce(${v.value.turns ? db.json(v.value.turns as postgres.JSONValue) : null}, turns),
        updated_at = now()
      where id = ${id} and workspace_id = ${g.ws}
      returning id, title, space_id, updated_at`;
    return row ? Response.json({ conversation: row }) : Response.json({ error: "No encontrada" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/ai/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ ok: true });
  try {
    await sql()`delete from ai_conversations where id = ${id} and workspace_id = ${g.ws}`;
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
