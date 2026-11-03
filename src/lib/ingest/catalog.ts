import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { DiscoveredSeries, SourceId } from "../connectors/types";
import { DERIVED_SERIES, SOURCE_SERIES, type SourceSeriesDef } from "../catalog/registry";
import { classifyPanel, type ClassifiableSeries } from "../catalog/panels";
import type { ConnectorMap } from "./connectors";

type Sql = postgres.Sql<Record<string, never>>;

export interface SeedReport {
  registered: string[];
  failed: { id: string; error: string }[];
}

function hashJson(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

export async function saveMetadataSnapshot(sql: Sql, indicatorId: string, payload: unknown) {
  await sql`
    insert into indicator_metadata (indicator_id, content_hash, payload)
    values (${indicatorId}, ${hashJson(payload)}, ${sql.json(payload as postgres.JSONValue)})
    on conflict (indicator_id, content_hash) do nothing`;
}

async function logCatalogError(sql: Sql, indicatorId: string | null, message: string, details: unknown) {
  await sql`
    insert into sync_errors (indicator_id, stage, message, details)
    values (${indicatorId}, 'catalog', ${message}, ${sql.json((details ?? null) as postgres.JSONValue)})`;
}

/**
 * Registra las series núcleo del registro. Para cada una consulta la fuente
 * (verificando que exista), guarda sus metadatos y su metodología.
 */
export async function seedCatalog(sql: Sql, connectors: ConnectorMap, opts: { only?: string[] } = {}): Promise<SeedReport> {
  const report: SeedReport = { registered: [], failed: [] };
  const defs = SOURCE_SERIES.filter((d) => !opts.only || opts.only.includes(d.id));

  for (const def of defs) {
    try {
      const connector = connectors[def.sourceId];
      const meta = await connector.describe(def.sourceCode);
      const methodology = connector.fetchMethodology ? await connector.fetchMethodology(def.sourceCode) : null;
      await upsertTrackedIndicator(sql, def, meta, methodology);
      await saveMetadataSnapshot(sql, def.id, meta.raw);
      report.registered.push(def.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ id: def.id, error: message });
      // El indicador puede no existir todavía: se registra el error sin FK.
      const exists = (await sql`select 1 from indicators where id = ${def.id}`).length > 0;
      await logCatalogError(sql, exists ? def.id : null, `No se pudo registrar ${def.id}: ${message}`, { def });
      if (exists) {
        await sql`update indicators set update_status = 'error', last_error = ${message} where id = ${def.id}`;
      }
    }
  }

  for (const d of DERIVED_SERIES.filter((x) => !opts.only || opts.only.includes(x.id))) {
    await sql`
      insert into indicators (id, source_id, name, category, subcategory, description, unit, frequency,
                              value_kind, derivation, methodology, is_tracked, tags)
      values (${d.id}, ${d.sourceId}, ${d.name}, ${d.category}, ${d.subcategory ?? null}, ${d.description},
              ${d.unit}, ${d.frequency}, 'calculated', ${sql.json(d.derivation as unknown as postgres.JSONValue)},
              ${d.description}, true, ${d.tags ?? []})
      on conflict (id) do update set
        name = excluded.name, category = excluded.category, subcategory = excluded.subcategory,
        description = excluded.description, unit = excluded.unit, frequency = excluded.frequency,
        derivation = excluded.derivation, methodology = excluded.methodology, tags = excluded.tags`;
    report.registered.push(d.id);
  }
  await refreshPanels(sql);
  return report;
}

/**
 * Asigna la categoría de panel (indicators.panel) a todas las series según las
 * reglas de src/lib/catalog/panels.ts. Solo escribe las que cambian.
 */
export async function refreshPanels(sql: Sql): Promise<number> {
  const rows = await sql<(ClassifiableSeries & { id: string; panel: string | null })[]>`
    select id, source_id, source_code, category, subcategory, name, panel from indicators`;
  const changed = rows
    .map((r) => ({ id: r.id, panel: classifyPanel(r), prev: r.panel }))
    .filter((r) => r.panel !== r.prev);
  for (let i = 0; i < changed.length; i += 2000) {
    const chunk = changed.slice(i, i + 2000);
    await sql`
      update indicators i set panel = v.panel
      from (select * from unnest(${chunk.map((c) => c.id)}::text[], ${chunk.map((c) => c.panel)}::text[]) as v(id, panel)) v
      where i.id = v.id`;
  }
  return changed.length;
}

