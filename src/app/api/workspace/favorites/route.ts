import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db/client";
import { currentWorkspaceId, ensureWorkspaceId, LIMITS } from "@/lib/workspace";

/**
 * Favoritos del espacio de trabajo.
 *   GET    /api/workspace/favorites
 *   POST   /api/workspace/favorites   { "indicatorId": "bcra.reservas" }
 *   DELETE /api/workspace/favorites?id=bcra.reservas
 */
export async function GET() {
  try {
    const ws = await currentWorkspaceId();
    if (!ws) return Response.json({ favorites: [] });
    const rows = await getSql()`
      select f.indicator_id as id, f.created_at, i.name, i.source_id, i.unit, i.frequency, i.last_date,
             i.last_value, i.update_status, i.value_kind
      from workspace_favorites f join indicators i on i.id = f.indicator_id
      where f.workspace_id = ${ws} order by f.created_at desc`;
    return Response.json({ favorites: rows });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { indicatorId?: unknown } | null;
  const id = typeof body?.indicatorId === "string" ? body.indicatorId : "";
  if (!/^[\w.\-]{1,120}$/.test(id)) return Response.json({ error: "indicatorId inválido" }, { status: 400 });
  try {
    const sql = getSql();
    const [exists] = await sql`select 1 from indicators where id = ${id}`;
    if (!exists) return Response.json({ error: "Indicador inexistente" }, { status: 404 });
    const ws = await ensureWorkspaceId();
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from workspace_favorites where workspace_id = ${ws}`;
    if (n >= LIMITS.favorites) return Response.json({ error: `Máximo ${LIMITS.favorites} favoritos` }, { status: 409 });
    await sql`insert into workspace_favorites (workspace_id, indicator_id) values (${ws}, ${id}) on conflict do nothing`;
    return Response.json({ ok: true, favorite: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    const ws = await currentWorkspaceId();
    if (ws) await getSql()`delete from workspace_favorites where workspace_id = ${ws} and indicator_id = ${id}`;
    return Response.json({ ok: true, favorite: false });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
