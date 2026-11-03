import { z } from "zod";
import { periodBreakdown, rangeChange } from "../analysis/breakdown";
import { FREQ_NAME } from "../analysis/frequency";
import type { Frequency } from "../connectors/types";
import { correlationMatrix, laggedCorrelations } from "../econ/correlation";
import { runForecast, METHOD_LABEL, type ForecastMethod } from "../econ/forecast";
import { buildDesign, ols } from "../econ/regression";
import { cagr, describe } from "../econ/stats";
import { prepare, type PreparedDataset } from "../econ/tasks";
import type { TransformStep } from "../econ/transforms";
import { stationarity } from "../econ/unitroot";
import { grangerTest, selectVarOrder } from "../econ/var";
import { johansen } from "../econ/vecm";
import { ANOMALY_LABEL, detectAnomalies, detectCorrelationChange } from "./anomalies";
import type { Block, DataClient, SourceRef, ToolResult } from "./types";

/**
 * Herramientas de MACRO AI. Son la ÚNICA vía del asistente hacia los datos:
 * parámetros validados (zod), lectura por el cliente de datos de la app
 * (catálogo y series; nunca SQL), cálculos con el motor econométrico
 * verificado y resultados con fuentes, unidades, períodos y metodología.
 */

// ── Parámetros comunes ──────────────────────────────────────────────────────

const ID = z.string().regex(/^[\w.\-]{1,120}$/, "ID de serie inválido");
const ids = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v), z.array(ID).min(min).max(max));
const DATE = z
  .string()
  .regex(/^\d{4}(-\d{2})?(-\d{2})?$/, "Fecha con formato AAAA, AAAA-MM o AAAA-MM-DD")
  .optional();

export const TRANSFORMS = {
  nivel: { label: "Nivel", steps: [] as TransformStep[] },
  variacion_mensual: { label: "Variación % contra el período anterior", steps: [{ op: "pct" }] as TransformStep[] },
  variacion_interanual: { label: "Variación % interanual", steps: [{ op: "yoy" }] as TransformStep[] },
  real: { label: "Valores reales (deflactados por IPC)", steps: [{ op: "deflate" }] as TransformStep[] },
  real_variacion_interanual: { label: "Variación % interanual real", steps: [{ op: "deflate" }, { op: "yoy" }] as TransformStep[] },
  log: { label: "Logaritmo", steps: [{ op: "log" }] as TransformStep[] },
  diferencia: { label: "Diferencia", steps: [{ op: "diff" }] as TransformStep[] },
  base100: { label: "Índice base 100 al inicio", steps: [{ op: "index100" }] as TransformStep[] },
} as const;
export type TransformKey = keyof typeof TRANSFORMS;
const TRANSFORM = z.enum(Object.keys(TRANSFORMS) as [TransformKey, ...TransformKey[]]);
const FREQ = z.enum(["M", "Q", "A", "D"]).optional();

function normFrom(d?: string): string | undefined {
  if (!d) return undefined;
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;
  return `${d.slice(0, 7)}-01`;
}
function normTo(d?: string): string | undefined {
  if (!d) return undefined;
  if (/^\d{4}$/.test(d)) return `${d}-12-31`;
  return `${d.slice(0, 7)}-31`;
}

/** Transformación por defecto de cada serie: la inflación se analiza como variación mensual del IPC. */
function defaultTransform(id: string): TransformKey {
  return id === "indec.ipc_nivel_general" || id === "indec.ipc_nucleo" || id === "indec.ipc_regulados" ? "variacion_mensual" : "nivel";
}

const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "s/d" : v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

// ── Carga y preparación ─────────────────────────────────────────────────────

interface Loaded {
  d: PreparedDataset;
  sources: SourceRef[];
  methodology: string[];
  warnings: string[];
}

async function load(
  client: DataClient,
  seriesIds: string[],
  opts: { transform?: TransformKey | TransformKey[]; from?: string; to?: string; frequency?: Frequency },
): Promise<Loaded> {
  const res = await client.series(seriesIds);
  const warnings: string[] = [];
  if (res.missing.length) warnings.push(`No existen en el catálogo: ${res.missing.join(", ")}. Usá buscar_series para encontrar el ID correcto.`);
  for (const [id, e] of Object.entries(res.errors)) warnings.push(`${id}: no se pudo descargar de la fuente (${e}).`);
  const series = seriesIds.map((id) => res.series.find((s) => s.meta.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s && s.points.length));
  if (!series.length) throw new Error(`Ninguna de las series pedidas tiene datos (${seriesIds.join(", ")}).`);
  const keys = series.map((s, i) => (Array.isArray(opts.transform) ? (opts.transform[i] ?? defaultTransform(s.meta.id)) : (opts.transform ?? defaultTransform(s.meta.id))));
  const recipes = Object.fromEntries(series.map((s, i) => [s.meta.id, TRANSFORMS[keys[i]].steps]));
  const d = prepare({ series, ipc: res.ipc, recipes, frequency: opts.frequency ?? (series.some((s) => s.meta.frequency === "D" || s.meta.frequency === "W") ? "M" : undefined), from: opts.from, to: opts.to });
  for (const s of series) {
    if (s.meta.update_status === "stale") warnings.push(`${s.meta.name}: la fuente está desactualizada (último dato ${s.meta.last_date}).`);
    if (s.meta.update_status === "discontinued") warnings.push(`${s.meta.name}: serie discontinuada por la fuente.`);
  }
  const freqs = new Set(series.map((s) => s.meta.frequency));
  if (freqs.size > 1) warnings.push(`Las series tienen frecuencias distintas (${[...freqs].map((f) => FREQ_NAME[f as Frequency]).join(", ")}): se llevaron a frecuencia ${FREQ_NAME[d.frequency]} sin desagregar.`);
  const sources: SourceRef[] = series.map((s, i) => ({
    id: s.meta.id,
    name: s.meta.name,
    source: s.meta.source_id,
    code: s.meta.source_code,
    unit: d.series[i].unit,
    frequency: s.meta.frequency,
    from: d.dates[0] ?? null,
    to: d.dates[d.dates.length - 1] ?? null,
    transform: d.series[i].recipe,
    kind: s.meta.value_kind,
  }));
  const methodology = [
    ...d.series.flatMap((s) => [`${s.name}: ${s.recipe}`, ...s.log.map((l) => `  ${l}`)]),
    `Frecuencia de análisis: ${FREQ_NAME[d.frequency]}; ${d.dates.length} observaciones comunes (${d.dates[0]} a ${d.dates[d.dates.length - 1]}).`,
    ...d.notes,
  ];
  return { d, sources, methodology, warnings };
}

