import type { NextRequest } from "next/server";
import { getIndicator } from "@/lib/data/queries";
import { getSql } from "@/lib/db/client";

/**
 * Observaciones de un indicador, con trazabilidad completa.
 * GET /api/indicators/{id}/observations?from=2020-01-01&to=2026-12-31&format=json|csv
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/indicators/[id]/observations">) {
  const id = decodeURIComponent((await ctx.params).id);
  const p = req.nextUrl.searchParams;
  const from = p.get("from");
  const to = p.get("to");
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !iso.test(from)) || (to && !iso.test(to))) {
    return Response.json({ error: "Fechas en formato YYYY-MM-DD" }, { status: 400 });
  }
  try {
    const ind = await getIndicator(id);
    if (!ind) return Response.json({ error: "Indicador inexistente" }, { status: 404 });
    const sql = getSql();
    const rows = await sql<
      { ref_date: string; source_ref_date: string | null; value: number | null; raw_value: string | null; value_kind: string; is_scheduled: boolean; publication_date: string | null; publication_origin: string; revision_count: number }[]
    >`
      select ref_date, source_ref_date, value, raw_value, value_kind, is_scheduled,
             publication_date, publication_origin, revision_count
      from observations where indicator_id = ${id}
        ${from ? sql`and ref_date >= ${from}` : sql``}
        ${to ? sql`and ref_date <= ${to}` : sql``}
      order by ref_date`;

    if (p.get("format") === "csv") {
      const header = "ref_date,source_ref_date,value,raw_value,value_kind,is_scheduled,publication_date,publication_origin,revision_count";
      const esc = (v: unknown) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const body = rows.map((r) => [r.ref_date, r.source_ref_date, r.value, r.raw_value, r.value_kind, r.is_scheduled, r.publication_date, r.publication_origin, r.revision_count].map(esc).join(","));
      const meta = `# ${ind.name} | fuente: ${ind.source_id} ${ind.source_code ?? "(calculada)"} | unidad: ${ind.unit} | endpoint: ${ind.endpoint ?? "-"}`;
      return new Response([meta, header, ...body].join("\n") + "\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.csv"`,
        },
      });
    }
    return Response.json({
      indicator: {
        id: ind.id, name: ind.name, source: ind.source_id, source_code: ind.source_code, unit: ind.unit,
        frequency: ind.frequency, value_kind: ind.value_kind, endpoint: ind.endpoint, last_date: ind.last_date,
      },
      observations: rows,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
