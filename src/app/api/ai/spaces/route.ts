import type { NextRequest } from "next/server";
import { fail, guard, sql } from "@/lib/ai/memory";
import { MEMORY_LIMITS, validateSpace } from "@/lib/ai/memory-validate";

/** Espacios de investigación. GET lista · POST crea { name, description? } */
export async function GET() {
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ spaces: [] });
  try {
    const rows = await sql()`
      select s.id, s.name, s.description, s.created_at, s.updated_at,
             (select count(*)::int from ai_conversations c where c.space_id = s.id) as conversations,
             (select count(*)::int from research_notes n where n.space_id = s.id) as notes
      from research_spaces s where s.workspace_id = ${g.ws} order by s.updated_at desc`;
    return Response.json({ spaces: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  const v = validateSpace(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const g = await guard(true);
  if (g instanceof Response) return g;
  try {
    const db = sql();
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from research_spaces where workspace_id = ${g.ws}`;
    if (n >= MEMORY_LIMITS.spaces) return Response.json({ error: `Máximo ${MEMORY_LIMITS.spaces} espacios` }, { status: 409 });
    const [row] = await db`insert into research_spaces (workspace_id, name, description) values (${g.ws}, ${v.value.name}, ${v.value.description}) returning id, name, description, created_at, updated_at`;
    return Response.json({ space: row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
