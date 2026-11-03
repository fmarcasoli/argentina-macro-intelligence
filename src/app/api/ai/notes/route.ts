import type { NextRequest } from "next/server";
import type postgres from "postgres";
import { fail, guard, sql } from "@/lib/ai/memory";
import { MEMORY_LIMITS, validateNote } from "@/lib/ai/memory-validate";

/** Conclusiones guardadas (con sus gráficos y fuentes). GET ?space= · POST { title, body, blocks, sources, space_id?, conversation_id? } */
export async function GET(req: NextRequest) {
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ notes: [] });
  const space = req.nextUrl.searchParams.get("space");
  try {
    const rows = await sql()`
      select id, title, body, blocks, sources, space_id, conversation_id, created_at from research_notes
      where workspace_id = ${g.ws} ${space && /^[0-9a-f-]{36}$/i.test(space) ? sql()`and space_id = ${space}` : sql()``}
      order by created_at desc limit 500`;
    return Response.json({ notes: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  const v = validateNote(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const g = await guard(true);
  if (g instanceof Response) return g;
  try {
    const db = sql();
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from research_notes where workspace_id = ${g.ws}`;
    if (n >= MEMORY_LIMITS.notes) return Response.json({ error: `Máximo ${MEMORY_LIMITS.notes} conclusiones` }, { status: 409 });
    for (const [table, ref] of [["research_spaces", v.value.space_id], ["ai_conversations", v.value.conversation_id]] as const) {
      if (!ref) continue;
      const own = table === "research_spaces" ? await db`select 1 from research_spaces where id = ${ref} and workspace_id = ${g.ws}` : await db`select 1 from ai_conversations where id = ${ref} and workspace_id = ${g.ws}`;
      if (!own.length) return Response.json({ error: "Referencia inexistente" }, { status: 404 });
    }
    const [row] = await db`
      insert into research_notes (workspace_id, space_id, conversation_id, title, body, blocks, sources)
      values (${g.ws}, ${v.value.space_id}, ${v.value.conversation_id}, ${v.value.title}, ${v.value.body}, ${db.json(v.value.blocks as postgres.JSONValue)}, ${db.json(v.value.sources as postgres.JSONValue)})
      returning id, title, created_at`;
    return Response.json({ note: row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
