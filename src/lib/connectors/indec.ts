import { buildUrl, HttpClient, type FetchLike } from "./http";
import {
  ConnectorError,
  type DiscoveredSeries,
  type FetchRange,
  type FetchResult,
  type Frequency,
  type RawObservation,
  type SourceConnector,
} from "./types";
import { parseCsv } from "../utils/csv";

/**
 * Conector de series del INDEC.
 *
 * El INDEC no expone una API REST propia: publica sus series de tiempo a
 * través de la API oficial de Series de Tiempo de la República Argentina
 * (datos.gob.ar), que mantiene la Dirección Nacional de Datos e Información
 * Pública. Documentación: https://datosgobar.github.io/series-tiempo-ar-api/
 *
 * Endpoints (verificados el 2026-11-02):
 *   GET /series/api/series/?ids=…         valores (limit ≤ 5000, start = offset, start_date, end_date)
 *   GET /series/api/search/?q=…           búsqueda de series
 *   GET /series/api/dump/series-tiempo-metadatos.csv/   catálogo completo (CSV ~26 MB)
 * Sin autenticación. Máximo 40 series por llamada. Fechas = inicio del período.
 */
export const INDEC_API_BASE = "https://apis.datos.gob.ar/series/api";
export const INDEC_PAGE_LIMIT = 5000;
export const INDEC_SOURCE_LABEL = "Instituto Nacional de Estadística y Censos (INDEC)";

const ISO_FREQ: Record<string, Frequency> = {
  "R/P1D": "D",
  "R/P1W": "W",
  "R/P1M": "M",
  "R/P3M": "Q",
  "R/P6M": "S",
  "R/P1Y": "A",
};
const WORD_FREQ: Record<string, Frequency> = {
  day: "D",
  week: "W",
  month: "M",
  quarter: "Q",
  semester: "S",
  year: "A",
};

export function mapIndecFrequency(code: string): Frequency {
  const c = code?.trim();
  const f = ISO_FREQ[c?.toUpperCase()] ?? WORD_FREQ[c?.toLowerCase()];
  if (!f) throw new Error(`Frecuencia desconocida en API Series de Tiempo: "${code}"`);
  return f;
}

interface SeriesResponse {
  data: [string, number | null][];
  count: number;
  meta?: [
    { frequency: string; start_date: string; end_date: string },
    ...{
      dataset: Record<string, unknown> & { title?: string; source?: string; description?: string; theme?: { label: string }[] };
      distribution: Record<string, unknown> & { title?: string; description?: string; downloadURL?: string };
      field: Record<string, unknown> & {
        id: string;
        description?: string;
        units?: string;
        frequency?: string;
        time_index_start?: string;
        time_index_end?: string;
        is_percentage?: boolean;
      };
    }[],
  ];
}

export interface IndecSeriesMeta extends DiscoveredSeries {
  /** La API indica que los valores son proporciones (0.05 = 5 %). */
  isPercentage: boolean;
  methodology: string | null;
}

/** Fila del volcado series-tiempo-metadatos.csv. */
export type DumpRow = Record<string, string>;

export function dumpRowToDiscovered(row: DumpRow): DiscoveredSeries {
  const code = row.serie_id;
  const theme = row.dataset_tema?.trim();
  return {
    sourceId: "INDEC",
    sourceCode: code,
    name: (row.serie_descripcion || row.serie_titulo).replace(/\s+/g, " ").trim().replace(/\.$/, ""),
    category: theme || "Sin clasificar",
    subcategory: row.dataset_titulo?.trim() || null,
    description: [row.serie_descripcion, row.distribucion_titulo].filter(Boolean).join(" — "),
    unit: row.serie_unidades?.trim() || "s/d",
    frequency: mapIndecFrequency(row.indice_tiempo_frecuencia),
    currency: null,
    endpoint: `${INDEC_API_BASE}/series/?ids=${encodeURIComponent(code)}`,
    sourceStartDate: row.serie_indice_inicio || null,
    sourceLastDate: row.serie_indice_final || null,
    discontinued: row.serie_discontinuada === "True",
    raw: row,
  };
}

export class INDECConnector implements SourceConnector {
  readonly sourceId = "INDEC" as const;
  private readonly http: HttpClient;
  private readonly fetchImpl: FetchLike;

