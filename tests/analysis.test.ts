import { describe, expect, it } from "vitest";
import { defaultAggregation, lowestCommonFrequency, resample } from "@/lib/analysis/frequency";
import { findGaps } from "@/lib/analysis/gaps";
import { runAnalysis, specFromSearchParams, specToSearchParams, DEFAULT_SPEC } from "@/lib/analysis/pipeline";
import { deflateToConstant, index100, pctPrev, pctYoY } from "@/lib/analysis/transform";
import type { Pt, SeriesData, SeriesMeta } from "@/lib/analysis/types";
import { canShareAxis, methodologyWarnings } from "@/lib/analysis/warnings";
import { indexBase, isNominalPesos, unitFamily } from "@/lib/analysis/units";

function meta(over: Partial<SeriesMeta>): SeriesMeta {
  return {
    id: "x",
    name: "Serie",
    source_id: "BCRA",
    source_code: "1",
    unit: "En millones de ARS",
    frequency: "M",
    value_kind: "original",
    category: "",
    subcategory: null,
    panel: null,
    update_status: "ok",
    last_date: null,
    methodology_url: null,
    ...over,
  };
}

const monthly = (start: number, values: (number | null)[]): Pt[] =>
  values.map((v, i) => {
    const y = 2024 + Math.floor((start - 1 + i) / 12);
    const m = ((start - 1 + i) % 12) + 1;
    return { d: `${y}-${String(m).padStart(2, "0")}-01`, v };
  });

describe("cambio de frecuencia", () => {
  it("diaria → mensual: promedio, último y suma; descarta el mes incompleto", () => {
    const pts: Pt[] = [
      { d: "2026-01-02", v: 10 },
      { d: "2026-01-15", v: 20 },
      { d: "2026-01-30", v: 30 },
      { d: "2026-02-02", v: 40 }, // febrero incompleto (mes en curso)
    ];
    expect(resample(pts, "D", "M", "avg").points).toEqual([{ d: "2026-01-01", v: 20 }]);
    expect(resample(pts, "D", "M", "last").points).toEqual([{ d: "2026-01-01", v: 30 }]);
    expect(resample(pts, "D", "M", "sum").points).toEqual([{ d: "2026-01-01", v: 60 }]);
    expect(resample(pts, "D", "M", "avg").incomplete).toEqual(["2026-02-01"]);
  });

  it("mensual → trimestral exige los 3 meses", () => {
    const r = resample(monthly(1, [1, 2, 3, 4, 5]), "M", "Q", "sum");
    expect(r.points).toEqual([{ d: "2024-01-01", v: 6 }]);
    expect(r.incomplete).toEqual(["2024-04-01"]);
  });

  it("nunca desagrega", () => {
    expect(() => resample(monthly(1, [1]), "Q", "M", "avg")).toThrow(/sin inventar/);
  });

  it("los nulos no se cuentan como cero", () => {
    expect(resample(monthly(1, [null, 2, 4]), "M", "Q", "avg").points[0].v).toBe(3);
    expect(resample(monthly(1, [null, null, null]), "M", "Q", "sum").points[0].v).toBeNull();
  });

  it("frecuencia común y agregación por defecto", () => {
    expect(lowestCommonFrequency(["D", "M", "Q"])).toBe("Q");
    expect(defaultAggregation("Porcentaje", "Tasa BADLAR")).toBe("avg");
    expect(defaultAggregation("Millones de dólares", "Exportaciones totales")).toBe("sum");
    expect(defaultAggregation("En millones de USD", "Reservas internacionales")).toBe("last");
  });
});

describe("transformaciones", () => {
  it("variación contra el período anterior y la interanual (mensual)", () => {
    const pts = monthly(1, [100, 110, 121, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220]);
    expect(pctPrev(pts, "M")[0]).toEqual({ d: "2024-02-01", v: 10 });
    expect(pctYoY(pts, "M")).toEqual([{ d: "2025-01-01", v: 120 }]);
  });

  it("interanual diaria con la última cotización de la semana previa", () => {
    const pts: Pt[] = [
      { d: "2025-03-07", v: 100 }, // viernes
      { d: "2026-03-09", v: 150 }, // el 09/03/2025 fue domingo: compara con el viernes 07/03
    ];
    expect(pctYoY(pts, "D")).toEqual([{ d: "2026-03-09", v: 50 }]);
  });

  it("índice base 100", () => {
    const r = index100(monthly(1, [null, 50, 75, 100]), "2024-01-01");
    expect(r.base).toBe("2024-02-01");
    expect(r.points.map((p) => p.v)).toEqual([null, 100, 150, 200]);
  });

  it("valores reales en pesos constantes del último IPC", () => {
    const ipc = monthly(1, [100, 110, 121]);
    const r = deflateToConstant(
      [
        { d: "2024-01-15", v: 1000 },
        { d: "2024-03-10", v: 1210 },
        { d: "2024-04-02", v: 9999 }, // sin IPC publicado: queda afuera
      ],
      "D",
      ipc,
    );
    expect(r.refMonth).toBe("2024-03-01");
    expect(r.points).toEqual([
      { d: "2024-01-15", v: 1210 },
      { d: "2024-03-10", v: 1210 },
    ]);
    expect(r.dropped).toBe(1);
  });
});

