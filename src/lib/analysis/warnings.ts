import { FREQ_NAME } from "./frequency";
import type { Frequency } from "../connectors/types";
import type { Notice, SeriesMeta, Transform } from "./types";
import { indexBase, normalizeUnit, unitFamily } from "./units";

const SA = /desestacionaliz|sin estacionalidad|tendencia[- ]ciclo/i;
const REAL = /\breal(es)?\b|constantes|deflactad/i;
const NOMINAL = /corrientes|nominal/i;

/**
 * Advertencias metodológicas al combinar series. Son reglas explícitas y
 * verificables: no bloquean el análisis, pero se muestran junto al gráfico.
 */
export function methodologyWarnings(series: SeriesMeta[], transform: Transform, target: Frequency): Notice[] {
  const out: Notice[] = [];
  if (series.length === 0) return out;

  const sources = new Set(series.map((s) => s.source_id));
  if (sources.size > 1) {
    out.push({
      level: "info",
      message:
        "Combina series del INDEC y del BCRA: cada institución tiene metodologías, coberturas y calendarios de publicación propios.",
    });
  }

  const sa = series.filter((s) => SA.test(s.name));
  if (sa.length && sa.length < series.length) {
    out.push({
      level: "warning",
      message: `Mezcla series desestacionalizadas (${sa.map((s) => s.name).join(", ")}) con series originales: las variaciones de corto plazo no son comparables.`,
    });
  }

  if (transform === "level") {
    const bases = new Map<string, string[]>();
    for (const s of series) {
      if (unitFamily(s.unit, s.name) !== "index") continue;
      const b = indexBase(`${s.unit} ${s.name}`);
      if (!b) continue;
      bases.set(b, [...(bases.get(b) ?? []), s.name]);
    }
    if (bases.size > 1) {
      out.push({
        level: "warning",
        message: `Índices con bases distintas (${[...bases.keys()].join(", ")}): sus niveles no son comparables. Usá "Índice base 100" o variaciones.`,
      });
    }
  }

  const real = series.filter((s) => REAL.test(s.name) || REAL.test(s.unit));
  const nominal = series.filter((s) => NOMINAL.test(s.name) || NOMINAL.test(s.unit) || unitFamily(s.unit, s.name) === "ars");
  if (real.length && nominal.length && transform !== "real") {
    out.push({
      level: "warning",
      message: "Combina series a precios constantes (reales) con series a precios corrientes (nominales).",
    });
  }

  const freqs = new Set(series.map((s) => s.frequency));
  if (freqs.size > 1) {
    out.push({
      level: "info",
      message: `Las series tienen frecuencias distintas (${[...freqs].map((f) => FREQ_NAME[f]).join(", ")}): se agregan a frecuencia ${FREQ_NAME[target]}. Nunca se desagregan ni se interpolan.`,
    });
  }

  const inflation = series.filter((s) => /inflaci[oó]n|\bIPC\b/i.test(s.name));
  if (inflation.length > 1 && new Set(inflation.map((s) => s.source_id)).size > 1) {
    out.push({
      level: "warning",
      message:
        "La inflación que publica el BCRA reproduce el dato del INDEC con redondeo y fechas de cierre de mes: pequeñas diferencias son esperables.",
    });
  }

  for (const s of series) {
    if (s.update_status === "discontinued") {
      out.push({ level: "warning", seriesId: s.id, message: `${s.name}: serie discontinuada por la fuente.` });
    } else if (s.update_status === "stale") {
      out.push({ level: "info", seriesId: s.id, message: `${s.name}: la fuente no publicó datos recientes (desactualizada).` });
    }
  }

  const calc = series.filter((s) => s.value_kind === "calculated");
  if (calc.length) {
    out.push({
      level: "info",
      message: `Incluye series calculadas por la plataforma a partir de datos oficiales: ${calc.map((s) => s.name).join(", ")}.`,
    });
  }
  return out;
}

/**
 * ¿Pueden graficarse en un mismo eje? Solo si, después de la transformación,
 * expresan la misma magnitud en la misma unidad.
 */
export function canShareAxis(series: SeriesMeta[], transform: Transform): { ok: boolean; reason?: string } {
  if (series.length <= 1) return { ok: true };
  if (transform === "pct_prev" || transform === "pct_yoy" || transform === "index100") return { ok: true };
  const units = new Set(series.map((s) => normalizeUnit(s.unit)));
  if (units.size === 1) {
    if (unitFamily(series[0].unit, series[0].name) === "index") {
      const bases = new Set(series.map((s) => indexBase(`${s.unit} ${s.name}`)));
      if (bases.size > 1) return { ok: false, reason: "índices con bases distintas" };
    }
    return { ok: true };
  }
  return {
    ok: false,
    reason: `unidades incompatibles (${[...new Set(series.map((s) => s.unit))].join(" · ")})`,
  };
}
