import { connection } from "next/server";
import { getSql, isDatabaseConfigured } from "@/lib/db/client";

/** Estado de la conexión a la base y conteos básicos. */
export async function GET() {
  await connection();
  if (!isDatabaseConfigured()) {
    return Response.json({ ok: false, database: "not_configured" }, { status: 503 });
  }
  try {
    const sql = getSql();
    const [r] = await sql<{ indicators: number; observations: number; last_sync: Date | null }[]>`
      select (select count(*) from indicators)::int as indicators,
             (select count(*) from observations)::int as observations,
             (select max(finished_at) from sync_runs) as last_sync`;
    return Response.json({ ok: true, database: "connected", ...r });
  } catch (err) {
    return Response.json({ ok: false, database: "error", error: (err as Error).message }, { status: 503 });
  }
}
