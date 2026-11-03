import type { NextRequest } from "next/server";
import { fail, guard, sql } from "@/lib/ai/memory";
import { UUID, validateSpace } from "@/lib/ai/memory-validate";

/** Un espacio: PUT { name, description? } · DELETE (las conversaciones y conclusiones quedan sin espacio) */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/ai/spaces/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  const v = validateSpace(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ error: "No encontrado" }, { status: 404 });
  try {
    const [row] = await sql()`update research_spaces set name = ${v.value.name}, description = ${v.value.description}, updated_at = now() where id = ${id} and workspace_id = ${g.ws} returning id, name, description`;
    return row ? Response.json({ space: row }) : Response.json({ error: "No encontrado" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/ai/spaces/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  const g = await guard();
  if (g instanceof Response) return g;
  if (!g.ws) return Response.json({ ok: true });
  try {
    await sql()`delete from research_spaces where id = ${id} and workspace_id = ${g.ws}`;
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
