import { describe, expect, it } from "vitest";
import { pctChange, ratio } from "@/lib/normalize/derive";
import { incrementalFrom } from "@/lib/ingest/sync";

describe("pctChange", () => {
  it("calcula la variación mensual emparejando por período", () => {
    const pts = [
      { refDate: "2026-06-01", value: 100 },
      { refDate: "2026-07-01", value: 102 },
      { refDate: "2026-08-01", value: 104.04 },
    ];
    expect(pctChange(pts, "M", 1)).toEqual([
      { refDate: "2026-07-01", value: 2 },
      { refDate: "2026-08-01", value: 2 },
    ]);
  });

  it("reproduce la inflación publicada por INDEC desde el índice IPC", () => {
    // Valores reales del IPC Nivel General Nacional (dic-2016=100)
    const pts = [
      { refDate: "2026-07-01", value: 12076.3937 },
      { refDate: "2026-08-01", value: 12276.766 },
    ];
    const [aug] = pctChange(pts, "M", 1);
    // INDEC publica 0,0165920642352028 (=1,659 %)
    expect(aug.value).toBeCloseTo(1.65920642352028, 8);
  });

  it("no inventa datos: si falta el período base no emite punto", () => {
    const pts = [
      { refDate: "2026-01-01", value: 100 },
      { refDate: "2026-03-01", value: 110 },
    ];
    expect(pctChange(pts, "M", 1)).toEqual([]);
  });

  it("propaga faltantes y evita dividir por cero", () => {
    const pts = [
      { refDate: "2026-01-01", value: 0 },
      { refDate: "2026-02-01", value: 5 },
      { refDate: "2026-03-01", value: null },
      { refDate: "2026-04-01", value: 7 },
    ];
    expect(pctChange(pts, "M", 1)).toEqual([
      { refDate: "2026-02-01", value: null },
      { refDate: "2026-03-01", value: null },
      { refDate: "2026-04-01", value: null },
    ]);
  });

  it("calcula variaciones interanuales trimestrales (lag 4)", () => {
    const pts = [
      { refDate: "2025-04-01", value: 200 },
      { refDate: "2025-07-01", value: 210 },
      { refDate: "2025-10-01", value: 220 },
      { refDate: "2026-01-01", value: 230 },
      { refDate: "2026-04-01", value: 210 },
    ];
    expect(pctChange(pts, "Q", 4)).toEqual([{ refDate: "2026-04-01", value: 5 }]);
  });
});

describe("ratio", () => {
  it("divide solo fechas presentes en ambas series", () => {
    const a = [
      { refDate: "2026-01-01", value: 10 },
      { refDate: "2026-02-01", value: 20 },
    ];
    const b = [
      { refDate: "2026-02-01", value: 4 },
      { refDate: "2026-03-01", value: 5 },
    ];
    expect(ratio(a, b, 100)).toEqual([{ refDate: "2026-02-01", value: 500 }]);
  });
});

describe("incrementalFrom", () => {
  const lookback = { D: 45, W: 120, M: 730, Q: 1460, S: 1460, A: 2920 } as const;
  it("sin datos previos descarga todo", () => {
    expect(incrementalFrom(null, "D", lookback)).toBeUndefined();
  });
  it("vuelve hacia atrás según la frecuencia para capturar revisiones", () => {
    expect(incrementalFrom("2026-10-29", "D", lookback)).toBe("2026-09-14");
    expect(incrementalFrom("2026-08-01", "M", lookback)).toBe("2024-08-01");
  });
});

import { deflate as deflateSeries, derivationInputs, ytdChange } from "@/lib/normalize/derive";
import { orderDerived } from "@/lib/ingest/sync";

describe("series derivadas de la Fase 2", () => {
  it("inflación acumulada en el año contra diciembre anterior", () => {
    const pts = [
      { refDate: "2024-12-01", value: 100 },
      { refDate: "2025-01-01", value: 102 },
      { refDate: "2025-02-01", value: 104.04 },
    ];
    expect(ytdChange(pts)).toEqual([
      { refDate: "2025-01-01", value: 2 },
      { refDate: "2025-02-01", value: 4.04 },
    ]);
    // sin diciembre base no se emite el punto
    expect(ytdChange(pts.slice(1))).toEqual([]);
  });

  it("deflactar con base común", () => {
    const w = [
      { refDate: "2016-12-01", value: 50 },
      { refDate: "2017-01-01", value: 60 },
      { refDate: "2017-02-01", value: null },
    ];
    const p = [
      { refDate: "2016-12-01", value: 100 },
      { refDate: "2017-01-01", value: 110 },
      { refDate: "2017-02-01", value: 120 },
    ];
    const r = deflateSeries(w, p, "2016-12-01");
    expect(r[0].value).toBe(100);
    expect(r[1].value).toBeCloseTo((60 / 50 / 1.1) * 100, 8);
    expect(r[2].value).toBeNull();
    expect(() => deflateSeries(w, p, "2015-01-01")).toThrow(/base/);
  });

  it("ordena series calculadas según sus dependencias", () => {
    const rows = [
      { id: "calc.b", derivation: { op: "pct_change" as const, base: "calc.a", lag: 12 } },
      { id: "calc.a", derivation: { op: "deflate" as const, nominal: "x", deflator: "y", base: "2016-12-01" } },
    ];
    expect(orderDerived(rows).map((r) => r.id)).toEqual(["calc.a", "calc.b"]);
    expect(derivationInputs(rows[1].derivation)).toEqual(["x", "y"]);
    const cyc = [
      { id: "a", derivation: { op: "ytd_change" as const, base: "b" } },
      { id: "b", derivation: { op: "ytd_change" as const, base: "a" } },
    ];
    expect(() => orderDerived(cyc)).toThrow(/circular/);
  });
});
