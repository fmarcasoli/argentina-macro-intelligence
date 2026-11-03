import "server-only";
import { connection } from "next/server";
import type { SourceId } from "../connectors/types";
import type { Pt, SeriesData, SeriesMeta } from "../analysis/types";
import { getSql, isDatabaseConfigured } from "../db/client";
import { defaultConnectors } from "../ingest/connectors";
import { ensureSeriesData, type EnsureResult } from "../ingest/on-demand";
import { DatabaseNotConfiguredError } from "./queries";

async function db() {
  await connection();
  if (!isDatabaseConfigured()) throw new DatabaseNotConfiguredError();
  return getSql();
}

const META_COLS = `id, source_id, source_code, name, unit, frequency, value_kind, category, subcategory, panel,
  update_status, last_date, methodology_url`;

/** Metadatos de varias series, en el orden pedido. */
export async function getSeriesMetas(ids: string[]): Promise<SeriesMeta[]> {
  if (!ids.length) return [];
  const sql = await db();
  const rows = await sql.unsafe<SeriesMeta[]>(`select ${META_COLS} from indicators where id = any($1)`, [ids]);
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => by.get(id)).filter((x): x is SeriesMeta => Boolean(x));
}

export async function getPoints(id: string, opts: { from?: string; to?: string } = {}): Promise<Pt[]> {
  const sql = await db();
  return sql<Pt[]>`
    select ref_date as d, value as v from observations
    where indicator_id = ${id} and not is_scheduled
      ${opts.from ? sql`and ref_date >= ${opts.from}` : sql``}
      ${opts.to ? sql`and ref_date <= ${opts.to}` : sql``}
    order by ref_date`;
}

/**
 * Series con metadatos y observaciones. Si alguna serie del catálogo todavía
 * no tiene datos, se descargan de la API oficial antes de responder.
 */
export async function getSeriesBundle(
  ids: string[],
  opts: { ensure?: boolean } = {},
): Promise<{ series: SeriesData[]; ensured: Record<string, EnsureResult["status"]>; errors: Record<string, string> }> {
  const sql = await db();
  const ensured: Record<string, EnsureResult["status"]> = {};
  const errors: Record<string, string> = {};
  if (opts.ensure) {
    for (const id of ids) {
      const r = await ensureSeriesData(sql, defaultConnectors(), id);
      ensured[id] = r.status;
      if (r.status === "failed") errors[id] = r.error;
    }
  }
  const metas = await getSeriesMetas(ids);
  const series = await Promise.all(metas.map(async (meta) => ({ meta, points: await getPoints(meta.id) })));
  return { series, ensured, errors };
}

/** IPC Nivel General Nacional (índice mensual), deflactor de la plataforma. */
export const IPC_ID = "indec.ipc_nivel_general";

export async function getIpcMonthly(): Promise<Pt[]> {
  return getPoints(IPC_ID);
}

export interface PanelCount {
  panel: string;
  total: number;
  active: number;
  with_data: number;
}

export async function getPanelCounts(source: SourceId): Promise<PanelCount[]> {
  const sql = await db();
  return sql<PanelCount[]>`
    select panel, count(*)::int as total,
           count(*) filter (where update_status <> 'discontinued')::int as active,
           count(*) filter (where observation_count > 0)::int as with_data
    from indicators where source_id = ${source} and panel is not null
    group by panel`;
}

/** Serie descargada a pedido por primera vez (para avisar en la ficha). */
export async function ensureIndicator(id: string): Promise<EnsureResult> {
  const sql = await db();
  return ensureSeriesData(sql, defaultConnectors(), id);
}

export interface SeriesVintages {
  id: string;
  /** Fecha desde la que la plataforma registra publicaciones y revisiones de esta serie. */
  trackedSince: string | null;
  observations: { d: string; v: number | null; availableAt: string }[];
  revisions: { d: string; oldValue: number | null; revisedAt: string }[];
}

/**
 * Datos para reconstruir versiones históricas (vintages) de una serie: cuándo
 * estuvo disponible cada observación (fecha de publicación informada por la
 * fuente o, si no la informa, la primera vez que la vio la plataforma) y el
 * historial de revisiones de valores ya publicados.
 */
export async function getSeriesVintages(id: string): Promise<SeriesVintages> {
  const sql = await db();
  const observations = await sql<{ d: string; v: number | null; availableAt: string }[]>`
    select ref_date as d, value as v,
           to_char(coalesce(case when publication_origin = 'source' then publication_date::timestamptz end, first_seen_at)
                   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "availableAt"
    from observations where indicator_id = ${id} and not is_scheduled order by ref_date`;
  const revisions = await sql<{ d: string; oldValue: number | null; revisedAt: string }[]>`
    select ref_date as d, old_value as "oldValue",
           to_char(revised_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "revisedAt"
    from observation_revisions where indicator_id = ${id} order by revised_at`;
  const [first] = await sql<{ since: string | null }[]>`
    select to_char(min(first_seen_at) at time zone 'UTC', 'YYYY-MM-DD') as since from observations where indicator_id = ${id}`;
  return { id, trackedSince: first?.since ?? null, observations, revisions };
}
