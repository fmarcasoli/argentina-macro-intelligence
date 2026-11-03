import type postgres from "postgres";
import type { ConnectorMap } from "./connectors";
import { syncSourceIndicator, type IndicatorRow, type SyncOutcome } from "./sync";

type Sql = postgres.Sql<Record<string, never>>;

export type EnsureResult =
  | { status: "ready" }
  | { status: "synced"; outcome: SyncOutcome }
  | { status: "failed"; error: string }
  | { status: "not_found" };

/**
 * Garantiza que una serie del catálogo tenga sus datos en la base.
 *
 * Las ~12.000 series descubiertas se registran sin datos. Cuando alguien abre
 * una de ellas (ficha o análisis), se descarga su histórico completo desde la
 * API oficial con el mismo motor de ingesta (normalización, validación,
 * trazabilidad) y queda marcada como sincronizada para las actualizaciones
 * diarias (`tracked_on_demand_at`). No se inventa ningún dato: si la fuente
 * falla, el error queda registrado y la serie se muestra sin datos.
 */
export async function ensureSeriesData(sql: Sql, connectors: ConnectorMap, id: string): Promise<EnsureResult> {
  const [ind] = await sql<(IndicatorRow & { observation_count: number; is_tracked: boolean })[]>`
    select id, source_id, source_code, frequency, value_kind, scale, derivation, last_date,
           observation_count, is_tracked
    from indicators where id = ${id}`;
  if (!ind) return { status: "not_found" };
  if (ind.value_kind === "calculated" || ind.observation_count > 0) return { status: "ready" };

  await sql`
    update indicators set is_tracked = true, tracked_on_demand_at = coalesce(tracked_on_demand_at, now())
    where id = ${id}`;
  const outcome = await syncSourceIndicator(sql, connectors, { ...ind, last_date: null }, {
    mode: "full",
    triggeredBy: "on_demand",
  });
  if (outcome.status === "failed") return { status: "failed", error: outcome.error ?? "Error desconocido" };
  return { status: "synced", outcome };
}
