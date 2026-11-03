import { describe, expect, it } from "vitest";
import { runAiTool, AI_TOOL_NAMES } from "@/lib/ai/registry";
import { runTool } from "@/lib/ai/tools";
import { detectAnomalies } from "@/lib/ai/anomalies";
import { findConcepts, parsePeriod } from "@/lib/ai/vocabulary";
import { buildReport } from "@/lib/ai/reports";
import { AI_SERIES, testClient } from "./helpers/ai-data";

const ipc = AI_SERIES[0].points;
const v = new Map(ipc.map((p) => [p.d, p.v!]));

describe("vocabulario y períodos", () => {
  it("identifica las series de las consultas de ejemplo", () => {
    const ids = (q: string) => findConcepts(q).map((c) => c.id);
    expect(ids("Analizá la evolución de las reservas internacionales durante los últimos 24 meses.")).toEqual(["bcra.reservas"]);
    expect(ids("Compará M2 con el IPC y calculá su variación real.")).toEqual(["bcra.m2", "indec.ipc_nivel_general"]);
    expect(ids("¿Qué relación existe entre las tasas de interés y la inflación?")).toEqual(["bcra.badlar", "indec.ipc_nivel_general"]);
    expect(ids("Analizá la evolución del salario real desde 2020.")).toEqual(["calc.salarios_reales"]);
    expect(ids("Compará el EMAE con los préstamos al sector privado.")).toEqual(["indec.emae_desest", "bcra.prestamos_privados"]);
    expect(ids("Construí un gráfico con inflación, tipo de cambio y reservas.")).toEqual(["indec.ipc_nivel_general", "bcra.tc_mayorista", "bcra.reservas"]);
    expect(ids("Graficá reservas, base monetaria e inflación entre 2020 y 2025.")).toEqual(["bcra.reservas", "bcra.base_monetaria", "indec.ipc_nivel_general"]);
    expect(ids("Realizá un análisis econométrico de la relación entre agregados monetarios e inflación.")).toEqual(["bcra.m2", "indec.ipc_nivel_general"]);
  });
  it("entiende períodos", () => {
    expect(parsePeriod("últimos 24 meses", "2026-10-15")).toMatchObject({ from: "2024-11-01" });
    expect(parsePeriod("desde 2020", "2026-10-15")).toMatchObject({ from: "2020-01-01" });
    expect(parsePeriod("entre 2020 y 2025", "2026-10-15")).toMatchObject({ from: "2020-01-01", to: "2025-12-01" });
    expect(parsePeriod("desde el 1 de septiembre de 2024", "2026-10-15")).toMatchObject({ from: "2024-09-01" });
    expect(parsePeriod("en 2023", "2026-10-15")).toMatchObject({ from: "2023-01-01", to: "2023-12-01" });
    expect(parsePeriod("sin fecha", "2026-10-15").from).toBeUndefined();
  });
});

