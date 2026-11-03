import type { NextRequest } from "next/server";
import type { Frequency, SourceId } from "@/lib/connectors/types";
import { searchCatalog } from "@/lib/data/queries";

/**
 * Catálogo de indicadores.
 * GET /api/indicators?q=ipc&source=INDEC&tracked=1&freq=M&limit=50&offset=0
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const source = p.get("source")?.toUpperCase();
  const tracked = p.get("tracked");
  const freq = p.get("freq")?.toUpperCase();
  try {
    const page = await searchCatalog({
      q: p.get("q") ?? undefined,
      sourceId: source === "BCRA" || source === "INDEC" ? (source as SourceId) : undefined,
      tracked: tracked === "1" ? true : tracked === "0" ? false : undefined,
      frequency: freq && ["D", "W", "M", "Q", "S", "A"].includes(freq) ? (freq as Frequency) : undefined,
      includeDiscontinued: p.get("discontinued") === "1",
      limit: Math.min(500, Number(p.get("limit")) || 50),
      offset: Math.max(0, Number(p.get("offset")) || 0),
    });
    return Response.json(page);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
