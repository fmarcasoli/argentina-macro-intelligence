import "server-only";
import { connection } from "next/server";
import { getSql, isDatabaseConfigured } from "../db/client";
import type { Frequency, SourceId, ValueKind } from "../connectors/types";

/**
 * Lecturas para la interfaz. Todas llaman a connection(): los datos se leen
 * en cada request (nunca se congelan en el build) y las páginas los muestran
 * dentro de <Suspense>.
 */

export type UpdateStatus = "pending" | "ok" | "stale" | "error" | "discontinued";

export interface Indicator {
  id: string;
  source_id: SourceId;
  source_code: string | null;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  unit: string;
  frequency: Frequency;
  currency: string | null;
  endpoint: string | null;
  start_date: string | null;
  last_date: string | null;
  last_value: number | null;
  source_start_date: string | null;
  source_last_date: string | null;
  methodology: string | null;
  methodology_url: string | null;
  value_kind: ValueKind;
  scale: number;
  derivation: unknown;
  update_status: UpdateStatus;
  is_tracked: boolean;
  observation_count: number;
  last_synced_at: Date | null;
  last_error: string | null;
  tags: string[];
  notes: string | null;
  panel: string | null;
  tracked_on_demand_at: Date | null;
}

export interface SeriesPoint {
  d: string;
  v: number | null;
}

export interface IndicatorSnapshot extends Indicator {
  prev_date: string | null;
  prev_value: number | null;
  spark: SeriesPoint[];
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL no configurada");
  }
}

async function db() {
  await connection();
  if (!isDatabaseConfigured()) throw new DatabaseNotConfiguredError();
  return getSql();
}

export async function getIndicatorSnapshots(opts: {
  ids?: string[];
  sourceId?: SourceId;
  tracked?: boolean;
  sparkPoints?: number;
}): Promise<IndicatorSnapshot[]> {
  const sql = await db();
  const rows = await sql<Indicator[]>`
    select * from indicators
    where true
      ${opts.ids ? sql`and id = any(${opts.ids})` : sql``}
      ${opts.sourceId ? sql`and source_id = ${opts.sourceId}` : sql``}
      ${opts.tracked !== undefined ? sql`and is_tracked = ${opts.tracked}` : sql``}
    order by category, subcategory nulls first, name`;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const n = opts.sparkPoints ?? 60;
  const sparks = await sql<{ indicator_id: string; d: string; v: number | null }[]>`
    select indicator_id, ref_date as d, value as v from (
      select indicator_id, ref_date, value,
             row_number() over (partition by indicator_id order by ref_date desc) as rn
      from observations
      where indicator_id = any(${ids}) and not is_scheduled
    ) t
    where rn <= ${n}
    order by indicator_id, ref_date`;
  const bySeries = new Map<string, SeriesPoint[]>();
  for (const s of sparks) {
    const arr = bySeries.get(s.indicator_id) ?? [];
    arr.push({ d: s.d, v: s.v });
    bySeries.set(s.indicator_id, arr);
  }

  // Comparación del KPI: diarias contra el dato de ~1 mes antes; el resto contra el período anterior.
  const prevs = await sql<{ id: string; prev_date: string | null; prev_value: number | null }[]>`
    select i.id, p.ref_date as prev_date, p.value as prev_value
    from indicators i
    left join lateral (
      select ref_date, value from observations o
      where o.indicator_id = i.id and not o.is_scheduled and o.value is not null
        and o.ref_date <= i.last_date - (case when i.frequency = 'D' then interval '30 days' else interval '1 day' end)
      order by ref_date desc limit 1
    ) p on true
    where i.id = any(${ids})`;
  const prevMap = new Map(prevs.map((p) => [p.id, p]));

  return rows.map((r) => ({
    ...r,
    prev_date: prevMap.get(r.id)?.prev_date ?? null,
    prev_value: prevMap.get(r.id)?.prev_value ?? null,
    spark: bySeries.get(r.id) ?? [],
  }));
}

export async function getIndicator(id: string): Promise<Indicator | null> {
  const sql = await db();
  const rows = await sql<Indicator[]>`select * from indicators where id = ${id}`;
  return rows[0] ?? null;
}

export async function getObservations(
  id: string,
  opts: { from?: string; to?: string; lastYears?: number; includeScheduled?: boolean } = {},
): Promise<SeriesPoint[]> {
  const sql = await db();
  return sql<SeriesPoint[]>`
    select ref_date as d, value as v from observations
    where indicator_id = ${id}
      ${opts.from ? sql`and ref_date >= ${opts.from}` : sql``}
      ${opts.lastYears ? sql`and ref_date >= current_date - ${Math.round(opts.lastYears * 365.25)}::int` : sql``}
      ${opts.to ? sql`and ref_date <= ${opts.to}` : sql``}
      ${opts.includeScheduled ? sql`` : sql`and not is_scheduled`}
    order by ref_date`;
}

export interface ObservationDetail {
  ref_date: string;
  source_ref_date: string | null;
  value: number | null;
  raw_value: string | null;
  value_kind: ValueKind;
  is_scheduled: boolean;
  publication_date: string | null;
  publication_origin: "source" | "first_seen";
  first_seen_at: Date;
  revision_count: number;
}

export async function getRecentObservations(id: string, limit = 24): Promise<ObservationDetail[]> {
  const sql = await db();
  return sql<ObservationDetail[]>`
    select ref_date, source_ref_date, value, raw_value, value_kind, is_scheduled,
           publication_date, publication_origin, first_seen_at, revision_count
    from observations where indicator_id = ${id}
    order by ref_date desc limit ${limit}`;
}