  constructor(opts: { fetchImpl?: FetchLike; minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
    this.http = new HttpClient({
      sourceId: "INDEC",
      fetchImpl: this.fetchImpl,
      minIntervalMs: opts.minIntervalMs ?? 250,
      sleep: opts.sleep,
    });
  }

  /**
   * Descarga el volcado oficial de metadatos y devuelve solo las series cuya
   * fuente es el INDEC (≈9.400 series al 2026-11).
   */
  async discover(): Promise<DiscoveredSeries[]> {
    const url = `${INDEC_API_BASE}/dump/series-tiempo-metadatos.csv/`;
    let text: string;
    try {
      const res = await this.fetchImpl(url, { headers: { Accept: "text/csv" } });
      if (!res.ok) {
        throw new ConnectorError(`HTTP ${res.status} al descargar el catálogo`, {
          sourceId: "INDEC", url, httpStatus: res.status, stage: "fetch",
        });
      }
      text = await res.text();
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(`Error de red al descargar el catálogo: ${(err as Error).message}`, {
        sourceId: "INDEC", url, stage: "fetch",
      });
    }
    return parseIndecDump(text);
  }

  async describe(sourceCode: string): Promise<IndecSeriesMeta> {
    const url = buildUrl(`${INDEC_API_BASE}/series/`, { ids: sourceCode, last: 1, metadata: "full" });
    const res = await this.http.getJson<SeriesResponse>(url);
    const m = res.meta?.[1];
    if (!m?.field) {
      throw new ConnectorError(`Sin metadatos para la serie ${sourceCode}`, { sourceId: "INDEC", url, stage: "parse" });
    }
    const { field, dataset, distribution } = m;
    const methodology = [dataset.description, distribution.description]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n\n") || null;
    return {
      sourceId: "INDEC",
      sourceCode,
      name: String(field.description ?? sourceCode).replace(/\.$/, ""),
      category: dataset.theme?.[0]?.label ?? "Sin clasificar",
      subcategory: dataset.title ?? null,
      description: [field.description, distribution.title].filter(Boolean).join(" — "),
      unit: String(field.units ?? "s/d"),
      frequency: mapIndecFrequency(String(field.frequency ?? res.meta![0].frequency)),
      currency: null,
      endpoint: `${INDEC_API_BASE}/series/?ids=${encodeURIComponent(sourceCode)}`,
      sourceStartDate: field.time_index_start ?? null,
      sourceLastDate: field.time_index_end ?? null,
      isPercentage: field.is_percentage === true,
      methodology,
      raw: m,
    };
  }

  async fetchSeries(sourceCode: string, range: FetchRange = {}): Promise<FetchResult> {
    const endpoint = `${INDEC_API_BASE}/series/?ids=${encodeURIComponent(sourceCode)}`;
    const observations: RawObservation[] = [];
    let reportedCount: number | undefined;
    let requests = 0;

    for (let start = 0; ; start += INDEC_PAGE_LIMIT) {
      const url = buildUrl(`${INDEC_API_BASE}/series/`, {
        ids: sourceCode,
        start_date: range.from,
        end_date: range.to,
        limit: INDEC_PAGE_LIMIT,
        start,
        metadata: "none",
        format: "json",
      });
      const res = await this.http.getJson<SeriesResponse>(url);
      requests++;
      if (!Array.isArray(res.data)) {
        throw new ConnectorError(`Respuesta sin "data" para ${sourceCode}`, { sourceId: "INDEC", url, stage: "parse" });
      }
      reportedCount ??= res.count;
      for (const [date, value] of res.data) observations.push({ date, value });
      if (res.data.length < INDEC_PAGE_LIMIT) break;
      if (observations.length >= res.count) break;
    }

    return { sourceCode, endpoint, observations, reportedCount, requests };
  }

  async fetchMethodology(sourceCode: string): Promise<string | null> {
    return (await this.describe(sourceCode)).methodology;
  }
}

export function parseIndecDump(text: string): DiscoveredSeries[] {
  const rows = parseCsv(text);
  const out: DiscoveredSeries[] = [];
  for (const row of rows) {
    if (!row.dataset_fuente?.includes("INDEC")) continue;
    if (!row.serie_id) continue;
    try {
      out.push(dumpRowToDiscovered(row));
    } catch {
      // Frecuencia no reconocida: se omite la fila, no rompe el catálogo.
    }
  }
  return out;
}
