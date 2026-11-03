import { describe, expect, it } from "vitest";
import { pickFresher, withAlternatives } from "@/lib/data/fresher";

describe("tarjetas de inflación con el dato más reciente", () => {
  it("usa la serie del BCRA solo si tiene un mes posterior", () => {
    const by = new Map([
      ["calc.ipc_var_mensual", { id: "calc.ipc_var_mensual", last_date: "2026-08-01" }],
      ["bcra.inflacion_mensual", { id: "bcra.inflacion_mensual", last_date: "2026-09-01" }],
    ]);
    const r = pickFresher("calc.ipc_var_mensual", by);
    expect(r.ind!.id).toBe("bcra.inflacion_mensual");
    expect(r.note).toMatch(/BCRA/);
    by.set("calc.ipc_var_mensual", { id: "calc.ipc_var_mensual", last_date: "2026-09-01" });
    expect(pickFresher("calc.ipc_var_mensual", by)).toEqual({ ind: by.get("calc.ipc_var_mensual"), note: null });
  });
  it("las demás series no cambian y se piden las alternativas", () => {
    const by = new Map([["bcra.cer", { id: "bcra.cer", last_date: "2026-11-03" }]]);
    expect(pickFresher("bcra.cer", by).note).toBeNull();
    expect(withAlternatives(["calc.ipc_var_mensual", "bcra.cer"])).toEqual(["calc.ipc_var_mensual", "bcra.cer", "bcra.inflacion_mensual"]);
  });
});
