import { describe, expect, it } from "vitest";
import { INDECConnector, INDEC_PAGE_LIMIT, mapIndecFrequency, parseIndecDump } from "@/lib/connectors/indec";
import { ConnectorError } from "@/lib/connectors/types";
import { fixture, mockFetch, noSleep } from "./helpers/mock-fetch";

describe("INDECConnector", () => {
  it("describe(): extrae metadatos y metodología de la respuesta real", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "145.3_INGNACUAL_DICI_M_38", body: fixture("indec-describe-145.json") }]);
    const m = await new INDECConnector({ fetchImpl, sleep: noSleep }).describe("145.3_INGNACUAL_DICI_M_38");
    expect(m).toMatchObject({
      sourceId: "INDEC",
      sourceCode: "145.3_INGNACUAL_DICI_M_38",
      unit: "Variación intermensual",
      frequency: "M",
      subcategory: "Índice de Precios al Consumidor Nacional (IPC). Base diciembre 2016.",
      sourceStartDate: "2017-01-01",
    });
    // La API marca is_percentage=false aunque el valor es una proporción: por eso la escala se declara en el registro.
    expect(m.isPercentage).toBe(false);
    expect(m.methodology).toBeTruthy();
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("metadata")).toBe("full");
    expect(u.searchParams.get("last")).toBe("1");
  });

  it("fetchSeries(): lee pares [fecha, valor] y pide metadata=none", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "74.3_IET_0_M_16", body: fixture("indec-series-74.json") }]);
    const r = await new INDECConnector({ fetchImpl, sleep: noSleep }).fetchSeries("74.3_IET_0_M_16", { from: "2026-01-01" });
    expect(r.observations[0]).toEqual({ date: "2026-01-01", value: expect.any(Number) });
    expect(r.reportedCount).toBe(r.observations.length);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("start_date")).toBe("2026-01-01");
    expect(u.searchParams.get("limit")).toBe(String(INDEC_PAGE_LIMIT));
    expect(u.searchParams.get("metadata")).toBe("none");
  });

  it("fetchSeries(): pagina con start cuando la serie supera el límite", async () => {
    const total = INDEC_PAGE_LIMIT + 3;
    const { fetchImpl, calls } = mockFetch([
      {
        match: "ids=X",
        body: (u) => {
          const start = Number(u.searchParams.get("start"));
          const n = Math.min(INDEC_PAGE_LIMIT, total - start);
          const data = Array.from({ length: n }, (_, i) => [new Date(Date.UTC(1900, 0, 1 + start + i)).toISOString().slice(0, 10), i]);
          return JSON.stringify({ data, count: total });
        },
      },
    ]);
    const r = await new INDECConnector({ fetchImpl, sleep: noSleep }).fetchSeries("X");
    expect(r.observations).toHaveLength(total);
    expect(calls.map((c) => new URL(c.url).searchParams.get("start"))).toEqual(["0", String(INDEC_PAGE_LIMIT)]);
  });

  it("preserva valores null que entrega la API", async () => {
    const { fetchImpl } = mockFetch([{ match: "ids=Y", body: JSON.stringify({ data: [["2026-01-01", 1], ["2026-02-01", null]], count: 2 }) }]);
    const r = await new INDECConnector({ fetchImpl, sleep: noSleep }).fetchSeries("Y");
    expect(r.observations[1]).toEqual({ date: "2026-02-01", value: null });
  });

  it("serie inexistente: error 400 con el mensaje de la API, sin reintentos", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "NOEXISTE", status: 400, body: fixture("indec-error-400.json") }]);
    const err = await new INDECConnector({ fetchImpl, sleep: noSleep }).fetchSeries("NOEXISTE_123").catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toContain("Serie inexistente");
    expect(calls).toHaveLength(1);
  });

  it("discover(): filtra solo series del INDEC del volcado oficial y marca discontinuadas", () => {
    const series = parseIndecDump(fixture("indec-dump-sample.csv"));
    expect(series.every((s) => s.sourceId === "INDEC")).toBe(true);
    const codes = series.map((s) => s.sourceCode);
    expect(codes).toEqual(expect.arrayContaining(["74.3_IET_0_M_16", "148.3_INIVELNAL_DICI_M_26", "4.2_OGP_2004_T_17"]));
    expect(series.some((s) => s.discontinued)).toBe(true);
    const pib = series.find((s) => s.sourceCode === "4.2_OGP_2004_T_17")!;
    expect(pib.frequency).toBe("Q");
  });

  it("mapea frecuencias ISO 8601 y textuales", () => {
    expect(mapIndecFrequency("R/P1M")).toBe("M");
    expect(mapIndecFrequency("R/P3M")).toBe("Q");
    expect(mapIndecFrequency("R/P6M")).toBe("S");
    expect(mapIndecFrequency("R/P1Y")).toBe("A");
    expect(mapIndecFrequency("month")).toBe("M");
    expect(mapIndecFrequency("quarter")).toBe("Q");
    expect(() => mapIndecFrequency("R/P2Y")).toThrow();
  });
});
