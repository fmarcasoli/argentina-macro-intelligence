import type { NextRequest } from "next/server";
import { getIpcMonthly, getSeriesBundle } from "@/lib/data/series";

/**
 * Series para el motor de gráficos y el constructor de análisis.
 *   GET /api/series?ids=bcra.reservas,indec.emae&ipc=1
 *
 * Devuelve metadatos y observaciones (sin datos programados). Si alguna serie
 * del catálogo todavía no se había descargado, se trae en ese momento desde la
 * API oficial (BCRA o INDEC) y queda incluida en la actualización diaria.
 * Con ipc=1 incluye el IPC Nivel General para deflactar.
 */
export const maxDuration = 60;

const ID = /^[\w.\-]{1,120}$/;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const ids = [...new Set((p.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return Response.json({ error: "Indicá al menos una serie en ids" }, { status: 400 });
  if (ids.length > 8) return Response.json({ error: "Máximo 8 series por análisis" }, { status: 400 });
  if (!ids.every((id) => ID.test(id))) return Response.json({ error: "ID de serie inválido" }, { status: 400 });

  try {
    const bundle = await getSeriesBundle(ids, { ensure: true });
    const missing = ids.filter((id) => !bundle.series.some((s) => s.meta.id === id));
    const ipc = p.get("ipc") === "1" ? await getIpcMonthly() : undefined;
    return Response.json({ ...bundle, missing, ipc });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
