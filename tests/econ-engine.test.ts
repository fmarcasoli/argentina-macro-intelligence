import { describe, expect, it } from "vitest";
import ref from "./fixtures/econ/reference.json";
import real from "./fixtures/econ/indec-real.json";
import type { Pt } from "@/lib/analysis/types";
import { backtest, errorStats, mapeAppropriate, seriesAsOf } from "@/lib/econ/backtest";
import { autoArima, constrainStationary, fitArima, forecastArima, psiWeights, unconstrainStationary } from "@/lib/econ/arima";
import { laggedCorrelations, rollingCorrelation } from "@/lib/econ/correlation";
import { futureDates, runForecast } from "@/lib/econ/forecast";
import { buildDesign, ols } from "@/lib/econ/regression";
import { compound, expandPath, realExchangeChange, realVariation, runScenario, simulateShock } from "@/lib/econ/simulator";
import { cagr, cumulativeGrowth, describe as describeSeries, mode, movingAverage, rollingVolatility } from "@/lib/econ/stats";
import { alignSeries, applyRecipe, TransformError } from "@/lib/econ/transforms";
import { checkVecmRequirements } from "@/lib/econ/vecm";
import { stationarity } from "@/lib/econ/unitroot";

const pts = (vals: number[], start = 2020): Pt[] =>
  vals.map((v, i) => ({ d: `${start + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, v }));
const ipc: Pt[] = real.series.ipc.map(([d, v]) => ({ d: d as string, v: v as number }));
const emae: Pt[] = real.series.emae.map(([d, v]) => ({ d: d as string, v: v as number }));

describe("distribuciones: casos límite", () => {
  it("p-valor con infinitos grados de libertad usa la normal", async () => {
    const { tPValue } = await import("@/lib/econ/dist");
    expect(tPValue(1.959963984540054, Infinity)).toBeCloseTo(0.05, 12);
    expect(Number.isNaN(tPValue(2, Infinity))).toBe(false);
  });
});

describe("motor estadístico", () => {
  it("resumen descriptivo con extremos, atípicos y CV", () => {
    const d = describeSeries(pts([1, 2, 3, 4, 100, null as unknown as number]).map((p, i) => (i === 5 ? { ...p, v: null } : p)));
    expect(d.n).toBe(5);
    expect(d.nulls).toBe(1);
    expect(d.max!.v).toBe(100);
    expect(d.max!.d).toBe("2020-05-01");
    expect(d.outliers.map((o) => o.v)).toEqual([100]);
    expect(describeSeries(pts([-1, 1, 2])).cv).toBeNull(); // cambia de signo
  });
  it("moda exacta o clase modal", () => {
    expect(mode([1, 2, 2, 3])).toMatchObject({ kind: "exact", values: [2], count: 2 });
    const m = mode([1.1, 1.2, 1.25, 1.3, 5.7, 9.9]);
    expect(m.kind).toBe("interval");
    expect(m.interval![0]).toBeLessThanOrEqual(1.25);
  });
  it("promedios móviles, volatilidad, crecimiento acumulado y CAGR", () => {
    expect(movingAverage(pts([1, 2, 3, 4]), 2).map((p) => p.v)).toEqual([1.5, 2.5, 3.5]);
    expect(movingAverage(pts([1, 2, 3, 4, 5]), 3, true).map((p) => p.d)).toEqual(["2020-02-01", "2020-03-01", "2020-04-01"]);
    // Crecimiento constante: volatilidad nula
    const g = pts(Array.from({ length: 30 }, (_, i) => 100 * 1.02 ** i));
    expect(rollingVolatility(g, 12, "M").every((p) => Math.abs(p.v!) < 1e-9)).toBe(true);
    expect(cumulativeGrowth(pts([100, 110, 121])).map((p) => p.v)).toEqual([0, 10, 21]);
    const c = cagr([{ d: "2020-01-01", v: 100 }, { d: "2022-01-01", v: 121 }]);
    expect(c.years).toBeCloseTo(731 / 365.25, 12);
    expect(c.cagr).toBeCloseTo((Math.pow(1.21, 1 / c.years) - 1) * 100, 12);
    expect(() => cagr([{ d: "2020-01-01", v: -1 }, { d: "2021-01-01", v: 1 }])).toThrow(/positivos/);
  });
});

describe("transformaciones reproducibles", () => {
  const ctx = { freq: "M" as const, unit: "Índice" };
  it("log + diferencia = diferencia logarítmica / 100, con registro de pasos", () => {
    const a = applyRecipe(ipc, [{ op: "log" }, { op: "diff" }], ctx);
    const b = applyRecipe(ipc, [{ op: "logdiff" }], ctx);
    a.points.forEach((p, i) => expect(p.v! * 100).toBeCloseTo(b.points[i].v!, 10));
    expect(a.log).toEqual(["1. Logaritmo natural: y = ln(x)", "2. Diferencia: y(t) = x(t) − x(t−1)"]);
    expect(a.unit).toBe("Diferencia de ln(Índice)");
  });
  it("variación % e interanual", () => {
    const v = applyRecipe(pts([100, 102, 104.04]), [{ op: "pct" }], ctx).points;
    v.forEach((p) => expect(p.v).toBeCloseTo(2, 12));
    expect(applyRecipe(ipc, [{ op: "yoy" }], ctx).points.length).toBe(ipc.length - 12);
  });
  it("deflactación por IPC a pesos del último mes", () => {
    const r = applyRecipe(ipc, [{ op: "deflate" }], { ...ctx, ipcMonthly: ipc });
    r.points.forEach((p) => expect(p.v).toBeCloseTo(ipc[ipc.length - 1].v!, 6)); // el IPC deflactado por sí mismo es constante
  });
  it("desestacionalización solo cuando corresponde", () => {
    const r = applyRecipe(emae, [{ op: "sa" }], ctx);
    expect(r.points.length).toBe(emae.length);
    expect(r.notes.join(" ")).toMatch(/X-13ARIMA-SEATS/);
    expect(() => applyRecipe(emae, [{ op: "sa" }], { freq: "D", unit: "" })).toThrow(TransformError);
    const gap = emae.filter((_, i) => i !== 40);
    expect(() => applyRecipe(gap, [{ op: "sa" }], ctx)).toThrow(/hueco/);
  });
  it("conversión de unidades y de moneda", () => {
    expect(applyRecipe(pts([1500]), [{ op: "scale", factor: 0.001, unit: "Miles de millones" }], ctx).points[0].v).toBeCloseTo(1.5, 12);
    const fx = { points: [{ d: "2020-01-02", v: 60 }, { d: "2020-01-31", v: 80 }], freq: "D" as const, name: "A3500" };
    const r = applyRecipe([{ d: "2020-01-01", v: 7000 }], [{ op: "fx", direction: "to_usd" }], { ...ctx, fx });
    expect(r.points[0].v).toBeCloseTo(100, 10); // promedio de enero = 70
  });
  it("alineación temporal: frecuencia común e intersección de fechas", () => {
    const daily: Pt[] = [];
    for (let d = 1; d <= 59; d++) {
      const dt = new Date(Date.UTC(2020, 0, d));
      daily.push({ d: dt.toISOString().slice(0, 10), v: d });
    }
    const a = alignSeries([
      { id: "m", name: "Mensual", unit: "Índice", freq: "M", points: pts([1, 2, 3]) },
      { id: "d", name: "Diaria", unit: "Pesos por dólar", freq: "D", points: daily },
    ]);
    expect(a.frequency).toBe("M");
    expect(a.dates).toEqual(["2020-01-01", "2020-02-01"]);
    expect(a.columns[1][0]).toBeCloseTo(16, 10); // promedio 1…31
  });
});

describe("correlaciones con rezagos y móviles", () => {
  it("detecta el rezago con el que x adelanta a y", () => {
    const x = ref.data.ar;
    const y = [0, 0, ...x.slice(0, -2)];
    const best = laggedCorrelations(x, y, 4).reduce((a, b) => (b.r > a.r ? b : a));
    expect(best.lag).toBe(2);
    expect(best.r).toBeGreaterThan(0.999);
    expect(rollingCorrelation(x.map((_, i) => String(i)), x, x, 10).every((r) => Math.abs(r.r! - 1) < 1e-12)).toBe(true);
  });
});

describe("regresión con rezagos", () => {
  it("arma el diseño sin rellenar observaciones", () => {
    const d = buildDesign(["a", "b", "c", "d", "e"], [[1, 2, 3, 4, 5], [10, 20, 30, 40, 50]], 0, "y", [{ column: 1, name: "x", lags: [0, 1] }], [1]);
    expect(d.names).toEqual(["y (t−1)", "x", "x (t−1)"]);
    expect(d.y).toEqual([2, 3, 4, 5]);
    expect(d.x[0]).toEqual([1, 20, 10]);
    expect(d.dropped).toBe(1);
  });
  it("rechaza colinealidad perfecta y pocas observaciones", () => {
    expect(() => ols([1, 2, 3, 4], [[1, 2], [2, 4], [3, 6], [4, 8]], ["a", "b"])).toThrow(/[Cc]olinealidad/);
    expect(() => ols([1, 2], [[1], [2]], ["a"])).toThrow(/observaciones/);
  });
});

describe("ARIMA: reparametrización y pesos ψ", () => {
  it("la transformación de estacionariedad es invertible", () => {
    const phi = constrainStationary([0.4, -1.3, 2]);
    const back = constrainStationary(unconstrainStationary(phi)!);
    back.forEach((v, i) => expect(v).toBeCloseTo(phi[i], 12));
  });
  it("ψ de una caminata aleatoria = 1 en todos los pasos", () => {
    expect(psiWeights([], [], 1, 5)).toEqual([1, 1, 1, 1, 1]);
  });
  it("auto-ARIMA elige d = 1 para la caminata aleatoria y pronostica integrando", () => {
    const r = autoArima(ref.data.rw, { maxP: 1, maxQ: 1 });
    expect(r.best.order.d).toBe(1);
    const fc = forecastArima(fitArima(ref.data.rw, { p: 0, d: 1, q: 0 }, { constant: false }), 3);
    fc.mean.forEach((v) => expect(v).toBeCloseTo(ref.data.rw[ref.data.rw.length - 1], 8));
    expect(fc.se[2] / fc.se[0]).toBeCloseTo(Math.sqrt(3), 8);
  });
});

describe("proyecciones", () => {
  const dates = ipc.map((p) => p.d);
  const y = ipc.map((p) => p.v!);
  it("fechas futuras por calendario y días hábiles", () => {
    expect(futureDates("2026-11-01", "M", 3)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(futureDates("2026-11-06", "D", 2)).toEqual(["2026-11-09", "2026-11-10"]); // viernes → lunes
  });
  it("paseo aleatorio con deriva en logaritmos: bandas asimétricas y advertencias", () => {
    const r = runForecast(dates, y, "M", { method: "drift", horizon: 6, log: true });
    expect(r.points).toHaveLength(6);
    const p = r.points[5];
    const b95 = p.bands.find((b) => b.level === 0.95)!;
    expect(p.mean / b95.lower).toBeCloseTo(b95.upper / p.mean, 8); // simétrica en log
    expect(r.warnings.join(" ")).toMatch(/no es una predicción cierta/i);
  });
  it("regresión condicionada a un escenario de explicativas", () => {
    const x = y.map((_, i) => i);
    const yy = x.map((v) => 3 + 2 * v + Math.sin(v));
    const r = runForecast(dates, yy, "M", { method: "regression", horizon: 2, exogFuture: [[200, 201]] }, { exog: [x], exogNames: ["t"] });
    expect(r.points[0].mean).toBeCloseTo(3 + 2 * 200, 0);
    expect(r.warnings.join(" ")).toMatch(/causales/);
  });
});

describe("backtesting", () => {
  const dates = ipc.map((p) => p.d);
  const y = ipc.map((p) => Math.log(p.v!) * 100);
  it("no usa información futura: el pronóstico ingenuo es el último dato del origen", () => {
    const r = backtest(dates, y, "M", { forecast: { method: "naive", horizon: 3 }, start: "2024-01-01" });
    for (const rec of r.records) {
      const i = dates.indexOf(rec.origin);
      expect(rec.forecast).toBe(y[i]);
      expect(rec.target > rec.origin).toBe(true);
    }
    expect(r.byHorizon.map((b) => b.h)).toEqual([1, 2, 3]);
    expect(r.overall.relRmse).toBeCloseTo(1, 12);
    expect(r.notes.join(" ")).toMatch(/datos vigentes/);
  });
  it("con selección automática el modelo se reestima en cada origen y mejora al ingenuo en el IPC", () => {
    const r = backtest(dates, y, "M", { forecast: { method: "drift", horizon: 1 }, start: "2023-01-01" });
    expect(r.origins).toBeGreaterThan(30);
    expect(r.overall.relRmse!).toBeLessThan(1);
    expect(r.overall.bias).toBeLessThan(0); // la inflación de 2023-24 superó la deriva histórica
  });
  it("usa vintages cuando existen", () => {
    const r = backtest(dates, y, "M", { forecast: { method: "naive", horizon: 1 }, start: "2026-01-01" }, {
      vintage: (origin) => ({ dates: dates.filter((d) => d <= origin), y: dates.filter((d) => d <= origin).map(() => 42) }),
    });
    expect(r.records.every((x) => x.forecast === 42 && x.vintage)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/vintages/);
  });
  it("rechaza regresiones (requerirían explicativas futuras)", () => {
    expect(() => backtest(dates, y, "M", { forecast: { method: "regression", horizon: 1 }, start: "2024-01-01" })).toThrow(/información futura/);
  });
  it("métricas de error y MAPE solo cuando corresponde", () => {
    const s = errorStats([2, 4], [1, 5]);
    expect(s).toEqual({ n: 2, mae: 1, rmse: 1, mape: 60, bias: 0 });
    expect(mapeAppropriate([1, -1])).toMatch(/signo/);
    expect(mapeAppropriate([100, 0.1, 100])).toMatch(/cercanos a cero/);
    expect(mapeAppropriate([100, 90])).toBeNull();
  });
  it("reconstruye la serie publicada en una fecha", () => {
    const obs = [
      { d: "2026-09-01", v: 10, availableAt: "2026-10-15" },
      { d: "2026-10-01", v: 11, availableAt: "2026-11-14" },
    ];
    const revs = [{ d: "2026-09-01", oldValue: 9.5, revisedAt: "2026-11-14T12:00:00Z" }];
    expect(seriesAsOf(obs, revs, "2026-11-01")).toEqual([{ d: "2026-09-01", v: 9.5 }]);
    expect(seriesAsOf(obs, revs, "2026-12-01")).toEqual([{ d: "2026-09-01", v: 10 }, { d: "2026-10-01", v: 11 }]);
  });
});

describe("simulador", () => {
  it("identidades aritméticas", () => {
    expect(realVariation(10, 10).value).toBeCloseTo(0, 12);
    expect(compound(2, 12).value).toBeCloseTo((1.02 ** 12 - 1) * 100, 12);
    expect(realExchangeChange(5, 5, 0).value).toBeCloseTo(0, 12);
  });
  it("escenario: si salarios y tipo de cambio siguen a la inflación, los reales no cambian", () => {
    const n = 12;
    const infl = expandPath([{ months: 6, value: 3 }, { months: 6, value: 2 }], n);
    expect(infl).toHaveLength(12);
    const r = runScenario(
      { date: "2026-10-01", ipc: 100, fx: 1000, base: 30_000_000, reserves: 40_000, wage: 100 },
      { inflation: infl, devaluation: infl, baseGrowth: infl, reserveFlow: new Array(n).fill(-100), wageGrowth: infl, rate: new Array(n).fill(0), foreignInflation: new Array(n).fill(0) },
    );
    const last = r.rows[n - 1];
    expect(last.d).toBe("2027-10-01");
    expect(last.realWageIndex).toBeCloseTo(100, 10);
    expect(last.realFxIndex).toBeCloseTo(100, 10);
    expect(last.realBase).toBeCloseTo(30_000_000, 4);
    expect(last.reserves).toBe(38_800);
    expect(last.inflationAcc).toBeCloseTo((1.03 ** 6 * 1.02 ** 6 - 1) * 100, 10);
  });
  it("modelo: el impacto inicial en la variable shockeada es el tamaño pedido", () => {
    const data = ref.var.data;
    const r = simulateShock(data, ["infl", "sal", "emae"], { p: 2, shockVar: 1, shockSize: 2.5, horizon: 6, draws: 100 });
    expect(r.response[1][0]).toBeCloseTo(2.5, 10);
    expect(r.response[0][0]).toBeCloseTo(0, 12); // la primera variable no reacciona en el impacto (Cholesky)
    expect(r.lower[1][3]).toBeLessThanOrEqual(r.upper[1][3]);
    expect(r.notes.join(" ")).toMatch(/Cholesky/);
  });
});

describe("requisitos del VECM", () => {
  it("rechaza series estacionarias y acepta un par cointegrado I(1)", () => {
    const bad = checkVecmRequirements(ref.data.ar.map((v, i) => [v, ref.data.arma[i] ?? 0]), ["ar", "arma"]);
    expect(bad.ok).toBe(false);
    expect(bad.reasons.join(" ")).toMatch(/estacionaria en niveles/);
    expect(stationarity(ref.data.rw).verdict).toBe("unit_root");
  });
});

describe("preparación del dataset", () => {
  it("lleva a la frecuencia común ANTES de transformar (variación del promedio mensual, no promedio de variaciones diarias)", async () => {
    const { prepare } = await import("@/lib/econ/tasks");
    const daily: Pt[] = [];
    // enero: 100 todos los días; febrero: 110 todos los días; marzo: 121
    for (const [m, v, days] of [[1, 100, 31], [2, 110, 29], [3, 121, 31], [4, 133, 30]] as const) {
      for (let d = 1; d <= days; d++) daily.push({ d: `2024-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, v: v + (d % 2 ? 1 : -1) });
    }
    const meta = (id: string, frequency: "D" | "M", unit: string) => ({
      id, name: id, source_id: "BCRA" as const, source_code: "1", unit, frequency, value_kind: "original" as const,
      category: "", subcategory: null, panel: null, update_status: "ok", last_date: null, methodology_url: null,
    });
    const d = prepare({
      series: [
        { meta: meta("tc", "D", "Pesos por dólar"), points: daily },
        { meta: meta("m", "M", "Índice"), points: [{ d: "2024-01-01", v: 1 }, { d: "2024-02-01", v: 2 }, { d: "2024-03-01", v: 3 }, { d: "2024-04-01", v: 4 }] },
      ],
      recipes: { tc: [{ op: "pct" }] },
    });
    expect(d.frequency).toBe("M");
    expect(d.dates).toEqual(["2024-02-01", "2024-03-01", "2024-04-01"]);
    // Promedios exactos: enero (16·101 + 15·99)/31, febrero (15·111 + 14·109)/29.
    const jan = (16 * 101 + 15 * 99) / 31;
    const feb = (15 * 111 + 14 * 109) / 29;
    expect(d.columns[0][0]).toBeCloseTo((feb / jan - 1) * 100, 8);
    expect(d.series[0].log[0]).toMatch(/diaria → mensual/);
    expect(d.series[0].isLevel).toBe(false);
    expect(d.series[1].isLevel).toBe(true);
  });
});
