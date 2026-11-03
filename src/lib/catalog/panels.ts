import type { SourceId } from "../connectors/types";

/**
 * Categorías de navegación de los paneles INDEC y BCRA.
 *
 * Las fuentes clasifican sus series con criterios propios (temas del portal
 * datos.gob.ar, hojas de cálculo del BCRA). Este módulo las reubica en las
 * categorías de la plataforma con reglas explícitas y deterministas sobre la
 * categoría, el título del dataset y el nombre de la serie. El resultado se
 * guarda en indicators.panel; la categoría original no se modifica.
 */
export interface PanelDef {
  slug: string;
  label: string;
  description: string;
  /** Series núcleo que se muestran como tarjetas destacadas del panel. */
  headline: string[];
  /** Nota visible cuando la fuente oficial ofrece poca información en la categoría. */
  note?: string;
}

export const INDEC_PANELS: PanelDef[] = [
  { slug: "precios", label: "Precios e inflación", description: "IPC nacional y regional, núcleo, regulados, estacionales, canastas y precios mayoristas.", headline: ["calc.ipc_var_mensual", "calc.ipc_var_interanual", "calc.ipc_var_acumulada", "indec.ipc_nivel_general", "indec.ipc_nucleo", "indec.ipc_regulados"] },
  { slug: "actividad", label: "Actividad económica", description: "Estimador Mensual de Actividad Económica (EMAE) y su apertura sectorial.", headline: ["indec.emae_desest", "calc.emae_var_interanual", "calc.emae_desest_var_mensual", "indec.emae"] },
  { slug: "mercado-laboral", label: "Mercado laboral", description: "Encuesta Permanente de Hogares: actividad, empleo, desocupación y subocupación; puestos de trabajo.", headline: ["indec.desempleo", "indec.tasa_empleo", "indec.tasa_actividad"] },
  { slug: "salarios", label: "Salarios", description: "Índice de salarios, remuneraciones y costo salarial por sector.", headline: ["indec.salarios", "calc.salarios_reales", "calc.salarios_var_interanual", "indec.salarios_privado_reg", "indec.salarios_publico"] },
  { slug: "cuentas-nacionales", label: "Cuentas nacionales", description: "PIB, oferta y demanda globales, valor agregado por rama, ingreso y ahorro nacional.", headline: ["indec.pib_real", "calc.pib_real_var_interanual", "indec.pib_nominal", "indec.pib_per_capita_usd"] },
  { slug: "sector-externo", label: "Sector externo", description: "Comercio exterior (exportaciones, importaciones, saldo), índices de precios y cantidades, balanza de pagos.", headline: ["indec.exportaciones", "indec.importaciones", "indec.saldo_comercial"] },
  { slug: "pobreza", label: "Pobreza y distribución", description: "Pobreza e indigencia, canastas básicas y distribución del ingreso.", headline: ["indec.pobreza", "indec.gini"] },
  { slug: "construccion", label: "Construcción", description: "Indicador sintético de la actividad de la construcción (ISAC) y costo de la construcción.", headline: ["indec.isac", "indec.isac_desest"] },
  { slug: "industria", label: "Industria", description: "Producción industrial manufacturera (IPI, EMI), capacidad instalada e indicadores de la industria.", headline: ["indec.ipi_manufacturero", "indec.ipi_manufacturero_desest"] },
  { slug: "sectoriales", label: "Estadísticas sectoriales", description: "Supermercados, autoservicios mayoristas, centros de compras, servicios públicos y otros relevamientos sectoriales.", headline: ["indec.ventas_supermercados"] },
  { slug: "demografia", label: "Demografía", description: "Población y PIB per cápita.", headline: ["indec.poblacion"], note: "La API oficial de series de tiempo publica pocas series demográficas del INDEC; las proyecciones y censos se difunden en otros formatos." },
  { slug: "turismo", label: "Turismo", description: "Encuesta de ocupación hotelera: viajeros y pernoctaciones.", headline: ["indec.viajeros", "indec.pernoctaciones"], note: "Parte de las series de turismo (sector hotelero) figuran como discontinuadas en la fuente." },
];

