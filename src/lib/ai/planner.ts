import type { ReportKind } from "./reports";
import type { ToolCall } from "./types";
import { findConcepts, normalizeText, parsePeriod, type Concept } from "./vocabulary";

/**
 * Planificador sin modelo de lenguaje. Interpreta las consultas habituales
 * con reglas (vocabulario económico + intención + período) y arma un plan de
 * herramientas. Es el modo de funcionamiento cuando la IA está desactivada o
 * el modelo no responde: la respuesta es cuantitativa y con fuentes, pero sin
 * interpretación en lenguaje natural.
 */

export type Intent =
  | "report"
  | "forecast"
  | "econometric"
  | "regression"
  | "relation"
  | "lags"
  | "ranking"
  | "anomalies"
  | "chart"
  | "compare"
  | "evolution"
  | "saved"
  | "search";

export interface Plan {
  intent: Intent;
  concepts: Concept[];
  period: { from?: string; to?: string; label: string };
  calls: ToolCall[];
  /** Cómo se interpretó la consulta (se muestra al usuario). */
  understanding: string;
}

const INTENT_LABEL: Record<Intent, string> = {
  report: "informe",
  forecast: "proyección",
  econometric: "análisis econométrico",
  regression: "regresión",
  relation: "relación entre variables",
  lags: "adelantos y rezagos",
  ranking: "períodos de mayor variación",
  anomalies: "detección de anomalías",
  chart: "gráfico",
  compare: "comparación",
  evolution: "evolución",
  saved: "análisis guardados",
  search: "búsqueda en el catálogo",
};

const REPORT_WORDS: [RegExp, ReportKind][] = [
  [/diari/, "diario"],
  [/mensual/, "mensual"],
  [/inflacion|precios/, "inflacion"],
  [/monetari|dinero|base monetaria|m2/, "monetario"],
  [/cambiari|dolar|tipo de cambio/, "cambiario"],
  [/reserva/, "reservas"],
  [/actividad|emae/, "actividad"],
  [/salari/, "salarios"],
];

const STOP = new Set("el la los las de del y e o u en con para por que como cual cuales a al un una unos unas sobre entre desde hasta analiza analizar mostrame mostra dame cual es son fue ultimos ultimas meses anos datos serie series evolucion graficar grafica grafico".split(" "));

export function plan(question: string, today: string): Plan {
  const t = normalizeText(question);
  const concepts = findConcepts(question);
  const period = parsePeriod(question, today);
  const ids = concepts.map((c) => c.id);
  const range = { ...(period.from ? { desde: period.from.slice(0, 7) } : {}), ...(period.to ? { hasta: period.to.slice(0, 7) } : {}) };
  let intent: Intent;
  const calls: ToolCall[] = [];
  const has = (re: RegExp) => re.test(t);

  if (has(/\b(informe|reporte)\b/)) {
    intent = "report";
    const kind = ids.length && !REPORT_WORDS.some(([re]) => re.test(t)) ? "personalizado" : (REPORT_WORDS.find(([re]) => re.test(t))?.[1] ?? "mensual");
    calls.push({ name: "informe", args: kind === "personalizado" ? { tipo: kind, ids } : { tipo: kind } });
  } else if (has(/analisis guardados|mis analisis|guardad/)) {
    intent = "saved";
    calls.push({ name: "analisis_guardados", args: {} });
  } else if (!ids.length) {
    intent = "search";
    const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 4);
    calls.push({ name: "buscar_series", args: { consulta: words.join(" ") || question.slice(0, 60), limite: 10 } });
  } else if (has(/proyect|pronostic|predec|prevision|va a (estar|ser|llegar)|futur/)) {
    intent = "forecast";
    const h = /(\d+)\s*mes/.exec(t);
    calls.push({ name: "proyeccion", args: { id: ids[0], horizonte: h ? Math.min(36, Number(h[1])) : 12, ...(period.from ? { desde: period.from.slice(0, 7) } : {}) } });
  } else if (ids.length >= 2 && has(/econometric|cointegra|granger|\bvar\b|vector autorregresivo/)) {
    intent = "econometric";
    calls.push({ name: "analisis_econometrico", args: { ids: ids.slice(0, 4), ...range } });
  } else if (ids.length >= 2 && has(/regresi|elasticidad|efecto de|impacto de/)) {
    intent = "regression";
    // La dependiente es la última mencionada si se pregunta "efecto de X sobre Y"; por defecto la primera.
    const dep = has(/(efecto|impacto) de/) ? ids[ids.length - 1] : ids[0];
    calls.push({ name: "regresion", args: { dependiente: dep, explicativas: ids.filter((i) => i !== dep), rezagos: [0, 1, 2], ...range } });
  } else if (ids.length >= 2 && has(/rezago|adelanta|anticipa|precede/)) {
    intent = "lags";
    calls.push({ name: "rezagos", args: { x: ids[0], y: ids[1], ...range } });
  } else if (ids.length >= 2 && has(/relacion|correlacion|asocia|vincul|se mueven/)) {
    intent = "relation";
    calls.push({ name: "correlacion", args: { ids, rezagos: 12, ...range } }, { name: "rezagos", args: { x: ids[0], y: ids[1], ...range } }, { name: "grafico", args: { ids, ...range, transformacion: "variacion_interanual" } });
  } else if (has(/mayor(es)? (expansion|aumento|suba|crecimiento|caida|baja)|menor(es)?|picos?|record|periodos? de/)) {
    intent = "ranking";
    calls.push(...ids.slice(0, 2).map((id) => ({ name: "calcular", args: { id, operacion: "ranking", ...range } })));
  } else if (has(/anomal|inusual|atipic|alerta|extremo|acelera|desacelera|cambio de tendencia|divergen/)) {
    intent = "anomalies";
    calls.push({ name: "anomalias", args: { ids: ids.slice(0, 4), ...range } });
  } else if (has(/grafic|chart|visualiz|dibuj/)) {
    intent = "chart";
    calls.push({ name: "grafico", args: { ids, ...range } });
  } else if (ids.length >= 2 || has(/compar|versus|\bvs\b|frente a/)) {
    intent = "compare";
    const real = has(/\breal(es)?\b|deflact|poder adquisitivo/);
    calls.push({ name: "comparar", args: { ids: ids.length >= 2 ? ids : [ids[0], "indec.ipc_nivel_general"], transformacion: "base100", ...range } });
    if (real) calls.push(...ids.filter((id) => id !== "indec.ipc_nivel_general").slice(0, 2).map((id) => ({ name: "obtener_datos", args: { ids: [id], transformacion: "real_variacion_interanual", ...range } })));
  } else {
    intent = "evolution";
    const id = ids[0];
    calls.push(
      { name: "calcular", args: { id, operacion: "variacion_entre_fechas", ...(period.from ? { desde: period.from.slice(0, 7) } : {}), ...(period.to ? { hasta: period.to.slice(0, 7) } : {}) } },
      { name: "grafico", args: { ids: [id], ...range } },
      { name: "calcular", args: { id, operacion: "estadisticas", ...range } },
      { name: "anomalias", args: { ids: [id], ...range } },
    );
  }
  const names = concepts.map((c) => c.label).join(", ");
  return {
    intent,
    concepts,
    period,
    calls,
    understanding: `Interpreté la consulta como ${INTENT_LABEL[intent]}${names ? ` de ${names}` : ""} (${period.label}).`,
  };
}
