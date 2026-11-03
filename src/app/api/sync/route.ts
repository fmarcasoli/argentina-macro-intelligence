import type { NextRequest } from "next/server";
import type { SourceId } from "@/lib/connectors/types";
import { getSql } from "@/lib/db/client";
import { defaultConnectors } from "@/lib/ingest/connectors";
import { syncAll } from "@/lib/ingest/sync";

/**
 * Sincronización incremental, pensada para Vercel Cron.
 *   GET /api/sync?source=BCRA     Authorization: Bearer <CRON_SECRET>
 * Se divide por fuente para respetar el tiempo máximo de ejecución del plan gratuito.
 * La recarga completa del histórico se hace por CLI (npm run sync:full).
 */
export const maxDuration = 300; // máximo de Vercel Hobby con Fluid Compute

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const source = req.nextUrl.searchParams.get("source")?.toUpperCase();
  if (source && source !== "BCRA" && source !== "INDEC") {
    return Response.json({ error: "source debe ser BCRA o INDEC" }, { status: 400 });
  }
  const t0 = Date.now();
  const outcomes = await syncAll(getSql(), defaultConnectors(), {
    mode: "incremental",
    sourceId: source as SourceId | undefined,
    triggeredBy: "cron",
  });
  const failed = outcomes.filter((o) => o.status === "failed");
  return Response.json(
    {
      ok: failed.length === 0,
      source: source ?? "ALL",
      series: outcomes.length,
      inserted: outcomes.reduce((a, o) => a + o.inserted, 0),
      revised: outcomes.reduce((a, o) => a + o.updated, 0),
      failed: failed.map((f) => ({ id: f.indicatorId, error: f.error })),
      ms: Date.now() - t0,
    },
    { status: failed.length === outcomes.length && outcomes.length > 0 ? 502 : 200 },
  );
}