export interface Revision {
  ref_date: string;
  old_value: number | null;
  new_value: number | null;
  revised_at: Date;
}

export async function getRevisions(id: string, limit = 20): Promise<Revision[]> {
  const sql = await db();
  return sql<Revision[]>`
    select ref_date, old_value, new_value, revised_at from observation_revisions
    where indicator_id = ${id} order by revised_at desc, ref_date desc limit ${limit}`;
}

export interface SyncRun {
  id: number;
  source_id: SourceId | null;
  indicator_id: string | null;
  mode: "full" | "incremental";
  status: "running" | "success" | "partial" | "failed";
  triggered_by: string;
  requested_from: string | null;
  rows_fetched: number;
  rows_inserted: number;
  rows_updated: number;
  rows_unchanged: number;
  rows_rejected: number;
  error_count: number;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
}

export async function getSyncRuns(opts: { indicatorId?: string; limit?: number } = {}): Promise<SyncRun[]> {
  const sql = await db();
  return sql<SyncRun[]>`
    select * from sync_runs
    ${opts.indicatorId ? sql`where indicator_id = ${opts.indicatorId}` : sql``}
    order by started_at desc, id desc limit ${opts.limit ?? 30}`;
}

export interface SyncErrorRow {
  id: number;
  indicator_id: string | null;
  stage: string;
  message: string;
  http_status: number | null;
  occurred_at: Date;
}

export async function getSyncErrors(opts: { indicatorId?: string; limit?: number } = {}): Promise<SyncErrorRow[]> {
  const sql = await db();
  return sql<SyncErrorRow[]>`
    select id, indicator_id, stage, message, http_status, occurred_at from sync_errors
    ${opts.indicatorId ? sql`where indicator_id = ${opts.indicatorId}` : sql``}
    order by occurred_at desc limit ${opts.limit ?? 30}`;
}

export interface SourceSummary {
  id: SourceId;
  name: string;
  api_name: string;
  base_url: string;
  docs_url: string | null;
  rate_limit_note: string | null;
  notes: string | null;
  catalog_count: number;
  tracked_count: number;
  ok_count: number;
  stale_count: number;
  error_count: number;
  observation_count: number;
  last_synced_at: Date | null;
}

export async function getSourceSummaries(): Promise<SourceSummary[]> {
  const sql = await db();
  return sql<SourceSummary[]>`
    select s.id, s.name, s.api_name, s.base_url, s.docs_url, s.rate_limit_note, s.notes,
      count(i.id)::int as catalog_count,
      count(i.id) filter (where i.is_tracked)::int as tracked_count,
      count(i.id) filter (where i.is_tracked and i.update_status = 'ok')::int as ok_count,
      count(i.id) filter (where i.is_tracked and i.update_status = 'stale')::int as stale_count,
      count(i.id) filter (where i.is_tracked and i.update_status = 'error')::int as error_count,
      coalesce(sum(i.observation_count), 0)::int as observation_count,
      max(i.last_synced_at) as last_synced_at
    from sources s left join indicators i on i.source_id = s.id
    group by s.id order by s.id`;
}

export interface CatalogPage {
  rows: Pick<Indicator, "id" | "source_id" | "source_code" | "name" | "category" | "subcategory" | "unit" | "frequency" | "source_last_date" | "last_date" | "update_status" | "is_tracked" | "value_kind" | "panel">[];
  total: number;
}

export async function searchCatalog(opts: {
  q?: string;
  sourceId?: SourceId;
  panel?: string;
  tracked?: boolean;
  frequency?: Frequency;
  includeDiscontinued?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CatalogPage> {
  const sql = await db();
  const terms = (opts.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const where = sql`
    where true
      ${opts.sourceId ? sql`and source_id = ${opts.sourceId}` : sql``}
      ${opts.panel ? sql`and panel = ${opts.panel}` : sql``}
      ${opts.tracked !== undefined ? sql`and is_tracked = ${opts.tracked}` : sql``}
      ${opts.frequency ? sql`and frequency = ${opts.frequency}` : sql``}
      ${opts.includeDiscontinued ? sql`` : sql`and update_status <> 'discontinued'`}
      ${terms.reduce(
        (acc, t) =>
          sql`${acc} and (unaccent_text(name) ilike unaccent_text(${"%" + t + "%"}) or category ilike ${"%" + t + "%"}
                  or unaccent_text(coalesce(subcategory,'')) ilike unaccent_text(${"%" + t + "%"})
                  or coalesce(source_code,'') ilike ${"%" + t + "%"} or id ilike ${"%" + t + "%"})`,
        sql``,
      )}`;
  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from indicators ${where}`;
  const rows = await sql<CatalogPage["rows"]>`
    select id, source_id, source_code, name, category, subcategory, unit, frequency,
           source_last_date, last_date, update_status, is_tracked, value_kind, panel
    from indicators ${where}
    order by (observation_count > 0) desc, (update_status = 'discontinued'), source_last_date desc nulls last, name
    limit ${opts.limit ?? 50} offset ${opts.offset ?? 0}`;
  return { rows, total };
}

export async function getDatabaseHealth() {
  const sql = await db();
  const [r] = await sql<{ indicators: number; tracked: number; observations: number; revisions: number; runs: number; errors: number; version: string }[]>`
    select
      (select count(*) from indicators)::int as indicators,
      (select count(*) from indicators where is_tracked)::int as tracked,
      (select count(*) from observations)::int as observations,
      (select count(*) from observation_revisions)::int as revisions,
      (select count(*) from sync_runs)::int as runs,
      (select count(*) from sync_errors)::int as errors,
      version() as version`;
  return r;
}
