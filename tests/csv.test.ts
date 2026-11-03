import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRows } from "@/lib/utils/csv";

describe("parseCsv", () => {
  it("maneja comillas, comas y saltos de línea dentro de campos", () => {
    const text = 'a,b,c\n1,"hola, mundo","línea 1\nlínea 2"\r\n2,"con ""comillas""",\n';
    expect(parseCsv(text)).toEqual([
      { a: "1", b: "hola, mundo", c: "línea 1\nlínea 2" },
      { a: "2", b: 'con "comillas"', c: "" },
    ]);
  });

  it("ignora BOM y líneas vacías finales", () => {
    expect(parseCsvRows("x\n1\n")).toEqual([["x"], ["1"]]);
    expect(parseCsv("﻿x\n1\n\n")).toEqual([{ x: "1" }]);
  });
});