async function upsertTrackedIndicator(sql: Sql, def: SourceSeriesDef, meta: DiscoveredSeries, methodology: string | null) {
  const scale = def.scale ?? 1;
  const valueKind = scale === 1 ? "original" : "normalized";
  const unit = def.unit ?? meta.unit;
  if (meta.frequency !== def.frequency) {
    throw new Error(`Frecuencia inconsistente para ${def.id}: registro ${def.frequency}, fuente ${meta.frequency}`);
  }
  const notes = def.note ?? null;
  // Si la serie ya había sido descubierta con un ID genérico (ej. "bcra-1"),
  // se reemplaza por la entrada curada para no duplicar la misma serie.
  await sql`
    delete from indicators
    where source_id = ${def.sourceId} and source_code = ${def.sourceCode} and value_kind = ${valueKind}
      and id <> ${def.id} and not is_tracked
      and not exists (select 1 from observations o where o.indicator_id = indicators.id)`;
  await sql`
    insert into indicators (id, source_id, source_code, name, category, subcategory, description, unit, frequency,
                            currency, endpoint, source_start_date, source_last_date, methodology, methodology_url,
                            value_kind, scale, is_tracked, tags, notes)
    values (${def.id}, ${def.sourceId}, ${def.sourceCode}, ${def.name}, ${def.category}, ${def.subcategory ?? null},
            ${meta.description ?? null}, ${unit}, ${def.frequency}, ${meta.currency ?? null}, ${meta.endpoint},
            ${meta.sourceStartDate ?? null}, ${meta.sourceLastDate ?? null}, ${methodology},
            ${def.sourceId === "BCRA" ? `https://api.bcra.gob.ar/estadisticas/v4.0/Metodologia/${def.sourceCode}` : null},
            ${valueKind}, ${scale}, true, ${def.tags ?? []}, ${notes})
    on conflict (id) do update set
      source_code = excluded.source_code, name = excluded.name, category = excluded.category,
      subcategory = excluded.subcategory, description = excluded.description, unit = excluded.unit,
      frequency = excluded.frequency, currency = excluded.currency, endpoint = excluded.endpoint,
      source_start_date = excluded.source_start_date, source_last_date = excluded.source_last_date,
      methodology = coalesce(excluded.methodology, indicators.methodology),
      methodology_url = excluded.methodology_url, value_kind = excluded.value_kind, scale = excluded.scale,
      is_tracked = true, tags = excluded.tags, notes = excluded.notes`;
}

/**
 * Registra en el catálogo TODAS las series que expone una fuente, sin
 * sincronizar sus datos (is_tracked = false). Si la serie ya existe solo se
 * actualizan las fechas informadas por la fuente: no se pisan nombres ni
 * categorías curadas.
 */
export async function registerDiscovered(sql: Sql, sourceId: SourceId, series: DiscoveredSeries[]): Promise<number> {
  const prefix = sourceId.toLowerCase();
  // Un mismo código repetido en el catálogo de la fuente rompería el upsert por lote.
  series = [...new Map(series.map((s) => [s.sourceCode, s])).values()];
  let n = 0;
  for (let i = 0; i < series.length; i += 500) {
    const chunk = series.slice(i, i + 500).map((s) => ({
      id: `${prefix}-${s.sourceCode}`,
      source_id: s.sourceId,
      source_code: s.sourceCode,
      name: s.name.slice(0, 500),
      category: s.category,
      subcategory: s.subcategory ?? null,
      description: s.description ?? null,
      unit: s.unit,
      frequency: s.frequency,
      currency: s.currency ?? null,
      endpoint: s.endpoint,
      source_start_date: s.sourceStartDate || null,
      source_last_date: s.sourceLastDate || null,
      update_status: s.discontinued ? "discontinued" : "pending",
      is_tracked: false,
    }));
    const res = await sql`
      insert into indicators ${sql(chunk)}
      on conflict (source_id, source_code, value_kind) where source_code is not null do update set
        source_start_date = excluded.source_start_date,
        source_last_date = excluded.source_last_date,
        endpoint = excluded.endpoint,
        update_status = case
          when indicators.is_tracked then indicators.update_status
          else excluded.update_status end`;
    n += res.count;
  }
  await refreshPanels(sql);
  return n;
}
