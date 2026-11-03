import { describe, expect, it } from "vitest";
import fixture from "./fixtures/indec-ipc-salarios-2024.json";
import { periodBreakdown } from "@/lib/analysis/breakdown";
import type { Pt } from "@/lib/analysis/types";

const ipc: Pt[] = fixture.ipc_nivel_general.data.map(([d, v]) => ({ d: d as string, v: v as number }));

describe("datos mes a mes", () => {
  const b = periodBreakdown(ipc, "M", "Índice dic-2016=100", "IPC");

  it("IPC: variación mensual, interanual y acumulada en el año (oficial 2024: 117,8 %)", () => {
    expect(b.kind).toBe("level");
    const dic = b.rows.find((r) => r.d === "2024-12-01")!;
    expect(dic.ytd).toBeCloseTo(117.76, 1);
    expect(dic.yoy).toBeCloseTo(dic.ytd!, 10); // en diciembre, acumulada = interanual
    const pub = new Map(fixture.ipc_var_mensual_publicada.data.map(([d, v]) => [d as string, (v as number) * 100]));
    for (const r of b.rows) if (pub.has(r.d)) expect(Math.abs(r.prev! - pub.get(r.d)!)).toBeLessThan(0.051);
    const ene = b.rows.find((r) => r.d === "2024-01-01")!;
    expect(ene.ytd).toBeCloseTo(ene.prev!, 10); // en enero, acumulada = mensual
  });

  it("filas del más reciente al más antiguo, agrupadas por año", () => {
    expect(b.rows[0].d > b.rows[1].d).toBe(true);
    expect(b.years[0].year > b.years[1].year).toBe(true);
    expect(b.years.find((y) => y.year === "2024")!.rows).toHaveLength(12);
  });

  it("sin período de comparación la variación queda vacía (no se inventa)", () => {
    const first = b.rows[b.rows.length - 1];
    expect(first.prev).toBeNull();
    expect(first.yoy).toBeNull();
    const gap = periodBreakdown(ipc.filter((p) => p.d !== "2024-05-01"), "M", "Índice", "IPC");
    expect(gap.rows.find((r) => r.d === "2024-06-01")!.prev).toBeNull();
  });

  it("tasas: variaciones en puntos porcentuales y sin acumulada", () => {
    const r = periodBreakdown([{ d: "2025-01-01", v: 7.9 }, { d: "2025-02-01", v: 6.4 }], "M", "Porcentaje", "Desocupación");
    expect(r.kind).toBe("rate");
    expect(r.rows[0].prev).toBeCloseTo(-1.5, 12);
    expect(r.rows[0].ytd).toBeNull();
  });

  it("series diarias: se resumen mes a mes con la agregación del tipo de serie", () => {
    const daily: Pt[] = [];
    for (let d = 1; d <= 31; d++) daily.push({ d: `2025-01-${String(d).padStart(2, "0")}`, v: 1000 + d });
    for (let d = 1; d <= 28; d++) daily.push({ d: `2025-02-${String(d).padStart(2, "0")}`, v: 1100 });
    const r = periodBreakdown(daily, "D", "Pesos argentinos por dólar estadounidense", "Tipo de cambio");
    expect(r.frequency).toBe("M");
    expect(r.aggregation).toBe("avg");
    expect(r.rows[1].value).toBeCloseTo(1016, 10);
    expect(r.rows[0].prev).toBeCloseTo((1100 / 1016 - 1) * 100, 10);
  });
});

