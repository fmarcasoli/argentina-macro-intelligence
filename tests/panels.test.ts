import { describe, expect, it } from "vitest";
import { BCRA_PANELS, classifyPanel, INDEC_PANELS } from "@/lib/catalog/panels";
import { SOURCE_SERIES } from "@/lib/catalog/registry";

const indec = (category: string, subcategory: string, name: string) =>
  classifyPanel({ source_id: "INDEC", source_code: "x", category, subcategory, name });
const bcra = (category: string, name: string, code = "999") =>
  classifyPanel({ source_id: "BCRA", source_code: code, category, subcategory: null, name });

describe("categorías de panel", () => {
  it("define las 12 categorías INDEC y las 14 BCRA pedidas", () => {
    expect(INDEC_PANELS).toHaveLength(12);
    expect(BCRA_PANELS).toHaveLength(14);
  });

  it("clasifica series reales del catálogo del INDEC", () => {
    expect(indec("Precios", "Índice de Precios al Consumidor Nacional (IPC). Base diciembre 2016.", "IPC Nivel General")).toBe("precios");
    expect(indec("Empleo e Ingresos", "Principales variables ocupacionales. EPH continua. Desempleo", "Tasa de desempleo total")).toBe("mercado-laboral");
    expect(indec("Empleo e Ingresos", "Población con ingresos por debajo de la línea de pobreza. EPH puntual y continua.", "Población bajo línea de pobreza")).toBe("pobreza");
    expect(indec("Actividad", "Indicador sintético de la actividad de la construcción (ISAC). Base 2004.", "ISAC nivel general")).toBe("construccion");
    expect(indec("Actividad", "Índice de Producción Industrial Manufacturero (IPI)", "IPI Nivel General")).toBe("industria");
    expect(indec("Actividad", "Encuesta de ocupación hotelera", "EOH. Viajeros totales")).toBe("turismo");
    expect(indec("Actividad", "Producto Interno Bruto en dólares, Producto Interno Bruto per cápita y población", "Población de Argentina")).toBe("demografia");
    expect(indec("Actividad", "Valor Agregado Bruto a precios básicos por rama de actividad económica", "Caza, repoblación de animales")).toBe("cuentas-nacionales");
    expect(indec("Actividad", "Ventas en supermercados", "Ventas totales")).toBe("sectoriales");
    expect(indec("Sector Externo", "Intercambio comercial argentino", "Exportaciones")).toBe("sector-externo");
    expect(indec("Empleo e Ingresos", "Índice de salarios. Base octubre 2016", "Índice de salarios")).toBe("salarios");
  });

  it("clasifica series reales del catálogo del BCRA", () => {
    expect(bcra("Principales Variables", "CER (base 2.2.02=1)", "30")).toBe("cer");
    expect(bcra("Principales Variables", "UVA (base 31.3.16=14,05)", "31")).toBe("uva");
    expect(bcra("Series.xlsm", "Tasa de interés BADLAR de bancos privados")).toBe("tasas");
    expect(bcra("Series.xlsm", "Reservas internacionales")).toBe("reservas");
    expect(bcra("Series.xlsm", "Base monetaria")).toBe("base-monetaria");
    expect(bcra("Informe Monetario Diario", "M2 (M1 + cajas de ahorro del s. privado y del s. público en pesos)")).toBe("agregados");
    expect(bcra("Depósitos por tipo de titular", "Depósitos a plazo fijo del sector privado")).toBe("depositos");
    expect(bcra("Series.xlsm", "Depósitos a plazo no ajustables por CER/UVAS del sector privado no financiero")).toBe("depositos");
    expect(bcra("Series.xlsm", "Préstamos personales otorgados al sector privado")).toBe("prestamos");
    expect(bcra("Series.xlsm", "Préstamos otorgados al sector privado")).toBe("credito");
    expect(bcra("Informe Monetario Diario", "Liquidez en pesos de las entidades financieras")).toBe("sistema-financiero");
    expect(bcra("Series.xlsm", "Efecto monetario de las compras netas de divisas al tesoro nacional")).toBe("cambiarios");
    expect(bcra("Series.xlsm", "Tipo de cambio de valuación contable")).toBe("tipo-de-cambio");
  });

  it("los destacados de cada panel existen en el registro", () => {
    const ids = new Set(SOURCE_SERIES.map((s) => s.id));
    for (const p of [...INDEC_PANELS, ...BCRA_PANELS]) {
      for (const h of p.headline) if (!h.startsWith("calc.")) expect(ids.has(h), `${p.slug}: ${h}`).toBe(true);
    }
  });
});