export const BCRA_PANELS: PanelDef[] = [
  { slug: "reservas", label: "Reservas", description: "Reservas internacionales del BCRA y sus factores de variación.", headline: ["bcra.reservas"] },
  { slug: "tipo-de-cambio", label: "Tipo de cambio", description: "Tipo de cambio mayorista (Com. A 3500), minorista, de valuación y bandas cambiarias.", headline: ["bcra.tc_mayorista", "bcra.tc_minorista", "bcra.banda_inferior", "bcra.banda_superior"] },
  { slug: "tasas", label: "Tasas de interés", description: "Tasas pasivas (BADLAR, TAMAR, plazo fijo), activas, interbancarias y de instrumentos del BCRA.", headline: ["bcra.badlar", "bcra.tamar", "bcra.plazo_fijo_30d", "bcra.pases_terceros_1d", "bcra.adelantos", "bcra.personales", "bcra.tasa_politica"] },
  { slug: "base-monetaria", label: "Base monetaria", description: "Base monetaria, circulación, billetes y monedas, y factores de explicación de su variación.", headline: ["bcra.base_monetaria", "bcra.circulacion"] },
  { slug: "agregados", label: "Agregados monetarios", description: "M1, M2 y M3 y sus componentes.", headline: ["bcra.m1", "bcra.m2", "bcra.m3", "bcra.m2_diario", "bcra.m2_transaccional"] },
  { slug: "depositos", label: "Depósitos", description: "Depósitos del sector privado y público por tipo, moneda y titular.", headline: ["bcra.depositos_privados_pesos", "bcra.depositos_privados_usd"] },
  { slug: "credito", label: "Crédito", description: "Crédito total al sector privado y al sector público, por moneda y titular.", headline: ["bcra.prestamos_privados", "bcra.prestamos_privados_usd"] },
  { slug: "prestamos", label: "Préstamos", description: "Préstamos por línea: personales, tarjetas, hipotecarios, prendarios, adelantos y documentos.", headline: ["bcra.prestamos_personales", "bcra.prestamos_tarjetas", "bcra.prestamos_hipotecarios"] },
  { slug: "cer", label: "CER", description: "Coeficiente de Estabilización de Referencia e Índice para Contratos de Locación.", headline: ["bcra.cer", "bcra.icl"] },
  { slug: "uva", label: "UVA", description: "Unidad de Valor Adquisitivo y series en UVA (depósitos y préstamos).", headline: ["bcra.uva"] },
  { slug: "uvi", label: "UVI", description: "Unidad de Vivienda.", headline: ["bcra.uvi"] },
  { slug: "sistema-financiero", label: "Sistema financiero", description: "Liquidez de las entidades, pases, letras del BCRA y activos y pasivos del BCRA.", headline: ["bcra.liquidez_pesos"] },
  { slug: "cambiarios", label: "Indicadores cambiarios", description: "Compras netas de divisas, operaciones en moneda extranjera y líneas del exterior.", headline: [] },
  { slug: "monetarias", label: "Estadísticas monetarias", description: "Inflación publicada por el BCRA, expectativas (REM) y otras series monetarias.", headline: ["bcra.inflacion_mensual", "bcra.inflacion_interanual", "bcra.rem_inflacion_12m", "bcra.m2_privado_yoy"] },
];

export function panelsFor(source: SourceId): PanelDef[] {
  return source === "INDEC" ? INDEC_PANELS : BCRA_PANELS;
}

export function findPanel(source: SourceId, slug: string): PanelDef | undefined {
  return panelsFor(source).find((p) => p.slug === slug);
}

export interface ClassifiableSeries {
  source_id: SourceId;
  source_code: string | null;
  category: string;
  subcategory: string | null;
  name: string;
}

type Rule = [panel: string, test: (s: { cat: string; sub: string; name: string; text: string; code: string }) => boolean];

const re = (r: RegExp) => (s: { text: string }) => r.test(s.text);

