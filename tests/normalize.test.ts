import { describe, expect, it } from "vitest";
import { normalizeObservations, parseValue } from "@/lib/normalize/normalize";
import { alignToPeriodStart, formatPeriod, parseIsoDate, shiftPeriods, toIsoDate } from "@/lib/normalize/dates";
import { todayAR } from "@/lib/utils/time";

describe("parseValue", () => {
  it("acepta números finitos", () => {
    expect(parseValue(12.5)).toEqual({ ok: true, value: 12.5 });
    expect(parseValue(0)).toEqual({ ok: true, value: 0 });
    expect(parseValue(-3)).toEqual({ ok: true, value: -3 });
  });

  it("convierte faltantes en null, nunca en 0", () => {
    for (const v of [null, undefined, "", "  ", "NaN", "null", "s/d", "-", Number.NaN]) {
      expect(parseValue(v)).toEqual({ ok: true, value: null });
    }
  });

  it("parsea texto numérico, incluido formato local no ambiguo", () => {
    expect(parseValue("1234.5")).toEqual({ ok: true, value: 1234.5 });
    expect(parseValue("1.234,5")).toEqual({ ok: true, value: 1234.5 });
    expect(parseValue("1.234.567")).toEqual({ ok: true, value: 1234567 });
    expect(parseValue("12,5")).toEqual({ ok: true, value: 12.5 });
    expect(parseValue("1e3")).toEqual({ ok: true, value: 1000 });
  });

  it("interpreta '1.234' como decimal (formato de las APIs)", () => {
    expect(parseValue("1.234")).toEqual({ ok: true, value: 1.234 });
  });

  it("rechaza basura e infinitos", () => {
    expect(parseValue("abc")).toEqual({ ok: false, reason: "invalid_value" });
    expect(parseValue(Infinity)).toEqual({ ok: false, reason: "non_finite" });
    expect(parseValue({})).toEqual({ ok: false, reason: "invalid_value" });
  });
});

describe("fechas y períodos", () => {
  it("rechaza fechas imposibles", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("31/08/2026")).toBeNull();
    expect(parseIsoDate("2026-08-31T00:00:00")).not.toBeNull();
  });

  it("alinea al inicio del período", () => {
    const d = parseIsoDate("2026-08-31")!;
    expect(toIsoDate(alignToPeriodStart(d, "D"))).toBe("2026-08-31");
    expect(toIsoDate(alignToPeriodStart(d, "M"))).toBe("2026-08-01");
    expect(toIsoDate(alignToPeriodStart(d, "Q"))).toBe("2026-07-01");
    expect(toIsoDate(alignToPeriodStart(d, "S"))).toBe("2026-07-01");
    expect(toIsoDate(alignToPeriodStart(d, "A"))).toBe("2026-01-01");
  });

  it("desplaza períodos cruzando años", () => {
    const d = parseIsoDate("2026-01-01")!;
    expect(toIsoDate(shiftPeriods(d, "M", -1))).toBe("2025-12-01");
    expect(toIsoDate(shiftPeriods(d, "M", -12))).toBe("2025-01-01");
    expect(toIsoDate(shiftPeriods(d, "Q", -4))).toBe("2025-01-01");
    expect(toIsoDate(shiftPeriods(d, "D", -1))).toBe("2025-12-31");
  });

  it("formatea etiquetas de período", () => {
    expect(formatPeriod("2026-08-01", "M")).toBe("ago 2026");
    expect(formatPeriod("2026-04-01", "Q")).toBe("T2 2026");
    expect(formatPeriod("2026-11-02", "D")).toBe("02/11/2026");
  });

  it("calcula 'hoy' en hora argentina, no en UTC", () => {
    // 2026-11-03 01:00 UTC = 2026-11-02 22:00 en Buenos Aires
    expect(todayAR(new Date("2026-11-03T01:00:00Z"))).toBe("2026-11-02");
    expect(todayAR(new Date("2026-11-03T03:30:00Z"))).toBe("2026-11-03");
  });
});

