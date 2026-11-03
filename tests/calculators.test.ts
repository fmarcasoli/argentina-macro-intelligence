import { describe, expect, it } from "vitest";
import fixture from "./fixtures/indec-ipc-salarios-2024.json";
import {
  adjustAmount,
  CalcError,
  compareWages,
  devaluation,
  inflationBetween,
  realChange,
  realIndex,
  realRate,
  referenceMonthlyInflation,
  toConstantPesos,
  valueOnOrBefore,
} from "@/lib/analysis/calculators";
import type { Pt } from "@/lib/analysis/types";

const toPts = (rows: (string | number)[][]): Pt[] => rows.map(([d, v]) => ({ d: d as string, v: v as number }));
const ipc = toPts(fixture.ipc_nivel_general.data);
const published = toPts(fixture.ipc_var_mensual_publicada.data);
const wages = toPts(fixture.indice_salarios.data);

describe("calculadora de inflación (IPC oficial)", () => {
  it("2024 completo: coincide con el 117,8 % publicado por el INDEC", () => {
    const r = inflationBetween(ipc, "2024-01-01", "2024-12-01");
    expect(r.baseMonth).toBe("2023-12-01");
    expect(r.months).toBe(12);
    expect(r.accumulated).toBeCloseTo(117.76, 1);
    expect(r.yoyAtEnd).toBeCloseTo(r.accumulated, 6); // ene–dic = interanual de diciembre
    expect(r.annualized).toBeCloseTo(r.accumulated, 6);
  });

  it("cada variación mensual coincide con la publicada por el INDEC (redondeo a 0,1 pp)", () => {
    const r = inflationBetween(ipc, "2024-01-01", "2026-08-01");
    const pub = new Map(published.map((p) => [p.d, (p.v as number) * 100]));
    for (const m of r.monthly) {
      expect(Math.abs((m.v as number) - pub.get(m.d)!)).toBeLessThan(0.051);
    }
  });

  it("capitalización compuesta: el promedio mensual reproduce la acumulada", () => {
    const r = inflationBetween(ipc, "2025-01-01", "2025-06-01");
    expect((Math.pow(1 + r.monthlyAverage / 100, 6) - 1) * 100).toBeCloseTo(r.accumulated, 8);
    expect(r.monthly).toHaveLength(6);
  });

  it("actualización de importes", () => {
    expect(adjustAmount(1000, 117.76)).toBeCloseTo(2177.6, 6);
  });

  it("no completa meses faltantes", () => {
    expect(() => inflationBetween(ipc, "2023-06-01", "2024-03-01")).toThrow(CalcError);
    expect(() => inflationBetween(ipc, "2024-05-01", "2024-03-01")).toThrow(/posterior/);
    const conHueco = ipc.filter((p) => p.d !== "2024-06-01");
    expect(() => inflationBetween(conHueco, "2024-01-01", "2024-12-01")).toThrow(/2024-06/);
  });
});

describe("tasa real (Fisher)", () => {
  it("Fisher exacta: (1+i)/(1+π) − 1", () => {
    // 30 días, TNA 36,5 % → 3 % en el período; inflación que capitaliza ~2 % en el plazo
    const r = realRate(36.5, 30, 2);
    expect(r.periodNominal).toBeCloseTo(3, 10);
    const pi = Math.pow(1.02, 30 / (365 / 12)) - 1;
    expect(r.periodInflation).toBeCloseTo(pi * 100, 8);
    expect(r.periodReal).toBeCloseTo(((1.03 / (1 + pi)) - 1) * 100, 8);
    expect(r.fisherApprox).toBeCloseTo((0.03 - pi) * 100, 8);
    expect(r.tea).toBeCloseTo((Math.pow(1.03, 365 / 30) - 1) * 100, 8);
  });

  it("tasa real negativa cuando la inflación supera a la tasa", () => {
    expect(realRate(24, 30, 3).periodReal).toBeLessThan(0);
  });

  it("inflación de referencia desde el IPC", () => {
    const yoy = referenceMonthlyInflation(ipc, "yoy");
    const i = ipc.length - 1;
    const expected = (Math.pow((ipc[i].v as number) / (ipc[i - 12].v as number), 1 / 12) - 1) * 100;
    expect(yoy.value).toBeCloseTo(expected, 8);
    expect(yoy.month).toBe(ipc[i].d);
    expect(referenceMonthlyInflation(ipc, "last").value).toBeCloseTo(((ipc[i].v as number) / (ipc[i - 1].v as number) - 1) * 100, 8);
  });

  it("rechaza plazos inválidos", () => {
    expect(() => realRate(30, 0, 2)).toThrow(CalcError);
  });
});

describe("devaluación", () => {
  const tc: Pt[] = [
    { d: "2025-01-02", v: 1000 },
    { d: "2025-01-03", v: 1001 },
    { d: "2025-06-30", v: 1200 },
    { d: "2026-01-02", v: 1500 },
    { d: "2026-06-30", v: 1800 },
  ];

  it("usa el último dato publicado en o antes de cada fecha", () => {
    expect(valueOnOrBefore(tc, "2025-01-05")?.d).toBe("2025-01-03");
    expect(valueOnOrBefore(tc, "2025-03-01")).toBeNull(); // más de 10 días sin dato
  });

  it("variación acumulada, anualizada e interanual", () => {
    const r = devaluation(tc, "2025-06-30", "2026-06-30");
    expect(r.accumulated).toBeCloseTo(50, 10);
    expect(r.days).toBe(365);
    expect(r.annualized).toBeCloseTo(50, 8);
    expect(r.yoyAtEnd).toBeCloseTo(50, 10);
  });

  it("variación real contra la inflación del período", () => {
    expect(realChange(50, 25)).toBeCloseTo(20, 10);
  });
});

describe("salarios y agregados reales", () => {
  it("índice real = (W_t/W_base) / (IPC_t/IPC_base) × 100", () => {
    const r = realIndex(wages, ipc, "2023-12-01");
    expect(r.base).toBe("2023-12-01");
    expect(r.points[0].v).toBe(100);
    const w = new Map(wages.map((p) => [p.d, p.v as number]));
    const p = new Map(ipc.map((x) => [x.d, x.v as number]));
    const d = "2024-12-01";
    const expected = ((w.get(d)! / w.get("2023-12-01")!) / (p.get(d)! / p.get("2023-12-01")!)) * 100;
    expect(r.points.find((x) => x.d === d)!.v).toBeCloseTo(expected, 8);
  });

  it("pesos constantes del último mes con IPC", () => {
    const r = toConstantPesos([{ d: "2024-01-01", v: 1000 }, { d: "2026-08-01", v: 1000 }], ipc);
    expect(r.refMonth).toBe("2026-08-01");
    expect(r.points[1].v).toBe(1000);
    expect(r.points[0].v).toBeCloseTo((1000 * 12276.766) / 4261.5324, 6);
  });

  it("comparación de salarios entre dos meses", () => {
    const r = compareWages(ipc, "2024-01-01", 100_000, "2025-01-01", 250_000);
    const factor = (ipc.find((x) => x.d === "2025-01-01")!.v as number) / 4261.5324;
    expect(r.equivalentAtEnd).toBeCloseTo(100_000 * factor, 4);
    expect(r.realChangePct).toBeCloseTo((2.5 / factor - 1) * 100, 8);
    expect(r.realOfEndInStartPesos).toBeCloseTo(250_000 / factor, 4);
  });
});
