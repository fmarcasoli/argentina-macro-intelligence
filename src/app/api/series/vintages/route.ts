import type { NextRequest } from "next/server";
import { getSeriesVintages } from "@/lib/data/series";

/**
 * Versiones publicadas de una serie, para backtesting sin información futura.
 *   GET /api/series/vintages?id=indec.emae
 */
const ID = /^[\w.\-]{1,120}$/;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!ID.test(id)) return Response.json({ error: "ID de serie inválido" }, { status: 400 });
  try {
    return Response.json(await getSeriesVintages(id));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