/** Bloque de gráfico: un panel por unidad (nunca doble eje). */
export function chartBlock(d: PreparedDataset, title: string, maxPoints = 600): Block {
  const groups = new Map<string, number[]>();
  d.series.forEach((s, j) => groups.set(s.unit, [...(groups.get(s.unit) ?? []), j]));
  const step = Math.max(1, Math.ceil(d.dates.length / maxPoints));
  const rows = d.dates
    .map((dt, t) => ({ dt, t }))
    .filter(({ t }) => t % step === 0 || t === d.dates.length - 1)
    .map(({ dt, t }) => Object.fromEntries([["x", dt], ...d.columns.map((c, j) => [`s${j}`, c[t]])]));
  return {
    type: "chart",
    title,
    panels: [...groups.entries()].map(([unit, js]) => ({ unit, series: js.map((j) => ({ key: `s${j}`, name: d.series[j].name })) })),
    rows,
    note: step > 1 ? `Se muestra 1 de cada ${step} observaciones; las tablas y exportaciones tienen todas.` : undefined,
  };
}

function dataTable(d: PreparedDataset, title: string, maxRows = 400): Block {
  const start = Math.max(0, d.dates.length - maxRows);
  return {
    type: "table",
    title,
    header: ["Fecha", ...d.series.map((s) => `${s.name} [${s.unit}]`)],
    rows: d.dates.slice(start).map((dt, i) => [dt, ...d.columns.map((c) => c[start + i])]).reverse(),
    note: start > 0 ? `Últimas ${maxRows} observaciones de ${d.dates.length}.` : undefined,
  };
}

function seriesSummary(d: PreparedDataset, j: number): string {
  const c = d.columns[j];
  const n = c.length;
  const s = d.series[j];
  let maxI = 0;
  let minI = 0;
  c.forEach((v, i) => {
    if (v > c[maxI]) maxI = i;
    if (v < c[minI]) minI = i;
  });
  return `${s.name} [${s.unit}] (${s.source} ${s.code ?? s.id}): ${n} obs. ${d.dates[0]}→${d.dates[n - 1]}; primero ${fmt(c[0])}, último ${fmt(c[n - 1])} (${d.dates[n - 1]}); máx ${fmt(c[maxI])} (${d.dates[maxI]}), mín ${fmt(c[minI])} (${d.dates[minI]}).`;
}

const ok = (summary: string, blocks: Block[], sources: SourceRef[], methodology: string[], warnings: string[] = []): ToolResult => ({
  ok: true,
  summary: warnings.length ? `${summary}\nADVERTENCIAS: ${warnings.join(" ")}` : summary,
  blocks: warnings.length ? [...blocks, { type: "notes", level: "warning", items: warnings }] : blocks,
  sources,
  methodology,
});

// ── Definiciones ────────────────────────────────────────────────────────────

const transformDoc = `Transformaciones: ${Object.entries(TRANSFORMS).map(([k, v]) => `${k} (${v.label})`).join("; ")}.`;

interface ToolDef<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  /** Esquema JSON para el modelo (formato OpenAI "function"). */
  parameters: Record<string, unknown>;
  schema: S;
  run: (args: z.infer<S>, client: DataClient) => Promise<ToolResult>;
}

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const arr = (description: string) => ({ type: "array", items: { type: "string" }, description });
const datesProps = { desde: str("Inicio AAAA-MM (opcional)"), hasta: str("Fin AAAA-MM (opcional)") };

function def<S extends z.ZodTypeAny>(t: ToolDef<S>): ToolDef<S> {
  return t;
}

