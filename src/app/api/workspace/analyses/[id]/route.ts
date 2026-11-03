import type { NextRequest } from "next/server";
import type postgres from "postgres";
import { getSql } from "@/lib/db/client";
import { currentWorkspaceId } from "@/lib/workspace";
import { validateAnalysisBody } from "@/lib/workspace-validate";

/**
 * Un análisis guardado del espacio de trabajo.
 *   GET    /api/workspace/analyses/{id}
 *   PUT    /api/workspace/analyses/{id}   (mismo cuerpo que POST)
 *   DELETE /api/workspace/analyses/{id}
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function owned(ctx: RouteContext<"/api/workspace/analyses/[id]">) {
  const id = (await ctx.params).id;
  if (!UUID.test(id)) return { error: Response.json({ error: "ID inválido" }, { status: 400 }) };
  const ws = await currentWorkspaceId();
  if (!ws) return { error: Response.json({ error: "No encontrado" }, { status: 404 }) };
  return { id, ws };
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspace/analyses/[id]">) {
  try {
    const o = await owned(ctx);
    if ("error" in o) return o.error;
    const [row] = await getSql()`
      select id, title, kind, definition, indicator_ids, created_at, updated_at
      from saved_analyses where id = ${o.id} and workspace_id = ${o.ws}`;
    return row ? Response.json({ analysis: row }) : Response.json({ error: "No encontrado" }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/workspace/analyses/[id]">) {
  const v = validateAnalysisBody(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const o = await owned(ctx);
    if ("error" in o) return o.error;
    const sql = getSql();
    const [row] = await sql`
      update saved_analyses set title = ${v.title}, kind = ${v.kind},
        definition = ${sql.json(v.definition as postgres.JSONValue)}, indicator_ids = ${v.ids}
      where id = ${o.id} and workspace_id = ${o.ws}
      returning id, title, kind, definition, indicator_ids, created_at, updated_at`;
    return row ? Response.json({ analysis: row }) : Response.json({ error: "No encontrado" }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/workspace/analyses/[id]">) {
  try {
    const o = await owned(ctx);
    if ("error" in o) return o.error;
    await getSql()`delete from saved_analyses where id = ${o.id} and workspace_id = ${o.ws}`;
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
