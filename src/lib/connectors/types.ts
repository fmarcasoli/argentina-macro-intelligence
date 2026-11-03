/**
 * Contratos compartidos por todos los conectores de fuentes oficiales.
 *
 * Un conector solo sabe hablar con su API: descarga, pagina y devuelve los
 * datos tal como llegan (RawObservation). La normalización y la persistencia
 * viven en capas separadas para poder testearlas sin red.
 */

export type SourceId = "BCRA" | "INDEC";

/** D diaria, W semanal, M mensual, Q trimestral, S semestral, A anual */
export type Frequency = "D" | "W" | "M" | "Q" | "S" | "A";

export type ValueKind = "original" | "normalized" | "calculated" | "estimated";

/** Un punto exactamente como lo devolvió la fuente, sin interpretar. */
export interface RawObservation {
  /** Fecha como texto, tal cual la fuente (ej. "2026-08-31"). */
  date: string;
  /** Valor como llegó: número, texto o null. Nunca se reemplaza por 0. */
  value: number | string | null;
}

/** Metadatos descubiertos en el catálogo de la fuente. */
export interface DiscoveredSeries {
  sourceId: SourceId;
  sourceCode: string;
  name: string;
  category: string;
  subcategory?: string | null;
  description?: string | null;
  unit: string;
  frequency: Frequency;
  currency?: string | null;
  endpoint: string;
  sourceStartDate?: string | null;
  sourceLastDate?: string | null;
  discontinued?: boolean;
  /** Payload original de metadatos, para auditoría. */
  raw: unknown;
}

export interface FetchRange {
  /** YYYY-MM-DD inclusive. */
  from?: string;
  /** YYYY-MM-DD inclusive. */
  to?: string;
}

export interface FetchResult {
  sourceCode: string;
  endpoint: string;
  observations: RawObservation[];
  /** Cantidad total informada por la fuente, si la informa. */
  reportedCount?: number;
  requests: number;
}

export interface SourceConnector {
  readonly sourceId: SourceId;
  /** Lista todas las series que expone la fuente. */
  discover(): Promise<DiscoveredSeries[]>;
  /** Metadatos de una serie puntual. */
  describe(sourceCode: string): Promise<DiscoveredSeries>;
  /** Descarga observaciones (todas o un rango), resolviendo la paginación. */
  fetchSeries(sourceCode: string, range?: FetchRange): Promise<FetchResult>;
  /** Texto de metodología, si la fuente lo publica. */
  fetchMethodology?(sourceCode: string): Promise<string | null>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly details: {
      sourceId: SourceId;
      url?: string;
      httpStatus?: number;
      body?: string;
      stage?: "fetch" | "parse";
    },
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