export const TOOLS = [
  def({
    name: "buscar_series",
    description: "Busca series en el catálogo oficial (INDEC y BCRA, ~12.000 series) por palabras clave. Devuelve IDs, unidad, frecuencia y último dato. Usala antes de pedir datos si no conocés el ID.",
    parameters: { type: "object", properties: { consulta: str("Palabras clave, p. ej. 'reservas internacionales'"), fuente: str("INDEC o BCRA (opcional)", { enum: ["INDEC", "BCRA"] }), limite: { type: "integer", description: "1 a 15" } }, required: ["consulta"] },
    schema: z.object({ consulta: z.string().min(2).max(80), fuente: z.enum(["INDEC", "BCRA"]).optional(), limite: z.coerce.number().int().min(1).max(15).optional() }),
    async run(a, client) {
      const hits = await client.search(a.consulta, { source: a.fuente, limit: a.limite ?? 8 });
      if (!hits.length) return ok(`Sin resultados para "${a.consulta}".`, [{ type: "notes", level: "info", items: [`No hay series que coincidan con "${a.consulta}".`] }], [], []);
      return ok(
        hits.map((h) => `${h.id} | ${h.name} | ${h.source_id} ${h.source_code ?? ""} | ${h.unit} | ${FREQ_NAME[h.frequency]} | último ${h.last_date ?? "sin datos"}${h.update_status !== "ok" ? ` (${h.update_status})` : ""}`).join("\n"),
        [{ type: "table", title: `Series encontradas para "${a.consulta}"`, header: ["ID", "Serie", "Fuente", "Unidad", "Frecuencia", "Último dato"], rows: hits.map((h) => [h.id, h.name, `${h.source_id} ${h.source_code ?? ""}`, h.unit, FREQ_NAME[h.frequency], h.last_date]) }],
        [],
        ["Búsqueda en el catálogo de la plataforma (series del INDEC y del BCRA)."],
      );
    },
  }),
  def({
    name: "metadatos_serie",
    description: "Metadatos de series: nombre, fuente, código oficial, unidad, frecuencia, rango de fechas, último valor y estado de actualización.",
    parameters: { type: "object", properties: { ids: arr("IDs de series (máx. 6)") }, required: ["ids"] },
    schema: z.object({ ids: ids(1, 6) }),
    async run(a, client) {
      const res = await client.series(a.ids);
      const rows = res.series.map((s) => {
        const pts = s.points.filter((p) => p.v !== null);
        const last = pts.at(-1);
        return [s.meta.id, s.meta.name, `${s.meta.source_id} ${s.meta.source_code ?? "(calculada)"}`, s.meta.unit, FREQ_NAME[s.meta.frequency], pts[0]?.d ?? null, last?.d ?? null, last?.v ?? null, s.meta.update_status];
      });
      const sources: SourceRef[] = res.series.map((s) => ({ id: s.meta.id, name: s.meta.name, source: s.meta.source_id, code: s.meta.source_code, unit: s.meta.unit, frequency: s.meta.frequency, from: s.points[0]?.d ?? null, to: s.points.at(-1)?.d ?? null, kind: s.meta.value_kind }));
      return ok(
        rows.map((r) => r.map((v) => (typeof v === "number" ? fmt(v) : (v ?? "—"))).join(" | ")).join("\n") + (res.missing.length ? `\nNo existen: ${res.missing.join(", ")}` : ""),
        [{ type: "table", title: "Metadatos", header: ["ID", "Serie", "Fuente y código", "Unidad", "Frecuencia", "Desde", "Último dato", "Último valor", "Estado"], rows }],
        sources,
        ["Metadatos del catálogo de la plataforma."],
        res.missing.length ? [`No existen en el catálogo: ${res.missing.join(", ")}.`] : [],
      );
    },
  }),
  def({
    name: "obtener_datos",
    description: `Observaciones de 1 a 6 series en un período, con una transformación por serie (o una para todas) y frecuencia común. ${transformDoc}`,
    parameters: { type: "object", properties: { ids: arr("IDs de series"), ...datesProps, transformacion: str("Una transformación para todas (opcional)", { enum: Object.keys(TRANSFORMS) }), frecuencia: str("M, Q, A o D (opcional)", { enum: ["M", "Q", "A", "D"] }) }, required: ["ids"] },
    schema: z.object({ ids: ids(1, 6), desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional(), frecuencia: FREQ }),
    async run(a, client) {
      const L = await load(client, a.ids, { transform: a.transformacion, from: normFrom(a.desde), to: normTo(a.hasta), frequency: a.frecuencia });
      return ok(L.d.series.map((_, j) => seriesSummary(L.d, j)).join("\n"), [chartBlock(L.d, "Datos solicitados"), dataTable(L.d, "Observaciones")], L.sources, L.methodology, L.warnings);
    },
  }),
  def({
    name: "calcular",
    description:
      "Cálculos sobre una serie: 'variacion_entre_fechas' (acumulada con base 0 al inicio, promedio y anualizada; opcional base100 en un mes), 'mes_a_mes' (cada período con var. mensual, interanual y acumulada en el año), 'ranking' (períodos de mayor y menor variación interanual y mensual), 'estadisticas' (media, mediana, desvío, percentiles, extremos), 'cagr'.",
    parameters: { type: "object", properties: { id: str("ID de la serie"), operacion: str("Operación", { enum: ["variacion_entre_fechas", "mes_a_mes", "ranking", "estadisticas", "cagr"] }), ...datesProps, base100: str("Mes base 100 AAAA-MM (opcional)") }, required: ["id", "operacion"] },
    schema: z.object({ id: ID, operacion: z.enum(["variacion_entre_fechas", "mes_a_mes", "ranking", "estadisticas", "cagr"]), desde: DATE, hasta: DATE, base100: DATE }),
    async run(a, client) {
      const res = await client.series([a.id]);
      const s = res.series.find((x) => x.meta.id === a.id);
      if (!s || !s.points.length) throw new Error(`La serie ${a.id} no existe o no tiene datos.`);
      const m = s.meta;
      const src: SourceRef = { id: m.id, name: m.name, source: m.source_id, code: m.source_code, unit: m.unit, frequency: m.frequency, from: null, to: null, kind: m.value_kind };
      const last = s.points.filter((p) => p.v !== null).at(-1)!.d;
      if (a.operacion === "variacion_entre_fechas") {
        const from = normFrom(a.desde) ?? `${Number(last.slice(0, 4)) - 1}${last.slice(4, 7)}-01`;
        const to = normFrom(a.hasta) ?? last;
        const r = rangeChange(s.points, m.frequency, m.unit, m.name, from, to, { base100: normFrom(a.base100) });
        const u = r.mode === "rate" ? "pp" : "%";
        src.from = r.base?.d ?? r.from;
        src.to = r.to;
        return ok(
          `${m.name} (${m.source_id} ${m.source_code ?? m.id}): variación ${r.from}→${r.to} = ${fmt(r.accumulated)} ${u} en ${r.periods} períodos${r.base ? ` (base ${r.base.d} = ${fmt(r.base.v)})` : ""}; promedio por período ${fmt(r.averagePerPeriod)} %; anualizada ${fmt(r.annualized)} %.${r.missing.length ? ` Faltan datos: ${r.missing.join(", ")}.` : ""}`,
          [
            { type: "stats", items: [{ label: "Variación acumulada", value: `${fmt(r.accumulated)} ${u}`, note: `${r.from.slice(0, 7)} → ${r.to.slice(0, 7)}` }, { label: "Períodos", value: String(r.periods) }, { label: "Promedio por período", value: `${fmt(r.averagePerPeriod)} %` }, { label: "Equivalente anual", value: `${fmt(r.annualized)} %` }] },
            { type: "chart", title: "Variación acumulada (base 0 al inicio)", panels: [{ unit: u, series: [{ key: "c", name: "Acumulada" }, ...(r.base100 ? [] : [])] }], rows: r.rows.map((x) => ({ x: x.d, c: x.cumulative })) },
            { type: "table", title: "Por período", header: ["Período", "Valor", `Var. del período (${u})`, `Acumulada (${u})`, ...(r.base100 ? [`Índice (${r.base100.d.slice(0, 7)} = 100)`] : [])], rows: r.rows.map((x) => [x.d.slice(0, 7), x.value, x.change, x.cumulative, ...(r.base100 ? [x.index] : [])]) },
          ],
          [src],
          [r.mode === "level" ? `Acumulada = V(fin) / V(${r.base?.d.slice(0, 7)}) − 1 (base 0 al comienzo).` : r.mode === "compound" ? "Tasas mensuales compuestas: Π(1 + r) − 1." : "Cambio en puntos porcentuales.", "Promedio: media geométrica. Anualizada: (1 + acumulada)^(períodos por año / períodos) − 1."],
          r.missing.length ? [`Períodos sin dato (no se completan): ${r.missing.join(", ")}.`] : [],
        );
      }
      if (a.operacion === "ranking") {
        const b = periodBreakdown(s.points, m.frequency, m.unit, m.name);
        const from = normFrom(a.desde);
        const to = normTo(a.hasta);
        const rows = b.rows.filter((r) => (!from || r.d >= from) && (!to || r.d <= to));
        const u = b.kind === "rate" ? "pp" : "%";
        const top = (key: "yoy" | "prev", dir: 1 | -1) => rows.filter((r) => r[key] !== null).sort((x, y) => dir * ((y[key] as number) - (x[key] as number))).slice(0, 8);
        const hiY = top("yoy", 1);
        const hiM = top("prev", 1);
        const loY = top("yoy", -1);
        src.from = rows.at(-1)?.d ?? null;
        src.to = rows[0]?.d ?? null;
        return ok(
          `${m.name}: mayores variaciones interanuales: ${hiY.map((r) => `${r.d.slice(0, 7)} ${fmt(r.yoy, 1)} ${u}`).join(", ")}. Mayores variaciones contra el período anterior: ${hiM.map((r) => `${r.d.slice(0, 7)} ${fmt(r.prev, 1)} ${u}`).join(", ")}. Menores interanuales: ${loY.map((r) => `${r.d.slice(0, 7)} ${fmt(r.yoy, 1)} ${u}`).join(", ")}.`,
          [
            { type: "table", title: `Mayores variaciones interanuales (${u})`, header: ["Período", "Valor", `Var. interanual (${u})`, `Var. período (${u})`], rows: hiY.map((r) => [r.d.slice(0, 7), r.value, r.yoy, r.prev]) },
            { type: "table", title: `Mayores variaciones contra el período anterior (${u})`, header: ["Período", "Valor", `Var. período (${u})`, `Var. interanual (${u})`], rows: hiM.map((r) => [r.d.slice(0, 7), r.value, r.prev, r.yoy]) },
            { type: "chart", title: `${m.name}: variación interanual (${u})`, panels: [{ unit: u, series: [{ key: "y", name: "Var. interanual" }] }], rows: [...rows].reverse().map((r) => ({ x: r.d, y: r.yoy })) },
          ],
          [src],
          [b.aggregation ? `Serie diaria resumida por mes (${b.aggregation === "avg" ? "promedio" : b.aggregation === "last" ? "cierre" : "suma"}).` : "Valores publicados por período.", "Ranking de variaciones nominales sobre los valores publicados (sin deflactar)."],
        );
      }
      if (a.operacion === "mes_a_mes") {
        const b = periodBreakdown(s.points, m.frequency, m.unit, m.name);
        const from = normFrom(a.desde);
        const to = normTo(a.hasta);
        const rows = b.rows.filter((r) => (!from || r.d >= from) && (!to || r.d <= to)).slice(0, 60);
        const u = b.kind === "rate" ? "pp" : "%";
        src.from = rows.at(-1)?.d ?? null;
        src.to = rows[0]?.d ?? null;
        return ok(
          rows.slice(0, 18).map((r) => `${r.d.slice(0, 7)}: ${fmt(r.value)} | var ${fmt(r.prev, 1)} ${u} | i.a. ${fmt(r.yoy, 1)} ${u}${r.ytd !== null ? ` | acum. año ${fmt(r.ytd, 1)} %` : ""}`).join("\n"),
          [{ type: "table", title: `${m.name}: período a período`, header: ["Período", "Valor", `Var. período (${u})`, `Var. interanual (${u})`, "Acum. en el año (%)"], rows: rows.map((r) => [r.d.slice(0, 7), r.value, r.prev, r.yoy, r.ytd]) }],
          [src],
          [b.aggregation ? `Serie diaria resumida por mes (${b.aggregation === "avg" ? "promedio" : b.aggregation === "last" ? "cierre" : "suma"}).` : "Valores publicados por período.", "Si falta el período de comparación, la variación queda vacía."],
        );
      }
      const from = normFrom(a.desde);
      const to = normTo(a.hasta);
      const pts = s.points.filter((p) => p.v !== null && (!from || p.d >= from) && (!to || p.d <= to));
      src.from = pts[0]?.d ?? null;
      src.to = pts.at(-1)?.d ?? null;
      if (a.operacion === "cagr") {
        const c = cagr(pts);
        return ok(`${m.name}: CAGR ${fmt(c.cagr)} % anual entre ${c.from.d} (${fmt(c.from.v)}) y ${c.to.d} (${fmt(c.to.v)}), ${fmt(c.years, 1)} años; crecimiento total ${fmt(c.total)} %.`, [{ type: "stats", items: [{ label: "CAGR", value: `${fmt(c.cagr)} % anual` }, { label: "Crecimiento total", value: `${fmt(c.total)} %` }, { label: "Años", value: fmt(c.years, 1) }] }], [src], ["CAGR = (V_fin / V_ini)^(1/años) − 1; años = días / 365,25."]);
      }
      const dsc = describe(pts);
      return ok(
        `${m.name} [${m.unit}] ${dsc.from}→${dsc.to}, n=${dsc.n}: media ${fmt(dsc.mean)}, mediana ${fmt(dsc.median)}, desvío ${fmt(dsc.std)}, mín ${fmt(dsc.min?.v)} (${dsc.min?.d}), máx ${fmt(dsc.max?.v)} (${dsc.max?.d}), p5 ${fmt(dsc.percentiles.p5)}, p95 ${fmt(dsc.percentiles.p95)}.`,
        [{ type: "stats", items: [{ label: "Media", value: fmt(dsc.mean) }, { label: "Mediana", value: fmt(dsc.median) }, { label: "Desvío", value: fmt(dsc.std) }, { label: "Mínimo", value: fmt(dsc.min?.v), note: dsc.min?.d }, { label: "Máximo", value: fmt(dsc.max?.v), note: dsc.max?.d }, { label: "Observaciones", value: String(dsc.n) }] }],
        [src],
        ["Estadísticas sobre los valores publicados en el período (varianza muestral n − 1)."],
      );
    },
  }),
  def({
    name: "comparar",
    description: "Compara 2 a 6 series en un período con una transformación común (base100 por defecto; también real, variacion_interanual, variacion_mensual). Devuelve gráfico, variación de cada serie en el período y tabla.",
    parameters: { type: "object", properties: { ids: arr("IDs de series"), ...datesProps, transformacion: str("base100, real, variacion_interanual, variacion_mensual, real_variacion_interanual o nivel", { enum: Object.keys(TRANSFORMS) }) }, required: ["ids"] },
    schema: z.object({ ids: ids(2, 6), desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional() }),
    async run(a, client) {
      const tr = a.transformacion ?? "base100";
      const L = await load(client, a.ids, { transform: tr, from: normFrom(a.desde), to: normTo(a.hasta) });
      // Variación de cada serie en el período, sobre los valores transformados (base100/real) o nivel promedio (tasas).
      const items = L.d.series.map((s, j) => {
        const c = L.d.columns[j];
        const isRate = tr.startsWith("variacion") || tr === "real_variacion_interanual";
        return { label: s.name, value: isRate ? `${fmt(c.reduce((x, y) => x + y, 0) / c.length)} % prom.` : `${fmt((c[c.length - 1] / c[0] - 1) * 100)} %`, note: isRate ? "Promedio del período" : `${L.d.dates[0]} → ${L.d.dates[L.d.dates.length - 1]}` };
      });
      return ok(
        `Comparación (${TRANSFORMS[tr].label}), ${L.d.dates[0]}→${L.d.dates[L.d.dates.length - 1]}: ${items.map((i) => `${i.label}: ${i.value}`).join("; ")}.\n${L.d.series.map((_, j) => seriesSummary(L.d, j)).join("\n")}`,
        [{ type: "stats", items }, chartBlock(L.d, `Comparación: ${TRANSFORMS[tr].label}`), dataTable(L.d, "Datos de la comparación")],
        L.sources,
        L.methodology,
        L.warnings,
      );
    },
  }),
  def({
    name: "correlacion",
    description: "Correlaciones (Pearson o Spearman) entre 2 a 6 series transformadas (por defecto variación mensual, para evitar correlaciones espurias por tendencia), con p-valores y correlaciones con rezagos entre la primera y la segunda serie.",
    parameters: { type: "object", properties: { ids: arr("IDs de series"), ...datesProps, transformacion: str("Por defecto variacion_mensual", { enum: Object.keys(TRANSFORMS) }), metodo: str("pearson o spearman", { enum: ["pearson", "spearman"] }), rezagos: { type: "integer", description: "Rezagos máximos ± (0 a 24)" } }, required: ["ids"] },
    schema: z.object({ ids: ids(2, 6), desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional(), metodo: z.enum(["pearson", "spearman"]).optional(), rezagos: z.coerce.number().int().min(0).max(24).optional() }),
    async run(a, client) {
      const L = await load(client, a.ids, { transform: a.transformacion ?? "variacion_mensual", from: normFrom(a.desde), to: normTo(a.hasta) });
      const method = a.metodo ?? "pearson";
      const names = L.d.series.map((s) => s.name);
      const M = correlationMatrix(L.d.columns, names, method);
      const lag = laggedCorrelations(L.d.columns[0], L.d.columns[1], a.rezagos ?? 12, method);
      const best = lag.reduce((m, l) => (Math.abs(l.r) > Math.abs(m.r) ? l : m), lag[0]);
      const pairs = names.flatMap((n1, i) => names.slice(i + 1).map((n2, k) => ({ n1, n2, r: M.r[i][i + 1 + k], p: M.p[i][i + 1 + k] })));
      const warnings = ["Correlación no implica causalidad.", ...L.warnings];
      if (M.n < 30) warnings.push(`Muestra corta (${M.n} observaciones).`);
      return ok(
        `Correlación ${method}, n=${M.n}, ${L.d.dates[0]}→${L.d.dates[L.d.dates.length - 1]}, sobre ${L.d.series.map((s) => s.recipe).join(" / ")}:\n${pairs.map((p) => `${p.n1} × ${p.n2}: r=${fmt(p.r, 3)} (p=${fmt(p.p, 4)})`).join("\n")}\nRezagos (${names[0]} adelanta a ${names[1]} con k>0): máximo |r| en k=${best?.lag} (r=${fmt(best?.r, 3)}, p=${fmt(best?.p, 4)}, n=${best?.n}).`,
        [
          { type: "table", title: `Correlaciones (${method})`, header: ["Par", "r", "p-valor", "n"], rows: pairs.map((p) => [`${p.n1} × ${p.n2}`, p.r, p.p, M.n]) },
          { type: "chart", title: `Correlación con rezagos: ${names[0]} (t−k) vs. ${names[1]} (t)`, panels: [{ unit: "r", series: [{ key: "r", name: "Correlación" }] }], rows: lag.map((l) => ({ x: String(l.lag), r: l.r })) },
        ],
        L.sources,
        [...L.methodology, `Correlación de ${method === "pearson" ? "Pearson" : "Spearman"}; p-valor con t de Student (n − 2 g.l.). Rezago k > 0: la primera serie adelanta a la segunda.`],
        warnings,
      );
    },
  }),
  def({
    name: "regresion",
    description: "Regresión lineal MCO de una dependiente sobre 1 a 5 explicativas (opcionalmente rezagadas), con errores Newey-West, R², p-valores y diagnósticos. Por defecto en variación mensual.",
    parameters: { type: "object", properties: { dependiente: str("ID de la dependiente"), explicativas: arr("IDs de las explicativas"), ...datesProps, transformacion: str("Por defecto variacion_mensual", { enum: Object.keys(TRANSFORMS) }), rezagos: { type: "array", items: { type: "integer" }, description: "Rezagos de las explicativas, p. ej. [0,1,2]" } }, required: ["dependiente", "explicativas"] },
    schema: z.object({ dependiente: ID, explicativas: ids(1, 5), desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional(), rezagos: z.array(z.coerce.number().int().min(0).max(12)).max(6).optional() }),
    async run(a, client) {
      const all = [a.dependiente, ...a.explicativas.filter((x) => x !== a.dependiente)];
      const L = await load(client, all, { transform: a.transformacion ?? "variacion_mensual", from: normFrom(a.desde), to: normTo(a.hasta) });
      const lags = a.rezagos?.length ? a.rezagos : [0];
      const design = buildDesign(L.d.dates, L.d.columns, 0, L.d.series[0].name, L.d.series.slice(1).map((s, i) => ({ column: i + 1, name: s.name, lags })));
      const r = ols(design.y, design.x, design.names, { covType: "HAC" });
      const warnings = ["Los coeficientes son asociaciones condicionales en la muestra, no efectos causales.", ...L.warnings];
      if (r.diagnostics.durbinWatson < 1.5) warnings.push(`Durbin-Watson ${fmt(r.diagnostics.durbinWatson)}: residuos autocorrelacionados (se usan errores Newey-West).`);
      return ok(
        `MCO: ${L.d.series[0].name} sobre ${design.names.join(", ")}; n=${r.n}, R²=${fmt(r.r2, 3)}, R² aj.=${fmt(r.adjR2, 3)}; ${design.dates[0]}→${design.dates[design.dates.length - 1]}.\n${r.coefficients.map((c) => `${c.name}: β=${fmt(c.coef, 4)} (e.e. ${fmt(c.se, 4)}, p=${fmt(c.p, 4)}, IC95 [${fmt(c.ciLow, 4)}; ${fmt(c.ciHigh, 4)}])`).join("\n")}`,
        [
          { type: "stats", items: [{ label: "R²", value: fmt(r.r2, 3) }, { label: "R² ajustado", value: fmt(r.adjR2, 3) }, { label: "Observaciones", value: String(r.n) }, { label: "Durbin-Watson", value: fmt(r.diagnostics.durbinWatson) }] },
          { type: "table", title: "Coeficientes (errores Newey-West)", header: ["Variable", "Coeficiente", "Error estándar", "t", "p-valor", "IC 95 % inf.", "IC 95 % sup."], rows: r.coefficients.map((c) => [c.name, c.coef, c.se, c.t, c.p, c.ciLow, c.ciHigh]) },
          { type: "chart", title: "Observado vs. ajustado", panels: [{ unit: L.d.series[0].unit, series: [{ key: "y", name: "Observado" }, { key: "f", name: "Ajustado" }] }], rows: design.dates.map((d, i) => ({ x: d, y: design.y[i], f: r.fitted[i] })) },
        ],
        L.sources,
        [...L.methodology, `MCO con constante; errores HAC Newey-West (${r.hacLags} rezagos). Rezagos de explicativas: ${lags.join(", ")}.`],
        warnings,
      );
    },
  }),
  def({
    name: "rezagos",
    description: "Analiza adelantos y rezagos entre dos series: correlaciones cruzadas y prueba de causalidad de Granger (capacidad predictiva, no causalidad económica).",
    parameters: { type: "object", properties: { x: str("ID de la serie que podría adelantar"), y: str("ID de la serie objetivo"), ...datesProps, transformacion: str("Por defecto variacion_mensual", { enum: Object.keys(TRANSFORMS) }), max_rezago: { type: "integer", description: "1 a 12" } }, required: ["x", "y"] },
    schema: z.object({ x: ID, y: ID, desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional(), max_rezago: z.coerce.number().int().min(1).max(12).optional() }),
    async run(a, client) {
      const L = await load(client, [a.x, a.y], { transform: a.transformacion ?? "variacion_mensual", from: normFrom(a.desde), to: normTo(a.hasta) });
      const K = a.max_rezago ?? 6;
      const lag = laggedCorrelations(L.d.columns[0], L.d.columns[1], K);
      const data = L.d.dates.map((_, t) => [L.d.columns[0][t], L.d.columns[1][t]]);
      const names = L.d.series.map((s) => s.name);
      const p = selectVarOrder(data, names, Math.min(K, 6)).selected.aic;
      const g1 = grangerTest(data, names, p, 0, 1);
      const g2 = grangerTest(data, names, p, 1, 0);
      return ok(
        `Rezagos entre ${names[0]} y ${names[1]} (${L.d.dates[0]}→${L.d.dates[L.d.dates.length - 1]}): ${lag.filter((l) => l.lag >= 0).map((l) => `k=${l.lag}: r=${fmt(l.r, 3)}`).join(", ")}. Granger (VAR(${p}) por AIC): ${names[0]}→${names[1]} F=${fmt(g1.f, 2)} p=${fmt(g1.p, 4)}; ${names[1]}→${names[0]} F=${fmt(g2.f, 2)} p=${fmt(g2.p, 4)}.`,
        [
          { type: "chart", title: `Correlación cruzada: ${names[0]} (t−k) vs. ${names[1]} (t)`, panels: [{ unit: "r", series: [{ key: "r", name: "Correlación" }] }], rows: lag.map((l) => ({ x: String(l.lag), r: l.r })) },
          { type: "table", title: "Causalidad de Granger", header: ["H0: no predice", "F", "g.l.", "p-valor"], rows: [[`${g1.causing} → ${g1.caused}`, g1.f, `${g1.df1}, ${g1.df2}`, g1.p], [`${g2.causing} → ${g2.caused}`, g2.f, `${g2.df1}, ${g2.df2}`, g2.p]] },
        ],
        L.sources,
        [...L.methodology, `Granger: prueba F de exclusión de rezagos en un VAR(${p}) elegido por AIC. Indica capacidad predictiva, no causalidad económica.`],
        ["Granger mide precedencia temporal y capacidad predictiva, no causalidad económica.", ...L.warnings],
      );
    },
  }),
  def({
    name: "analisis_econometrico",
    description: "Análisis econométrico completo de 2 a 4 series: estacionariedad (ADF y KPSS), transformación adecuada, correlación, VAR con selección de rezagos, causalidad de Granger y, si todas son I(1), cointegración de Johansen.",
    parameters: { type: "object", properties: { ids: arr("IDs de series (2 a 4)"), ...datesProps }, required: ["ids"] },
    schema: z.object({ ids: ids(2, 4), desde: DATE, hasta: DATE }),
    async run(a, client) {
      const lv = await load(client, a.ids, { transform: "log", from: normFrom(a.desde), to: normTo(a.hasta) });
      const names = lv.d.series.map((s) => s.name);
      const st = lv.d.columns.map((c) => ({ lv: stationarity(c, "c"), df: stationarity(c.slice(1).map((v, i) => v - c[i]), "c") }));
      const i1 = st.every((x) => x.lv.adf.p >= 0.05 && x.df.verdict !== "unit_root");
      const rows: (string | number | null)[][] = st.map((x, j) => [names[j], x.lv.adf.stat, x.lv.adf.p, x.lv.kpss.stat, x.df.adf.p, x.lv.adf.p >= 0.05 && x.df.verdict !== "unit_root" ? "I(1)" : x.lv.adf.p < 0.05 ? "I(0)" : "No concluyente"]);
      // Modelo en diferencias logarítmicas (estacionarias)
      const dd = lv.d.dates.slice(1);
      const dl = lv.d.columns.map((c) => c.slice(1).map((v, i) => (v - c[i]) * 100));
      const data = dd.map((_, t) => dl.map((c) => c[t]));
      const p = selectVarOrder(data, names, 6).selected.aic;
      const gr = names.flatMap((_, i) => names.map((__, j) => (i !== j ? grangerTest(data, names, p, i, j) : null))).filter((g): g is NonNullable<typeof g> => g !== null);
      const M = correlationMatrix(dl, names);
      let coint = "";
      const blocks: Block[] = [
        { type: "table", title: "Estacionariedad (logaritmos)", header: ["Serie", "ADF niveles", "p ADF", "KPSS niveles", "p ADF diferencias", "Orden"], rows },
        { type: "table", title: `Causalidad de Granger en VAR(${p}) de dif. logarítmicas`, header: ["H0: no predice", "F", "p-valor"], rows: gr.map((g) => [`${g.causing} → ${g.caused}`, g.f, g.p]) },
        { type: "table", title: "Correlación de dif. logarítmicas", header: ["Par", "r", "p-valor"], rows: names.flatMap((n1, i) => names.slice(i + 1).map((n2, k) => [`${n1} × ${n2}`, M.r[i][i + 1 + k], M.p[i][i + 1 + k]])) },
      ];
      if (i1) {
        try {
          const j = johansen(lv.d.dates.map((_, t) => lv.d.columns.map((c) => c[t])), 0, Math.max(1, p));
          coint = ` Johansen (k=${Math.max(1, p)}): rango ${j.rank} (traza r≤0 = ${fmt(j.trace[0], 2)} vs. crítico 5 % ${fmt(j.traceCrit[0][1], 2)}).`;
          blocks.push({ type: "table", title: "Cointegración de Johansen", header: ["H0: rango ≤", "Traza", "Crítico 5 %", "Máx. autovalor", "Crítico 5 %"], rows: j.trace.map((t, i) => [`r ≤ ${i}`, t, j.traceCrit[i][1], j.maxEig[i], j.maxEigCrit[i][1]]) });
        } catch (e) {
          coint = ` Johansen no se pudo calcular: ${(e as Error).message}`;
        }
      } else coint = " No todas las series son I(1): no corresponde la prueba de cointegración de Johansen.";
      return ok(
        `Análisis econométrico ${lv.d.dates[0]}→${lv.d.dates[lv.d.dates.length - 1]} (n=${lv.d.dates.length}).\nEstacionariedad: ${rows.map((r) => `${r[0]}: ${r[5]} (ADF p niveles=${fmt(r[2] as number, 3)})`).join("; ")}.\nVAR(${p}) en dif. log.: ${gr.map((g) => `${g.causing}→${g.caused} p=${fmt(g.p, 4)}`).join("; ")}.${coint}`,
        blocks,
        lv.sources,
        [...lv.methodology, "Estacionariedad: ADF (H0 raíz unitaria, rezagos por AIC) y KPSS (H0 estacionariedad). VAR en diferencias logarítmicas ×100, rezagos por AIC (máx. 6). Granger: prueba F. Johansen con constante si todas son I(1)."],
        ["Resultados estadísticos de forma reducida: no identifican causalidad económica.", ...lv.warnings],
      );
    },
  }),
  def({
    name: "proyeccion",
    description: "Proyección estadística de una serie con bandas de incertidumbre (80 % y 95 %). Métodos: auto_arima (por defecto), drift, naive, mean. No es una predicción cierta.",
    parameters: { type: "object", properties: { id: str("ID de la serie"), horizonte: { type: "integer", description: "Períodos a proyectar (1 a 36)" }, metodo: str("auto_arima, drift, naive o mean", { enum: ["auto_arima", "drift", "naive", "mean"] }), transformacion: str("Por defecto la natural de la serie", { enum: Object.keys(TRANSFORMS) }), desde: str("Inicio de la estimación AAAA-MM (opcional)") }, required: ["id"] },
    schema: z.object({ id: ID, horizonte: z.coerce.number().int().min(1).max(36).optional(), metodo: z.enum(["auto_arima", "drift", "naive", "mean"]).optional(), transformacion: TRANSFORM.optional(), desde: DATE }),
    async run(a, client) {
      const L = await load(client, [a.id], { transform: a.transformacion, from: normFrom(a.desde) ?? undefined });
      const y = L.d.columns[0];
      const method: ForecastMethod = a.metodo ?? "auto_arima";
      const h = a.horizonte ?? 12;
      const log = L.d.series[0].isLevel && y.every((v) => v > 0);
      const f = runForecast(L.d.dates, y, L.d.frequency, { method, horizon: h, log });
      const b95 = (i: number) => f.points[i].bands.find((b) => b.level === 0.95)!;
      const last = f.points[h - 1];
      return ok(
        `Proyección ${METHOD_LABEL[method]}${log ? " en logaritmos" : ""} de ${L.d.series[0].name} [${L.d.series[0].unit}], estimada ${f.estimation.from}→${f.estimation.to} (n=${f.estimation.n}). Último observado ${fmt(y[y.length - 1])} (${L.d.dates[L.d.dates.length - 1]}). Proyección central a ${h} períodos (${last.d}): ${fmt(last.mean)}, banda 95 % [${fmt(b95(h - 1).lower)}; ${fmt(b95(h - 1).upper)}]. ${f.details.map((d) => `${d.name}: ${d.value}`).join("; ")}.`,
        [
          { type: "chart", title: `Proyección de ${L.d.series[0].name} (bandas 80 % y 95 %)`, panels: [{ unit: L.d.series[0].unit, series: [{ key: "y", name: "Observado" }, { key: "f", name: "Proyección central" }, { key: "lo95", name: "95 % inferior" }, { key: "hi95", name: "95 % superior" }] }], rows: [...L.d.dates.slice(-48).map((d, i, arr) => ({ x: d, y: y[y.length - arr.length + i] })), ...f.points.map((p, i) => ({ x: p.d, f: p.mean, lo95: b95(i).lower, hi95: b95(i).upper }))] },
          { type: "table", title: "Proyección", header: ["Período", "Central", "80 % inf.", "80 % sup.", "95 % inf.", "95 % sup."], rows: f.points.map((p) => [p.d, p.mean, p.bands[0].lower, p.bands[0].upper, p.bands[1].lower, p.bands[1].upper]) },
        ],
        L.sources,
        [...L.methodology, `Método: ${f.label}${log ? " en logaritmos (la central es la mediana)" : ""}.`, ...f.details.map((d) => `${d.name}: ${d.value}`)],
        f.warnings,
      );
    },
  }),
  def({
    name: "grafico",
    description: `Construye un gráfico con 1 a 6 series en un período (paneles separados si las unidades difieren; nunca doble eje). ${transformDoc} La inflación se grafica como variación mensual del IPC salvo otra indicación.`,
    parameters: { type: "object", properties: { ids: arr("IDs de series"), ...datesProps, transformacion: str("Una transformación para todas (opcional)", { enum: Object.keys(TRANSFORMS) }), frecuencia: str("M (por defecto), Q, A o D (solo series diarias)", { enum: ["M", "Q", "A", "D"] }), titulo: str("Título (opcional)") }, required: ["ids"] },
    schema: z.object({ ids: ids(1, 6), desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional(), frecuencia: FREQ, titulo: z.string().max(120).optional() }),
    async run(a, client) {
      const L = await load(client, a.ids, { transform: a.transformacion, from: normFrom(a.desde), to: normTo(a.hasta), frequency: a.frecuencia });
      const title = a.titulo ?? L.d.series.map((s) => s.name).join(", ");
      return ok(`Gráfico "${title}" (${L.d.dates[0]}→${L.d.dates[L.d.dates.length - 1]}):\n${L.d.series.map((_, j) => seriesSummary(L.d, j)).join("\n")}`, [chartBlock(L.d, title), dataTable(L.d, "Datos del gráfico")], L.sources, L.methodology, L.warnings);
    },
  }),
  def({
    name: "anomalias",
    description: "Detecta variaciones inusuales, valores extremos, aceleraciones, desaceleraciones y cambios de tendencia en 1 a 4 series (sobre su variación mensual por defecto), y cambios de correlación o divergencias entre la primera y la segunda. Cada alerta indica su criterio estadístico.",
    parameters: { type: "object", properties: { ids: arr("IDs de series (1 a 4)"), ...datesProps, transformacion: str("Por defecto variacion_mensual", { enum: Object.keys(TRANSFORMS) }) }, required: ["ids"] },
    schema: z.object({ ids: ids(1, 4), desde: DATE, hasta: DATE, transformacion: TRANSFORM.optional() }),
    async run(a, client) {
      const L = await load(client, a.ids, { transform: a.transformacion ?? "variacion_mensual", from: normFrom(a.desde), to: normTo(a.hasta) });
      const found = L.d.series.flatMap((s, j) => detectAnomalies(L.d.dates, L.d.columns[j], { unit: s.unit.includes("%") ? "%" : s.unit, name: s.name }).map((x) => ({ ...x, serie: s.name })));
      if (L.d.columns.length > 1) found.push(...detectCorrelationChange(L.d.dates, L.d.columns[0], L.d.columns[1], [L.d.series[0].name, L.d.series[1].name]).map((x) => ({ ...x, serie: `${L.d.series[0].name} / ${L.d.series[1].name}` })));
      const summary = found.length
        ? found.map((f) => `${f.serie} — ${ANOMALY_LABEL[f.kind]} (${f.d}): ${f.message} Criterio: ${f.criterion}`).join("\n")
        : `Sin anomalías según los criterios (z robusto > 3,5; extremos; aceleración |t| > 2; cambio de tendencia; Fisher p < 0,05) en ${L.d.dates[0]}→${L.d.dates[L.d.dates.length - 1]}.`;
      return ok(
        summary,
        [
          found.length
            ? { type: "table", title: "Alertas detectadas", header: ["Serie", "Tipo", "Fecha", "Descripción", "Criterio estadístico"], rows: found.map((f) => [f.serie, ANOMALY_LABEL[f.kind], f.d, f.message, f.criterion]) }
            : { type: "notes", level: "info", items: [summary] },
          chartBlock(L.d, "Series analizadas"),
        ],
        L.sources,
        [
          ...L.methodology,
          "Variación inusual: z robusto 0,6745·(x − mediana)/MAD > 3,5 en los últimos 12 períodos. Extremo: último dato fuera del rango histórico. Aceleración/desaceleración: media de 3 períodos vs. 12 previos, |t| > 2. Cambio de tendencia: pendiente de 6 períodos con signo opuesto a la de los 6 previos. Cambio de correlación: z de Fisher, p < 0,05 (ventana de 24 períodos).",
        ],
        ["Las alertas son señales estadísticas para investigar, no conclusiones sobre sus causas.", ...L.warnings],
      );
    },
  }),
  def({
    name: "analisis_guardados",
    description: "Lista los análisis guardados del espacio de trabajo del usuario (título, tipo, series).",
    parameters: { type: "object", properties: {} },
    schema: z.object({}),
    async run(_a, client) {
      const list = await client.savedAnalyses();
      return ok(
        list.length ? list.map((x) => `${x.title} (${x.kind}): ${x.indicator_ids.join(", ")}`).join("\n") : "No hay análisis guardados.",
        [{ type: "table", title: "Análisis guardados", header: ["Título", "Tipo", "Series", "Actualizado"], rows: list.map((x) => [x.title, x.kind, x.indicator_ids.join(", "), x.updated_at.slice(0, 10)]) }],
        [],
        ["Análisis guardados en este navegador (espacio de trabajo)."],
      );
    },
  }),
];

