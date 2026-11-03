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

/**
 * Conector de la API de Estadísticas Monetarias v4.0 del BCRA.
 *
 * Documentación oficial: https://www.bcra.gob.ar/apis-banco-central/
 * Endpoints (verificados el 2026-11-02):
 *   GET /estadisticas/v4.0/Monetarias                 catálogo (Limit ≤ 3000, Offset)
 *   GET /estadisticas/v4.0/Monetarias/{id}            serie (Desde, Hasta, Limit ≤ 3000, Offset)
 *   GET /estadisticas/v4.0/Metodologia/{id}           ficha metodológica
 * Sin autenticación. La respuesta de series viene ordenada de la fecha más
 * reciente a la más antigua e informa el total en metadata.resultset.count.
 */
export const BCRA_BASE_URL = "https://api.bcra.gob.ar/estadisticas/v4.0";
export const BCRA_PAGE_LIMIT = 3000;

interface BcraEnvelope<T> {
  status: number;
  metadata?: { resultset?: { count?: number; offset?: number; limit?: number } };
  results: T;
  errorMessages?: string[];
}

export interface BcraCatalogItem {
  idVariable: number;
  descripcion: string;
  categoria: string;
  tipoSerie: string;
  periodicidad: string;
  unidadExpresion: string;
  moneda: string | null;
  primerFechaInformada: string | null;
  ultFechaInformada: string | null;
  ultValorInformado: number | null;
}

interface BcraSeriesResult {
  idVariable: number;
  detalle: { fecha: string; valor: number | null }[];
}

const FREQUENCY_MAP: Record<string, Frequency> = {
  D: "D",
  S: "W", // semanal (no observado en v4.0, se mapea por las dudas)
  M: "M",
  T: "Q",
  A: "A",
};

export function mapBcraFrequency(code: string): Frequency {
  const f = FREQUENCY_MAP[code?.trim().toUpperCase()];
  if (!f) throw new Error(`Periodicidad BCRA desconocida: "${code}"`);
  return f;
}

export function bcraItemToDiscovered(item: BcraCatalogItem): DiscoveredSeries {
  const code = String(item.idVariable);
  return {
    sourceId: "BCRA",
    sourceCode: code,
    name: item.descripcion.replace(/\s+/g, " ").trim().replace(/\.$/, ""),
    category: item.categoria.trim(),
    subcategory: item.tipoSerie?.trim() || null,
    description: item.descripcion.replace(/\s+/g, " ").trim(),
    unit: item.unidadExpresion?.trim() || "s/d",
    frequency: mapBcraFrequency(item.periodicidad),
    currency: item.moneda,
    endpoint: `${BCRA_BASE_URL}/Monetarias/${code}`,
    sourceStartDate: item.primerFechaInformada,
    sourceLastDate: item.ultFechaInformada,
    raw: item,
  };
}

export class BCRAConnector implements SourceConnector {
  readonly sourceId = "BCRA" as const;
  private readonly http: HttpClient;

  constructor(opts: { fetchImpl?: FetchLike; minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.http = new HttpClient({
      sourceId: "BCRA",
      fetchImpl: opts.fetchImpl,
      minIntervalMs: opts.minIntervalMs ?? 250,
      sleep: opts.sleep,
    });
  }

  async discover(): Promise<DiscoveredSeries[]> {
    const all: BcraCatalogItem[] = [];
    for (let offset = 0; ; offset += BCRA_PAGE_LIMIT) {
      const url = buildUrl(`${BCRA_BASE_URL}/Monetarias`, { Limit: BCRA_PAGE_LIMIT, Offset: offset });
      const env = await this.http.getJson<BcraEnvelope<BcraCatalogItem[]>>(url);
      this.assertOk(env, url);
      all.push(...env.results);
      if (env.results.length < BCRA_PAGE_LIMIT) break;
    }
    return all.map(bcraItemToDiscovered);
  }

  async describe(sourceCode: string): Promise<DiscoveredSeries> {
    const url = buildUrl(`${BCRA_BASE_URL}/Monetarias`, { IdVariable: sourceCode });
    const env = await this.http.getJson<BcraEnvelope<BcraCatalogItem[]>>(url);
    this.assertOk(env, url);
    const item = env.results.find((r) => String(r.idVariable) === String(sourceCode));
    if (!item) {
      throw new ConnectorError(`La variable BCRA ${sourceCode} no existe en el catálogo`, {
        sourceId: "BCRA",
        url,
        stage: "parse",
      });
    }
    return bcraItemToDiscovered(item);
  }

  async fetchSeries(sourceCode: string, range: FetchRange = {}): Promise<FetchResult> {
    const endpoint = `${BCRA_BASE_URL}/Monetarias/${encodeURIComponent(sourceCode)}`;
    const observations: RawObservation[] = [];
    let reportedCount: number | undefined;
    let requests = 0;

    for (let offset = 0; ; offset += BCRA_PAGE_LIMIT) {
      const url = buildUrl(endpoint, {
        Desde: range.from,
        Hasta: range.to,
        Limit: BCRA_PAGE_LIMIT,
        Offset: offset,
      });
      const env = await this.http.getJson<BcraEnvelope<BcraSeriesResult[]>>(url);
      requests++;
      this.assertOk(env, url);
      reportedCount ??= env.metadata?.resultset?.count;
      const block = env.results?.[0];
      if (!block || !Array.isArray(block.detalle)) {
        throw new ConnectorError(`Respuesta BCRA sin "detalle" para ${sourceCode}`, {
          sourceId: "BCRA",
          url,
          stage: "parse",
        });
      }
      for (const d of block.detalle) observations.push({ date: d.fecha, value: d.valor });
      if (block.detalle.length < BCRA_PAGE_LIMIT) break;
      if (reportedCount !== undefined && observations.length >= reportedCount) break;
    }

    return { sourceCode, endpoint, observations, reportedCount, requests };
  }

  async fetchMethodology(sourceCode: string): Promise<string | null> {
    const url = `${BCRA_BASE_URL}/Metodologia/${encodeURIComponent(sourceCode)}`;
    try {
      const env = await this.http.getJson<BcraEnvelope<{ id: number; detalle: string }[]>>(url);
      return env.results?.[0]?.detalle?.trim() || null;
    } catch (err) {
      if (err instanceof ConnectorError && err.details.httpStatus === 404) return null;
      throw err;
    }
  }

  private assertOk(env: BcraEnvelope<unknown>, url: string) {
    if (env.status !== 200 || !Array.isArray(env.results)) {
      throw new ConnectorError(
        `BCRA devolvió status ${env.status}: ${(env.errorMessages ?? []).join("; ") || "sin detalle"}`,
        { sourceId: "BCRA", url, httpStatus: env.status, stage: "parse" },
      );
    }
  }
}
