import type postgres from "postgres";
import { ConnectorError, type Frequency, type SourceId } from "../connectors/types";
import { addDays } from "../normalize/dates";
import { todayAR } from "../utils/time";
import { pctChange, ratio, type Derivation, type Point } from "../normalize/derive";
import { normalizeObservations, type NormalizedObservation } from "../normalize/normalize";
import type { ConnectorMap } from "./connectors";

type Sql = postgres.Sql<Record<string, never>>;

export type SyncMode = "full" | "incremental";

export interface IndicatorRow {
  id: string;
  source_id: SourceId;
  source_code: string | null;
  frequency: Frequency;
  value_kind: "original" | "normalized" | "calculated" | "estimated";
  scale: number;
  derivation: Derivation | null;
  last_date: string | null;
}

export interface SyncOutcome {
  indicatorId: string;
  runId: number;
  status: "success" | "partial" | "failed";
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  error?: string;
}

export interface SyncOptions {
  mode: SyncMode;
  triggeredBy?: string;
  /** Fecha de hoy (YYYY-MM-DD); inyectable para tests. */
  today?: string;
}

const DEFAULT_LOOKBACK: Record<Frequency, number> = { D: 45, W: 120, M: 730, Q: 1460, S: 1460, A: 2920 };
const DEFAULT_STALE: Record<Frequency, number> = { D: 7, W: 21, M: 75, Q: 200, S: 380, A: 730 };

async function getSetting<T>(sql: Sql, key: string, fallback: T): Promise<T> {
  const rows = await sql<{ value: T }[]>`select value from app_settings where key = ${key}`;
  return rows[0]?.value ?? fallback;
}

/** Período desde el cual se vuelve a descargar en modo incremental (para capturar revisiones). */
export function incrementalFrom(lastDate: string | null, freq: Frequency, lookback: Record<Frequency, number>): string | undefined {
  if (!lastDate) return undefined;
  return addDays(lastDate, -lookback[freq]);
}

interface ExistingRow {
  ref_date: string;
  value: number | null;
  raw_value: string | null;
}