// El orden importa: la primera regla que coincide define el panel.
const INDEC_RULES: Rule[] = [
  ["pobreza", re(/pobreza|indigencia|canasta b[aá]sica|distribuci[oó]n (personal|funcional) del ingreso|gini|deciles|brecha de ingreso/i)],
  ["turismo", re(/hotel|turis|pernoctac|viajeros|ocupaci[oó]n hotelera/i)],
  ["construccion", re(/construcci[oó]n|\bISAC\b|\bICC\b/i)],
  ["salarios", re(/salari|remuneraci|costo salarial|variaci[oó]n salarial|\bISO\b/i)],
  ["mercado-laboral", re(/\bEPH\b|ocupad|desocup|desempleo|subocup|tasa de (actividad|empleo)|puestos de trabajo|asalariz|mano de obra|horas trabajadas|poblaci[oó]n econ[oó]micamente activa/i)],
  ["demografia", (s) => /(^|[^a-záéíóúñ])poblaci[oó]n|per c[aá]pita|habitantes|demogr/i.test(s.name) && !/pobreza|ingreso per c/i.test(s.name)],
  ["precios", (s) => /^precios$/i.test(s.cat)],
  ["sector-externo", (s) => /^sector externo$/i.test(s.cat)],
  ["industria", re(/industri|manufactur|capacidad instalada|\bEMI\b|volumen f[ií]sico|producci[oó]n industrial/i)],
  ["actividad", re(/\bEMAE\b|estimador mensual de actividad/i)],
  ["cuentas-nacionales", re(/producto interno|\bPIB\b|oferta y demanda|valor agregado|\bVAB\b|valor bruto de producci|ingreso nacional|ahorro|consumo (p[uú]blico|privado)|formaci[oó]n bruta|cuentas? nacional/i)],
  ["sectoriales", re(/supermercado|autoservicio|centros? de compras|servicios p[uú]blicos|cinematogr|ventas/i)],
];

const BCRA_RULES: Rule[] = [
  ["cer", (s) => s.code === "30" || s.code === "40" || /^coeficiente de estabilizaci|contratos de locaci[oó]n/i.test(s.name)],
  ["uvi", (s) => s.code === "32" || /\bUVI\b|unidad de vivienda/i.test(s.name)],
  ["uva", (s) => s.code === "31" || (/\bUVAS?\b|unidad de valor adquisitivo/i.test(s.name) && !/no ajustables/i.test(s.name))],
  ["tipo-de-cambio", re(/tipo de cambio|banda cambiaria/i)],
  ["reservas", re(/reservas internacionales|activos de reserva|asignaciones de deg|reservas/i)],
  ["tasas", re(/\btasas? de inter[eé]s|\btasa\b|margen sobre|\bBADLAR\b|\bTAMAR\b|\bTM20\b|\bBAIBAR\b/i)],
  ["cambiarios", re(/divisas|moneda extranjera en (el BCRA|entidades)|efectivo en moneda extranjera|l[ií]neas del exterior|CEDIN|cheques cancelatorios en moneda extranjera/i)],
  ["agregados", (s) => /agregados monetarios/i.test(s.cat) || /\bM[123]\b/.test(s.name)],
  ["base-monetaria", re(/base monetaria|circulaci[oó]n monetaria|billetes y monedas|\| efectivo en entidades financieras$|cuasimonedas|efecto monetario|factores de explicaci|cuentas? corrientes? en pesos en el BCRA|en cuenta corriente en el BCRA|cheques cancelatorios$/i)],
  ["sistema-financiero", (s) =>
    /activos y pasivos del bcra/i.test(s.cat) ||
    /liquidez|\bpases?\b|LELIQ|LEBAC|NOBAC|NOTALIQ|LEFI|NOCOM|LEGAR|LEMIN|BOPREAL|LEDIV|redescuentos|pasivos monetarios|aceptaciones|entidades financieras locales|cr[eé]ditos del BCRA|adelantos transitorios/i.test(s.text)],
  ["depositos", (s) => /dep[oó]sitos/i.test(s.cat) || /dep[oó]sito|cajas? de ahorro|cuentas corrientes|plazo fijo|\bBODEN\b|cedros/i.test(s.name)],
  ["prestamos", (s) =>
    /pr[eé]stamos por l[ií]nea|titular y destino/i.test(s.cat) ||
    /personales|tarjetas? de cr[eé]dito|hipotec|prendar|documentos?|adelantos|en cuenta corriente|documentar|otros pr[eé]stamos/i.test(s.name)],
  ["credito", re(/pr[eé]stamos|cr[eé]dito|financiaci/i)],
];

/** Devuelve el slug del panel que corresponde a una serie (siempre devuelve uno). */
export function classifyPanel(s: ClassifiableSeries): string {
  const ctx = {
    cat: s.category ?? "",
    sub: s.subcategory ?? "",
    name: s.name ?? "",
    code: s.source_code ?? "",
    text: `${s.category ?? ""} | ${s.subcategory ?? ""} | ${s.name ?? ""}`,
  };
  const rules = s.source_id === "INDEC" ? INDEC_RULES : BCRA_RULES;
  for (const [panel, test] of rules) if (test(ctx)) return panel;
  return s.source_id === "INDEC" ? "actividad" : "monetarias";
}