describe("períodos faltantes", () => {
  it("detecta meses faltantes y valores nulos", () => {
    const pts = monthly(1, [1, 2, null, 4]).filter((p) => p.d !== "2024-02-01");
    const g = findGaps(pts, "M");
    expect(g.missingPeriods).toEqual(["2024-02-01"]);
    expect(g.nullValues).toEqual(["2024-03-01"]);
  });

  it("en diarias solo informa huecos de más de 7 días", () => {
    const g = findGaps(
      [
        { d: "2026-01-02", v: 1 },
        { d: "2026-01-05", v: 1 }, // fin de semana: normal
        { d: "2026-01-20", v: 1 },
      ],
      "D",
    );
    expect(g.dailyGaps).toEqual([{ from: "2026-01-05", to: "2026-01-20", days: 15 }]);
  });
});

describe("unidades y advertencias", () => {
  it("clasifica unidades de las fuentes", () => {
    expect(unitFamily("En millones de ARS")).toBe("ars");
    expect(unitFamily("En millones de USD")).toBe("usd");
    expect(unitFamily("Porcentaje")).toBe("percent");
    expect(unitFamily("Pesos argentinos por dólar estadounidense")).toBe("fx");
    expect(unitFamily("Índice 2004=100")).toBe("index");
    expect(indexBase("Índice dic-2016=100")).toBe("dic-2016");
    expect(indexBase("Índice 2004=100")).toBe("2004");
    expect(isNominalPesos("En millones de ARS", "Base monetaria")).toBe(true);
    expect(isNominalPesos("Pesos constantes", "PIB")).toBe(false);
  });

  it("no superpone unidades incompatibles salvo con transformación explícita", () => {
    const a = meta({ id: "a", unit: "En millones de USD" });
    const b = meta({ id: "b", unit: "En millones de ARS" });
    expect(canShareAxis([a, b], "level").ok).toBe(false);
    expect(canShareAxis([a, b], "index100").ok).toBe(true);
    const i1 = meta({ unit: "Índice 2004=100" });
    const i2 = meta({ unit: "Índice dic-2016=100" });
    expect(canShareAxis([i1, i2], "level").ok).toBe(false);
  });

  it("advierte metodologías distintas", () => {
    const ws = methodologyWarnings(
      [
        meta({ id: "a", source_id: "BCRA", name: "Inflación mensual (publicada por BCRA)", unit: "%" }),
        meta({ id: "b", source_id: "INDEC", name: "IPC Nivel General", unit: "Índice dic-2016=100" }),
        meta({ id: "c", source_id: "INDEC", name: "EMAE desestacionalizado", unit: "Índice 2004=100", update_status: "discontinued" }),
      ],
      "level",
      "M",
    ).map((w) => w.message);
    expect(ws.some((m) => /INDEC y del BCRA/.test(m))).toBe(true);
    expect(ws.some((m) => /desestacionalizadas/.test(m))).toBe(true);
    expect(ws.some((m) => /bases distintas/.test(m))).toBe(true);
    expect(ws.some((m) => /redondeo/.test(m))).toBe(true);
    expect(ws.some((m) => /discontinuada/.test(m))).toBe(true);
  });
});

describe("análisis completo", () => {
  const reservas: SeriesData = {
    meta: meta({ id: "res", name: "Reservas", unit: "En millones de USD", frequency: "D" }),
    points: [
      { d: "2024-01-02", v: 100 },
      { d: "2024-01-31", v: 110 },
      { d: "2024-02-01", v: 111 },
      { d: "2024-02-29", v: 120 },
      { d: "2024-03-01", v: 121 },
    ],
  };
  const base: SeriesData = {
    meta: meta({ id: "bm", name: "Base monetaria", unit: "En millones de ARS", frequency: "M" }),
    points: monthly(1, [1000, 1100, 1200]),
  };

  it("lleva a frecuencia común, excluye el período incompleto y separa ejes", () => {
    const r = runAnalysis([reservas, base], { ...DEFAULT_SPEC, ids: ["res", "bm"] });
    expect(r.frequency).toBe("M");
    expect(r.series[0].points).toEqual([
      { d: "2024-01-01", v: 110 },
      { d: "2024-02-01", v: 120 },
    ]);
    expect(r.overlay).toBe(false);
    expect(r.rows.map((x) => x.d)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(r.rows[2].values).toEqual([null, 1200]);
  });

  it("con índice base 100 se pueden superponer", () => {
    const r = runAnalysis([reservas, base], { ...DEFAULT_SPEC, ids: ["res", "bm"], transform: "index100" });
    expect(r.overlay).toBe(true);
    expect(r.series[1].points.map((p) => p.v)).toEqual([100, 110, 120]);
    expect(r.series[1].unit).toBe("Índice ene 2024 = 100");
  });

  it("no baja a una frecuencia más granular que la de las series", () => {
    const r = runAnalysis([base], { ...DEFAULT_SPEC, ids: ["bm"], frequency: "D" });
    expect(r.frequency).toBe("M");
    expect(r.notices.some((n) => /sin inventar/.test(n.message))).toBe(true);
  });

  it("base 100 en un mes elegido, aunque esté antes del período visible", () => {
    const r = runAnalysis([base], { ...DEFAULT_SPEC, ids: ["bm"], transform: "index100", from: "2024-02-01", baseDate: "2024-01-01" });
    expect(r.series[0].points.map((p) => p.v)).toEqual([110, 120]);
    expect(r.series[0].unit).toBe("Índice ene 2024 = 100");
  });

  it("serializa el análisis en la URL", () => {
    const spec = { ...DEFAULT_SPEC, ids: ["a", "b"], transform: "pct_yoy" as const, from: "2020-01-01", layout: "panels" as const };
    const back = specFromSearchParams(specToSearchParams(spec));
    expect(back).toEqual({ ...spec, to: undefined, baseDate: undefined });
    expect(specFromSearchParams(new URLSearchParams("s=a;drop,b&t=evil&from=2020")).ids).toEqual(["b"]);
  });
});