describe("normalizeObservations", () => {
  const today = "2026-11-02";

  it("alinea fechas de fin de mes del BCRA al inicio del período y conserva la fecha original", () => {
    const r = normalizeObservations(
      [
        { date: "2026-08-31", value: 61550159476.0 },
        { date: "2026-07-31", value: 60027636539.0 },
      ],
      { frequency: "M", today },
    );
    expect(r.observations).toEqual([
      { refDate: "2026-07-01", sourceRefDate: "2026-07-31", value: 60027636539, rawValue: "60027636539", valueKind: "original", isScheduled: false },
      { refDate: "2026-08-01", sourceRefDate: "2026-08-31", value: 61550159476, rawValue: "61550159476", valueKind: "original", isScheduled: false },
    ]);
  });

  it("ordena ascendente aunque la fuente entregue descendente", () => {
    const r = normalizeObservations(
      [
        { date: "2026-10-29", value: 3 },
        { date: "2026-10-27", value: 1 },
        { date: "2026-10-28", value: 2 },
      ],
      { frequency: "D", today },
    );
    expect(r.observations.map((o) => o.refDate)).toEqual(["2026-10-27", "2026-10-28", "2026-10-29"]);
  });

  it("conserva faltantes como null y no los cuenta como cero", () => {
    const r = normalizeObservations(
      [
        { date: "2026-01-01", value: 10 },
        { date: "2026-02-01", value: null },
        { date: "2026-03-01", value: 0 },
      ],
      { frequency: "M", today },
    );
    expect(r.observations.map((o) => o.value)).toEqual([10, null, 0]);
    expect(r.stats.missing).toBe(1);
  });

  it("escala proporciones a porcentaje y marca el dato como normalizado", () => {
    const r = normalizeObservations([{ date: "2026-08-01", value: 0.0165920642352028 }], { frequency: "M", scale: 100, today });
    expect(r.observations[0].value).toBeCloseTo(1.65920642352028, 12);
    expect(r.observations[0].valueKind).toBe("normalized");
    expect(r.observations[0].rawValue).toBe("0.0165920642352028");
  });

  it("marca como programados los datos con fecha futura (UVA/CER)", () => {
    const r = normalizeObservations(
      [
        { date: "2026-11-02", value: 2177.53 },
        { date: "2026-11-15", value: 2196.12 },
      ],
      { frequency: "D", today },
    );
    expect(r.observations.find((o) => o.refDate === "2026-11-15")?.isScheduled).toBe(true);
    expect(r.observations.find((o) => o.refDate === "2026-11-02")?.isScheduled).toBe(false);
    expect(r.stats.scheduled).toBe(1);
  });

  it("rechaza fechas inválidas, valores inválidos y fechas absurdas con su motivo", () => {
    const r = normalizeObservations(
      [
        { date: "2026-02-30", value: 1 },
        { date: "2026-01-01", value: "xx" },
        { date: "1850-01-01", value: 1 },
        { date: "2099-01-01", value: 1 },
        { date: "2026-03-01", value: 5 },
      ],
      { frequency: "M", today },
    );
    expect(r.observations).toHaveLength(1);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["invalid_date", "invalid_value", "out_of_range", "out_of_range"]);
  });

  it("resuelve dos registros del mismo período conservando el más reciente y registra el descartado", () => {
    const r = normalizeObservations(
      [
        { date: "2026-08-01", value: 100 },
        { date: "2026-08-31", value: 101 },
      ],
      { frequency: "M", today },
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({ refDate: "2026-08-01", sourceRefDate: "2026-08-31", value: 101 });
    expect(r.rejected[0].reason).toBe("duplicate_period");
  });

  it("ignora duplicados idénticos sin reportarlos como error", () => {
    const r = normalizeObservations(
      [
        { date: "2026-08-01", value: 5 },
        { date: "2026-08-01", value: 5 },
      ],
      { frequency: "M", today },
    );
    expect(r.observations).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
});
