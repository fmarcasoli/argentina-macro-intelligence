import type { Pt, SeriesData } from "../analysis/types";
import type { Frequency, SourceId } from "../connectors/types";

/**
 * Tipos de MACRO AI. Las respuestas son ESTRUCTURADAS: los gráficos, tablas y
 * cifras salen de herramientas que leen datos reales; el texto del modelo
 * (si lo hay) solo los explica. Así ninguna cifra mostrada puede ser inventada.
 */

/** Serie utilizada en una respuesta: siempre con fuente, código, unidad, frecuencia y período. */
export interface SourceRef {
  id: string;
  name: string;
  source: SourceId;
  code: string | null;
  unit: string;
  frequency: Frequency;
  from: string | null;
  to: string | null;
  /** Transformación aplicada (receta legible). */
  transform?: string;
  /** Tipo de dato: original, normalizado o calculado por la plataforma. */
  kind?: string;
}

export type Block =
  | { type: "text"; text: string; origin: "tool" | "model" }
  | {
      type: "chart";
      title: string;
      /** Un panel por grupo de unidades compatibles (nunca doble eje). */
      panels: { unit: string; series: { key: string; name: string }[] }[];
      rows: Record<string, string | number | null>[];
      note?: string;
    }
  | { type: "table"; title: string; header: string[]; rows: (string | number | null)[][]; note?: string }
  | { type: "stats"; items: { label: string; value: string; note?: string }[] }
  | { type: "notes"; level: "warning" | "info"; items: string[] };

export interface ToolResult {
  ok: boolean;
  /** Resumen compacto para el modelo (cifras reales, con unidades y fechas). */
  summary: string;
  blocks: Block[];
  sources: SourceRef[];
  methodology: string[];
  error?: string;
}

/** Acceso a datos que usan las herramientas: solo lectura y con parámetros validados. */
export interface DataClient {
  search(q: string, opts?: { source?: SourceId; limit?: number }): Promise<CatalogHit[]>;
  series(ids: string[]): Promise<{ series: SeriesData[]; ipc?: Pt[]; missing: string[]; errors: Record<string, string> }>;
  savedAnalyses(): Promise<{ id: string; title: string; kind: string; indicator_ids: string[]; updated_at: string }[]>;
}

export interface CatalogHit {
  id: string;
  name: string;
  source_id: SourceId;
  source_code: string | null;
  unit: string;
  frequency: Frequency;
  last_date: string | null;
  update_status: string;
  observation_count?: number;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolTrace extends ToolCall {
  ok: boolean;
  summary: string;
  ms: number;
}

/** Mensaje del chat tal como se guarda y muestra. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  blocks?: Block[];
  sources?: SourceRef[];
  methodology?: string[];
  tools?: ToolTrace[];
  /** Cómo se generó la respuesta. */
  mode?: "model" | "rules" | "disabled";
  model?: string;
  /** Cifras del texto del modelo que no aparecen en los datos de las herramientas. */
  unverified?: string[];
  createdAt: string;
}