describe("herramientas", () => {
  const client = testClient();
  it("lista completa y validación estricta de parámetros", async () => {
    expect(AI_TOOL_NAMES).toEqual(expect.arrayContaining(["buscar_series", "metadatos_serie", "obtener_datos", "calcular", "comparar", "correlacion", "regresion", "rezagos", "analisis_econometrico", "proyeccion", "grafico", "anomalias", "analisis_guardados", "informe"]));
    const bad = await runTool("obtener_datos", { ids: ["DROP TABLE observations;"] }, client);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toMatch(/inválido/);
    expect((await runTool("sql", { q: "select 1" }, client)).summary).toMatch(/desconocida/);
    expect((await runTool("obtener_datos", { ids: [] }, client)).ok).toBe(false);
  });
  it("calcula la inflación acumulada con datos reales y cita la fuente", async () => {
    const r = await runTool("calcular", { id: "indec.ipc_nivel_general", operacion: "variacion_entre_fechas", desde: "2024-09", hasta: "2026-01" }, client);
    expect(r.ok).toBe(true);
    const expected = (v.get("2026-01-01")! / v.get("2024-08-01")! - 1) * 100;
    expect(r.summary).toContain(expected.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(r.sources[0]).toMatchObject({ id: "indec.ipc_nivel_general", source: "INDEC", code: "148.3_INIVELNAL_DICI_M_26" });
    expect(r.methodology.join(" ")).toMatch(/base 0/);
  });
  it("las series diarias se llevan a mensual y se informa la diferencia de frecuencia", async () => {
    const r = await runTool("grafico", { ids: ["bcra.reservas", "bcra.base_monetaria", "indec.ipc_nivel_general"], desde: "2020", hasta: "2025" }, client);
    expect(r.ok).toBe(true);
    const chart = r.blocks.find((b) => b.type === "chart");
    expect(chart && chart.type === "chart" && chart.panels.length).toBe(3); // tres unidades distintas, sin doble eje
    expect(r.summary).toMatch(/frecuencias distintas/);
    expect(r.sources.map((s) => s.frequency)).toEqual(["D", "D", "M"]);
    expect(r.sources[0].from! >= "2020-01-01" && r.sources[0].to! <= "2025-12-31").toBe(true);
  });
  it("correlación sobre variaciones, con advertencia de causalidad", async () => {
    const r = await runTool("correlacion", { ids: ["bcra.badlar", "indec.ipc_nivel_general"], rezagos: 6 }, client);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/r=/);
    expect(r.blocks.some((b) => b.type === "notes" && b.items.some((i) => /no implica causalidad/.test(i)))).toBe(true);
  });
  it("regresión, rezagos, análisis econométrico, proyección y anomalías", async () => {
    for (const [name, args] of [
      ["regresion", { dependiente: "indec.ipc_nivel_general", explicativas: ["bcra.m2"], rezagos: [0, 1] }],
      ["rezagos", { x: "bcra.m2", y: "indec.ipc_nivel_general" }],
      ["analisis_econometrico", { ids: ["bcra.m2", "indec.ipc_nivel_general"], desde: "2017" }],
      ["proyeccion", { id: "bcra.reservas", horizonte: 6, metodo: "drift" }],
      ["anomalias", { ids: ["indec.ipc_nivel_general", "indec.salarios"] }],
      ["comparar", { ids: ["bcra.m2", "indec.ipc_nivel_general"], transformacion: "real_variacion_interanual" }],
      ["metadatos_serie", { ids: ["bcra.reservas"] }],
      ["analisis_guardados", {}],
    ] as const) {
      const r = await runTool(name, args, client);
      expect(r.ok, `${name}: ${r.summary}`).toBe(true);
      expect(r.summary.length).toBeGreaterThan(10);
    }
  });
  it("datos faltantes: series inexistentes y base caída se informan, no se inventan", async () => {
    const r = await runTool("obtener_datos", { ids: ["bcra.reservas", "bcra.no_existe"] }, client);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/No existen en el catálogo: bcra.no_existe/);
    const down = await runTool("obtener_datos", { ids: ["bcra.reservas"] }, testClient(undefined, { failSeries: true }));
    expect(down.ok).toBe(false);
    expect(down.summary).toMatch(/no disponible/);
    const none = await runTool("calcular", { id: "indec.ipc_nivel_general", operacion: "variacion_entre_fechas", desde: "2031-01" }, client);
    expect(none.ok).toBe(false);
  });
  it("informes: todos los tipos se generan y declaran la frecuencia real", async () => {
    for (const k of ["diario", "inflacion", "monetario", "cambiario", "reservas", "actividad", "salarios", "mensual"] as const) {
      const r = await buildReport(k, client, { today: "2026-10-31" });
      expect(r.sections.length, k).toBeGreaterThan(0);
      expect(r.sources.length, k).toBeGreaterThan(0);
    }
    const d = await buildReport("diario", client, { today: "2026-10-31" });
    expect(d.coverage.join(" ")).toMatch(/mensual, último dato/);
    expect(d.sections.flatMap((s) => s.text).join(" ")).toMatch(/no son diarias/);
    const p = await runAiTool("informe", { tipo: "personalizado", ids: ["bcra.reservas"] }, client);
    expect(p.ok).toBe(true);
  });
});

describe("anomalías con criterios explícitos", () => {
  it("detecta un salto inusual y una aceleración, con el criterio", () => {
    const dates = Array.from({ length: 40 }, (_, i) => `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`);
    const x = dates.map((_, i) => 2 + 0.1 * Math.sin(i));
    x[39] = 9;
    const a = detectAnomalies(dates, x, { unit: "%" });
    expect(a.find((z) => z.kind === "unusual_change")?.criterion).toMatch(/umbral \|z\| > 3,5/);
    expect(a.some((z) => z.kind === "extreme")).toBe(true);
    expect(a.some((z) => z.kind === "acceleration")).toBe(true);
    expect(detectAnomalies(dates, dates.map(() => 2), { unit: "%" })).toEqual([]);
  });
});

describe("base 100 al inicio del período comparado", () => {
  it("todas las series valen 100 en el primer período común, aunque tengan historia más larga", async () => {
    const r = await runTool("comparar", { ids: ["bcra.m2", "indec.ipc_nivel_general"], desde: "2020-01", transformacion: "base100" }, testClient());
    const t = r.blocks.find((b) => b.type === "table" && b.title === "Datos de la comparación");
    expect(t && t.type === "table").toBe(true);
    const first = t && t.type === "table" ? t.rows[t.rows.length - 1] : [];
    expect(first[0]).toBe("2020-01-01");
    expect(first[1]).toBeCloseTo(100, 10);
    expect(first[2]).toBeCloseTo(100, 10);
    expect(r.sources.map((s) => s.unit)).toEqual(["Índice 2020-01 = 100", "Índice 2020-01 = 100"]);
  });
});
