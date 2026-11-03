import { describe, expect, it } from "vitest";
import { BCRAConnector, BCRA_PAGE_LIMIT, mapBcraFrequency } from "@/lib/connectors/bcra";
import { ConnectorError } from "@/lib/connectors/types";
import { fixture, mockFetch, noSleep } from "./helpers/mock-fetch";

function seriesPage(id: number, n: number, offset: number, total: number) {
  const detalle = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1) - (offset + i) * 86_400_000);
    return { fecha: d.toISOString().slice(0, 10), valor: offset + i };
  });
  return JSON.stringify({ status: 200, metadata: { resultset: { count: total, offset, limit: BCRA_PAGE_LIMIT } }, results: [{ idVariable: id, detalle }] });
}

describe("BCRAConnector", () => {
  it("describe(): mapea el catálogo real a metadatos internos", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "Monetarias?IdVariable=1", body: fixture("bcra-catalog-item-1.json") }]);
    const meta = await new BCRAConnector({ fetchImpl, sleep: noSleep }).describe("1");
    expect(meta).toMatchObject({
      sourceId: "BCRA",
      sourceCode: "1",
      name: "Reservas internacionales",
      category: "Principales Variables",
      unit: "En millones de USD",
      frequency: "D",
      endpoint: "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/1",
      sourceStartDate: "1996-01-03",
    });
    expect(calls[0].url).toBe("https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias?IdVariable=1");
  });

  it("fetchSeries(): devuelve los datos crudos de la respuesta real", async () => {
    const { fetchImpl } = mockFetch([{ match: "Monetarias/1612", body: fixture("bcra-series-1612.json") }]);
    const r = await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchSeries("1612");
    expect(r.reportedCount).toBe(1035);
    expect(r.observations[0]).toEqual({ date: "2026-08-31", value: 61550159476 });
    expect(r.requests).toBe(1);
  });

  it("fetchSeries(): pagina con Offset hasta completar el total", async () => {
    const total = BCRA_PAGE_LIMIT * 2 + 10;
    const { fetchImpl, calls } = mockFetch([
      {
        match: (u) => u.pathname.endsWith("/Monetarias/1"),
        body: (u) => {
          const offset = Number(u.searchParams.get("Offset"));
          return seriesPage(1, Math.min(BCRA_PAGE_LIMIT, total - offset), offset, total);
        },
      },
    ]);
    const r = await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchSeries("1");
    expect(r.observations).toHaveLength(total);
    expect(calls.map((c) => new URL(c.url).searchParams.get("Offset"))).toEqual(["0", "3000", "6000"]);
  });

  it("fetchSeries(): envía Desde/Hasta para actualizaciones incrementales", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "Monetarias/7", body: seriesPage(7, 3, 0, 3) }]);
    await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchSeries("7", { from: "2026-10-01", to: "2026-10-31" });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("Desde")).toBe("2026-10-01");
    expect(u.searchParams.get("Hasta")).toBe("2026-10-31");
    expect(u.searchParams.get("Limit")).toBe("3000");
  });

  it("un 400 de la API no se reintenta y expone el mensaje de la fuente", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "999999", status: 400, body: fixture("bcra-error-400.json") }]);
    const err = await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchSeries("999999").catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.details.httpStatus).toBe(400);
    expect(err.message).toContain("Validar formato del id");
    expect(calls).toHaveLength(1);
  });

  it("reintenta ante 502 y luego tiene éxito", async () => {
    let n = 0;
    const { fetchImpl, calls } = mockFetch([
      { match: () => n++ < 2, status: 502, body: "<html>bad gateway</html>" },
      { match: "Monetarias/1612", body: fixture("bcra-series-1612.json") },
    ]);
    const r = await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchSeries("1612");
    expect(r.observations.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(3);
  });

  it("usa un User-Agent solo ASCII (el WAF del BCRA responde 502 con acentos)", async () => {
    const { fetchImpl, calls } = mockFetch([{ match: "Monetarias/1612", body: fixture("bcra-series-1612.json") }]);
    await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchSeries("1612");
    expect(calls[0].headers["User-Agent"]).toMatch(/^[\x20-\x7e]+$/);
  });

  it("fetchMethodology(): devuelve el texto de la ficha", async () => {
    const { fetchImpl } = mockFetch([{ match: "Metodologia/1", body: fixture("bcra-methodology-1.json") }]);
    const t = await new BCRAConnector({ fetchImpl, sleep: noSleep }).fetchMethodology("1");
    expect(t).toMatch(/reservas internacionales/i);
  });

  it("mapea periodicidades y rechaza códigos desconocidos", () => {
    expect(mapBcraFrequency("D")).toBe("D");
    expect(mapBcraFrequency("M")).toBe("M");
    expect(mapBcraFrequency("T")).toBe("Q");
    expect(() => mapBcraFrequency("X")).toThrow();
  });
});