describe("variación entre dos fechas (base 0 al inicio)", () => {
  it("inflación acumulada de 2024 = 117,8 % (enero a diciembre, base diciembre 2023)", async () => {
    const { rangeChange } = await import("@/lib/analysis/breakdown");
    const r = rangeChange(ipc, "M", "Índice dic-2016=100", "IPC", "2024-01-01", "2024-12-01");
    expect(r.mode).toBe("level");
    expect(r.base!.d).toBe("2023-12-01");
    expect(r.periods).toBe(12);
    expect(r.accumulated).toBeCloseTo(117.76, 1);
    expect(r.annualized).toBeCloseTo(r.accumulated!, 8);
    expect(r.rows[0].cumulative).toBeCloseTo(r.rows[0].change!, 12); // el primer mes ya cuenta
    expect((Math.pow(1 + r.averagePerPeriod! / 100, 12) - 1) * 100).toBeCloseTo(r.accumulated!, 8);
  });
  it("acepta cualquier día: se toma el mes que lo contiene", async () => {
    const { rangeChange } = await import("@/lib/analysis/breakdown");
    const a = rangeChange(ipc, "M", "Índice", "IPC", "2024-09-01", "2025-06-15");
    const b = rangeChange(ipc, "M", "Índice", "IPC", "2024-09-20", "2025-06-01");
    expect(a.accumulated).toBeCloseTo(b.accumulated!, 12);
    const v = new Map(ipc.map((p) => [p.d, p.v!]));
    expect(a.accumulated).toBeCloseTo((v.get("2025-06-01")! / v.get("2024-08-01")! - 1) * 100, 10);
  });
  it("compone tasas mensuales y da lo mismo que el índice", async () => {
    const { rangeChange } = await import("@/lib/analysis/breakdown");
    const monthly: Pt[] = ipc.slice(1).map((p, i) => ({ d: p.d, v: (p.v! / ipc[i].v! - 1) * 100 }));
    const c = rangeChange(monthly, "M", "%", "Inflación mensual (calculada desde IPC)", "2024-03-01", "2024-10-01");
    const l = rangeChange(ipc, "M", "Índice", "IPC", "2024-03-01", "2024-10-01");
    expect(c.mode).toBe("compound");
    expect(c.accumulated).toBeCloseTo(l.accumulated!, 9);
  });
  it("tasas que no se componen: diferencia en puntos porcentuales", async () => {
    const { rangeChange } = await import("@/lib/analysis/breakdown");
    const r = rangeChange([{ d: "2025-01-01", v: 7 }, { d: "2025-02-01", v: 8 }, { d: "2025-03-01", v: 6.5 }], "M", "Porcentaje", "Tasa de desocupación", "2025-02-01", "2025-03-01");
    expect(r.mode).toBe("rate");
    expect(r.accumulated).toBeCloseTo(-0.5, 12);
  });
  it("errores claros: sin base, rango invertido o posterior al último dato", async () => {
    const { rangeChange } = await import("@/lib/analysis/breakdown");
    expect(() => rangeChange(ipc, "M", "Índice", "IPC", "2023-12-01", "2024-03-01")).toThrow(/base/);
    expect(() => rangeChange(ipc, "M", "Índice", "IPC", "2025-03-01", "2024-03-01")).toThrow(/anterior/);
    expect(() => rangeChange(ipc, "M", "Índice", "IPC", "2030-01-01", "2030-03-01")).toThrow(/último dato/);
  });
  it("base 100 en el mes elegido, aunque esté fuera del rango", async () => {
    const { rangeChange } = await import("@/lib/analysis/breakdown");
    const r = rangeChange(ipc, "M", "Índice", "IPC", "2025-01-01", "2025-06-01", { base100: "2024-06-01" });
    const v = new Map(ipc.map((p) => [p.d, p.v!]));
    expect(r.base100!.d).toBe("2024-06-01");
    expect(r.rows[5].index).toBeCloseTo((v.get("2025-06-01")! / v.get("2024-06-01")!) * 100, 10);
    const same = rangeChange(ipc, "M", "Índice", "IPC", "2025-01-01", "2025-06-01", { base100: "2025-03-15" });
    expect(same.rows[2].index).toBeCloseTo(100, 12);
    expect(() => rangeChange(ipc, "M", "Índice", "IPC", "2025-01-01", "2025-06-01", { base100: "2010-01-01" })).toThrow(/base 100/);
  });
});