interface PersistStats {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Persiste observaciones normalizadas comparando contra lo existente:
 *   - nuevas -> insert
 *   - valor distinto -> update (el trigger guarda la revisión)
 *   - iguales -> solo se actualiza last_seen_at
 * Nunca borra datos que la fuente dejó de informar.
 */
export async function persistObservations(
  sql: Sql,
  indicatorId: string,
  runId: number,
  obs: NormalizedObservation[],
  opts: { publicationDate: string | null },
): Promise<PersistStats> {
  if (obs.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const minDate = obs[0].refDate;
  const existing = new Map(
    (
      await sql<ExistingRow[]>`
        select ref_date, value, raw_value from observations
        where indicator_id = ${indicatorId} and ref_date >= ${minDate}`
    ).map((r) => [r.ref_date, r]),
  );

  const toWrite: Record<string, unknown>[] = [];
  const unchangedDates: string[] = [];
  let inserted = 0;
  let updated = 0;

  for (const o of obs) {
    const prev = existing.get(o.refDate);
    if (prev && sameValue(prev.value, o.value) && prev.raw_value === o.rawValue) {
      unchangedDates.push(o.refDate);
      continue;
    }
    if (prev) updated++;
    else inserted++;
    toWrite.push({
      indicator_id: indicatorId,
      ref_date: o.refDate,
      source_ref_date: o.sourceRefDate,
      value: o.value,
      raw_value: o.rawValue,
      value_kind: o.valueKind,
      is_scheduled: o.isScheduled,
      publication_date: prev ? null : opts.publicationDate,
      publication_origin: "first_seen",
      sync_run_id: runId,
    });
  }

  for (let i = 0; i < toWrite.length; i += 1000) {
    const chunk = toWrite.slice(i, i + 1000);
    await sql`
      insert into observations ${sql(chunk as never[])}
      on conflict (indicator_id, ref_date) do update set
        source_ref_date = excluded.source_ref_date,
        value = excluded.value,
        raw_value = excluded.raw_value,
        value_kind = excluded.value_kind,
        is_scheduled = excluded.is_scheduled,
        last_seen_at = now(),
        sync_run_id = excluded.sync_run_id`;
  }
  for (let i = 0; i < unchangedDates.length; i += 5000) {
    const chunk = unchangedDates.slice(i, i + 5000);
    await sql`
      update observations set last_seen_at = now()
      where indicator_id = ${indicatorId} and ref_date = any(${chunk}::date[])`;
  }
  return { inserted, updated, unchanged: unchangedDates.length };
}

function sameValue(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-12;
}

async function startRun(sql: Sql, ind: IndicatorRow, mode: SyncMode, triggeredBy: string, from?: string, to?: string) {
  const [run] = await sql<{ id: number }[]>`
    insert into sync_runs (source_id, indicator_id, mode, triggered_by, requested_from, requested_to)
    values (${ind.source_id}, ${ind.id}, ${mode}, ${triggeredBy}, ${from ?? null}, ${to ?? null})
    returning id`;
  return Number(run.id);
}

async function logError(
  sql: Sql,
  runId: number,
  indicatorId: string,
  stage: string,
  message: string,
  details?: unknown,
  httpStatus?: number,
) {
  await sql`
    insert into sync_errors (sync_run_id, indicator_id, stage, message, http_status, details)
    values (${runId}, ${indicatorId}, ${stage}, ${message}, ${httpStatus ?? null},
            ${sql.json((details ?? null) as postgres.JSONValue)})`;
}

/** Recalcula fechas, último valor, cantidad y estado de actualización del indicador. */
async function refreshIndicatorStats(sql: Sql, ind: IndicatorRow, today: string, error: string | null) {
  const stale = await getSetting(sql, "sync.stale_after_days", DEFAULT_STALE);
  // Un dato programado deja de serlo cuando llega su fecha (y viceversa si se corrigió "hoy").
  await sql`
    update observations set is_scheduled = (coalesce(source_ref_date, ref_date) > ${today}::date)
    where indicator_id = ${ind.id}
      and is_scheduled <> (coalesce(source_ref_date, ref_date) > ${today}::date)`;
  const [s] = await sql<{ start_date: string | null; last_date: string | null; n: number }[]>`
    select min(ref_date) as start_date,
           max(ref_date) filter (where not is_scheduled and value is not null) as last_date,
           count(*)::int as n
    from observations where indicator_id = ${ind.id}`;
  const [last] = s.last_date
    ? await sql<{ value: number | null }[]>`
        select value from observations where indicator_id = ${ind.id} and ref_date = ${s.last_date}`
    : [{ value: null }];

  let status: string;
  if (error) status = "error";
  else if (!s.last_date) status = "pending";
  else {
    const ageDays = (Date.parse(today) - Date.parse(s.last_date)) / 86_400_000;
    // Para series de baja frecuencia el período se fecha al inicio: se suma la duración del período.
    const periodDays: Record<Frequency, number> = { D: 0, W: 7, M: 31, Q: 92, S: 183, A: 366 };
    status = ageDays - periodDays[ind.frequency] > stale[ind.frequency] ? "stale" : "ok";
  }
  await sql`
    update indicators set
      start_date = ${s.start_date}, last_date = ${s.last_date}, last_value = ${last?.value ?? null},
      observation_count = ${s.n}, last_synced_at = now(), update_status = ${status},
      last_error = ${error}
    where id = ${ind.id}`;
}

async function finishRun(sql: Sql, runId: number, o: Omit<SyncOutcome, "indicatorId" | "runId">, errorCount: number) {
  await sql`
    update sync_runs set status = ${o.status}, finished_at = clock_timestamp(),
      rows_fetched = ${o.fetched}, rows_inserted = ${o.inserted}, rows_updated = ${o.updated},
      rows_unchanged = ${o.unchanged}, rows_rejected = ${o.rejected}, error_count = ${errorCount}
    where id = ${runId}`;
}

/** Sincroniza una serie de origen (BCRA o INDEC). */
export async function syncSourceIndicator(
  sql: Sql,
  connectors: ConnectorMap,
  ind: IndicatorRow,
  opts: SyncOptions,
): Promise<SyncOutcome> {
  const today = opts.today ?? todayAR();
  const lookback = await getSetting(sql, "sync.revision_lookback", DEFAULT_LOOKBACK);
  const mode: SyncMode = opts.mode === "incremental" && ind.last_date ? "incremental" : "full";
  const from = mode === "incremental" ? incrementalFrom(ind.last_date, ind.frequency, lookback) : undefined;
  const runId = await startRun(sql, ind, mode, opts.triggeredBy ?? "manual", from);
  const base = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
  let errorCount = 0;

  try {
    if (!ind.source_code) throw new Error(`El indicador ${ind.id} no tiene código de origen`);
    const connector = connectors[ind.source_id];
    if (!connector) throw new Error(`No hay conector para la fuente ${ind.source_id}`);

    // 1. Descarga
    let result;
    try {
      result = await connector.fetchSeries(ind.source_code, { from });
    } catch (err) {
      const e = err as Error;
      const status = err instanceof ConnectorError ? err.details.httpStatus : undefined;
      await logError(sql, runId, ind.id, "fetch", e.message, err instanceof ConnectorError ? err.details : undefined, status);
      errorCount++;
      throw e;
    }
    base.fetched = result.observations.length;

    // 2. Normalización y validación
    const norm = normalizeObservations(result.observations, {
      frequency: ind.frequency,
      scale: Number(ind.scale ?? 1),
      today,
    });
    base.rejected = norm.stats.rejected;
    if (norm.rejected.length) {
      errorCount++;
      await logError(sql, runId, ind.id, "validate", `${norm.rejected.length} registro(s) rechazado(s) por validación`, {
        sample: norm.rejected.slice(0, 20),
        byReason: norm.rejected.reduce<Record<string, number>>((acc, r) => {
          acc[r.reason] = (acc[r.reason] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }
    if (result.reportedCount !== undefined && mode === "full" && result.reportedCount !== base.fetched) {
      errorCount++;
      await logError(sql, runId, ind.id, "validate",
        `La fuente informó ${result.reportedCount} registros pero se recibieron ${base.fetched}`);
    }

    // 3. Persistencia. En la carga inicial no se conoce la fecha de publicación
    // de los datos históricos, así que queda NULL. En las actualizaciones, la
    // fecha en que la plataforma vio el dato por primera vez actúa como proxy.
    const stats = await persistObservations(sql, ind.id, runId, norm.observations, {
      publicationDate: mode === "incremental" ? today : null,
    });
    Object.assign(base, stats);

    const status = errorCount > 0 ? "partial" : "success";
    await finishRun(sql, runId, { ...base, status }, errorCount);
    await refreshIndicatorStats(sql, ind, today, null);
    return { indicatorId: ind.id, runId, status, ...base };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (errorCount === 0) {
      await logError(sql, runId, ind.id, "persist", message);
      errorCount++;
    }
    await finishRun(sql, runId, { ...base, status: "failed" }, errorCount);
    await refreshIndicatorStats(sql, ind, today, message);
    return { indicatorId: ind.id, runId, status: "failed", ...base, error: message };
  }
}

async function loadPoints(sql: Sql, indicatorId: string): Promise<Point[]> {
  return sql<Point[]>`
    select ref_date as "refDate", value from observations
    where indicator_id = ${indicatorId} and not is_scheduled
    order by ref_date`;
}

/** Recalcula una serie derivada a partir de sus series base ya almacenadas. */
export async function syncDerivedIndicator(sql: Sql, ind: IndicatorRow, opts: SyncOptions): Promise<SyncOutcome> {
  const today = opts.today ?? todayAR();
  const runId = await startRun(sql, ind, "full", opts.triggeredBy ?? "manual");
  const base = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
  try {
    const d = ind.derivation;
    if (!d) throw new Error(`El indicador ${ind.id} no tiene definición de cálculo`);
    let points: Point[];
    if (d.op === "pct_change") {
      points = pctChange(await loadPoints(sql, d.base), ind.frequency, d.lag);
    } else {
      points = ratio(await loadPoints(sql, d.numerator), await loadPoints(sql, d.denominator), d.scale ?? 1);
    }
    base.fetched = points.length;
    const obs: NormalizedObservation[] = points.map((p) => ({
      refDate: p.refDate,
      sourceRefDate: p.refDate,
      value: p.value,
      rawValue: null,
      valueKind: "calculated",
      isScheduled: false,
    }));
    Object.assign(base, await persistObservations(sql, ind.id, runId, obs, { publicationDate: null }));
    await finishRun(sql, runId, { ...base, status: "success" }, 0);
    await refreshIndicatorStats(sql, ind, today, null);
    return { indicatorId: ind.id, runId, status: "success", ...base };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logError(sql, runId, ind.id, "derive", message);
    await finishRun(sql, runId, { ...base, status: "failed" }, 1);
    await refreshIndicatorStats(sql, ind, today, message);
    return { indicatorId: ind.id, runId, status: "failed", ...base, error: message };
  }
}

export interface SyncAllOptions extends SyncOptions {
  sourceId?: SourceId;
  ids?: string[];
  onProgress?: (o: SyncOutcome) => void;
}

/**
 * Sincroniza todos los indicadores con is_tracked = true según la tabla
 * `indicators` (catálogo dinámico) y luego recalcula las series derivadas.
 */
export async function syncAll(sql: Sql, connectors: ConnectorMap, opts: SyncAllOptions): Promise<SyncOutcome[]> {
  const rows = await sql<IndicatorRow[]>`
    select id, source_id, source_code, frequency, value_kind, scale, derivation, last_date
    from indicators
    where is_tracked
      ${opts.sourceId ? sql`and source_id = ${opts.sourceId}` : sql``}
      ${opts.ids?.length ? sql`and id = any(${opts.ids})` : sql``}
    order by (value_kind = 'calculated'), source_id, id`;

  const outcomes: SyncOutcome[] = [];
  for (const ind of rows) {
    const o =
      ind.value_kind === "calculated"
        ? await syncDerivedIndicator(sql, ind, opts)
        : await syncSourceIndicator(sql, connectors, ind, opts);
    outcomes.push(o);
    opts.onProgress?.(o);
  }
  return outcomes;
}
