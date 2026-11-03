import type { NextRequest } from "next/server";
import { fail, guard, sql } from "@/lib/ai/memory";
import { UUID } from "@/lib/ai/memory-validate";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/ai/notes/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ ok: true });
  try {
    await sql()`delete from research_notes where id = ${id} and workspace_id = ${g.ws}`;
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
