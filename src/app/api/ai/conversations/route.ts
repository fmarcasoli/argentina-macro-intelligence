import type { NextRequest } from "next/server";
import type postgres from "postgres";
import { fail, guard, sql } from "@/lib/ai/memory";
import { MEMORY_LIMITS, validateConversation } from "@/lib/ai/memory-validate";

/** Conversaciones de MACRO AI del espacio de trabajo. GET lista · POST crea { title, space_id?, turns } */
export async function GET(req: NextRequest) {
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ conversations: [] });
  const space = req.nextUrl.searchParams.get("space");
  try {
    const rows = await sql()`
      select id, title, space_id, jsonb_array_length(turns)::int as turn_count, created_at, updated_at
      from ai_conversations where workspace_id = ${g.ws}
        ${space && /^[0-9a-f-]{36}$/i.test(space) ? sql()`and space_id = ${space}` : sql()``}
      order by updated_at desc limit 300`;
    return Response.json({ conversations: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  const v = validateConversation(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const g = await guard(true);
  if (g instanceof Response) return g;
  try {
    const db = sql();
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from ai_conversations where workspace_id = ${g.ws}`;
    if (n >= MEMORY_LIMITS.conversations) return Response.json({ error: `Máximo ${MEMORY_LIMITS.conversations} conversaciones: borrá alguna` }, { status: 409 });
    if (v.value.space_id) {
      const own = await db`select 1 from research_spaces where id = ${v.value.space_id} and workspace_id = ${g.ws}`;
      if (!own.length) return Response.json({ error: "Espacio inexistente" }, { status: 404 });
    }
    const [row] = await db`
      insert into ai_conversations (workspace_id, space_id, title, turns)
      values (${g.ws}, ${v.value.space_id ?? null}, ${v.value.title!}, ${db.json(v.value.turns as postgres.JSONValue)})
      returning id, title, space_id, created_at, updated_at`;
    return Response.json({ conversation: row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
