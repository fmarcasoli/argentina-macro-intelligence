import type { NextRequest } from "next/server";
import type postgres from "postgres";
import { getSql } from "@/lib/db/client";
import { currentWorkspaceId, ensureWorkspaceId, LIMITS } from "@/lib/workspace";
import { validateAnalysisBody } from "@/lib/workspace-validate";

/**
 * Análisis guardados del espacio de trabajo.
 *   GET  /api/workspace/analyses
 *   POST /api/workspace/analyses  { "title": "...", "kind": "analysis" | "chart" | "calculator", "definition": {...} }
 *
 * `definition` es el estado completo para reabrir el análisis (series, período,
 * frecuencia, transformación, disposición). Se valida tamaño y forma.
 */
export async function GET() {
  try {
    const ws = await currentWorkspaceId();
    if (!ws) return Response.json({ analyses: [] });
    const rows = await getSql()`
      select id, title, kind, definition, indicator_ids, created_at, updated_at
      from saved_analyses where workspace_id = ${ws} order by updated_at desc`;
    return Response.json({ analyses: rows });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const v = validateAnalysisBody(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const sql = getSql();
    const ws = await ensureWorkspaceId();
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from saved_analyses where workspace_id = ${ws}`;
    if (n >= LIMITS.analyses) return Response.json({ error: `Máximo ${LIMITS.analyses} análisis guardados` }, { status: 409 });
    const [row] = await sql`
      insert into saved_analyses (workspace_id, title, kind, definition, indicator_ids)
      values (${ws}, ${v.title}, ${v.kind}, ${sql.json(v.definition as postgres.JSONValue)}, ${v.ids})
      returning id, title, kind, definition, indicator_ids, created_at, updated_at`;
    return Response.json({ analysis: row }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