export type ToolName = (typeof TOOLS)[number]["name"];
export const TOOL_NAMES = TOOLS.map((t) => t.name);

/** Definiciones en formato OpenAI (también las acepta Ollama). */
export const TOOL_SPECS = TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));

/**
 * Ejecuta una herramienta con validación estricta de parámetros. Los errores
 * se devuelven como resultado (para que el modelo pueda corregir), nunca se
 * ejecuta algo fuera de esta lista.
 */
export async function runTool(name: string, rawArgs: unknown, client: DataClient): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, summary: `Herramienta desconocida: ${name}. Disponibles: ${TOOL_NAMES.join(", ")}.`, blocks: [], sources: [], methodology: [], error: "unknown_tool" };
  const parsed = (tool.schema as z.ZodTypeAny).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "parámetros"}: ${i.message}`).join("; ");
    return { ok: false, summary: `Parámetros inválidos para ${name}: ${msg}`, blocks: [], sources: [], methodology: [], error: msg };
  }
  try {
    return await (tool.run as (a: unknown, c: DataClient) => Promise<ToolResult>)(parsed.data, client);
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, summary: `Error en ${name}: ${msg}`, blocks: [{ type: "notes", level: "warning", items: [msg] }], sources: [], methodology: [], error: msg };
  }
}
