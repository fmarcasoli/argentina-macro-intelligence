import type { Frequency, SourceId, ValueKind } from "../connectors/types";

/** Punto de una serie: fecha de referencia (inicio del período) y valor. */
export interface Pt {
  d: string;
  v: number | null;
}

/** Metadatos mínimos de una serie para el motor de análisis (seguros para el cliente). */
export interface SeriesMeta {
  id: string;
  name: string;
  source_id: SourceId;
  source_code: string | null;
  unit: string;
  frequency: Frequency;
  value_kind: ValueKind;
  category: string;
  subcategory: string | null;
  panel: string | null;
  update_status: string;
  last_date: string | null;
  methodology_url: string | null;
}

export interface SeriesData {
  meta: SeriesMeta;
  points: Pt[];
}

export type Transform = "level" | "pct_prev" | "pct_yoy" | "index100" | "real";
export type Aggregation = "avg" | "last" | "sum";
export type TargetFrequency = Frequency | "auto";

export const TRANSFORM_LABEL: Record<Transform, string> = {
  level: "Valores absolutos",
  pct_prev: "Var. % período anterior",
  pct_yoy: "Var. % interanual",
  index100: "Índice base 100",
  real: "Valores reales (deflactados por IPC)",
};

export const AGG_LABEL: Record<Aggregation, string> = {
  avg: "Promedio del período",
  last: "Último dato del período",
  sum: "Suma del período",
};

export interface Notice {
  level: "info" | "warning";
  message: string;
  seriesId?: string;
}
