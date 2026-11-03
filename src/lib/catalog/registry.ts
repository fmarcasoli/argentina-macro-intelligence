import type { Frequency, SourceId } from "../connectors/types";
import type { Derivation } from "../normalize/derive";

/**
 * Series núcleo que la plataforma sincroniza automáticamente.
 *
 * Este archivo es solo la semilla inicial: el catálogo vive en la tabla
 * `indicators`. Para sumar una serie basta con agregar una entrada acá y
 * correr `npm run catalog:seed`, o marcar `is_tracked = true` en cualquier
 * serie ya descubierta (`npm run catalog:discover`). No hace falta tocar la
 * estructura de la base ni los conectores.
 *
 * Todos los códigos de origen fueron verificados contra las APIs el 2026-11-02.
 */
export interface SourceSeriesDef {
  id: string;
  sourceId: SourceId;
  sourceCode: string;
  name: string;
  category: string;
  subcategory?: string;
  /** Si se omite se toma de la fuente. */
  unit?: string;
  frequency: Frequency;
  /** 1 = valor original. Otro valor => se guarda como "normalized". */
  scale?: number;
  tags?: string[];
  note?: string;
}

export interface DerivedSeriesDef {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  unit: string;
  frequency: Frequency;
  /** Fuente institucional de los datos base. */
  sourceId: SourceId;
  derivation: Derivation;
  description: string;
  tags?: string[];
}

export const SOURCE_SERIES: SourceSeriesDef[] = [
  // ───────────────────────────── BCRA ─────────────────────────────
  { id: "bcra.reservas", sourceId: "BCRA", sourceCode: "1", name: "Reservas internacionales", category: "Sector externo", subcategory: "Reservas", frequency: "D", tags: ["headline"] },
  { id: "bcra.tc_mayorista", sourceId: "BCRA", sourceCode: "5", name: "Tipo de cambio mayorista de referencia (Com. A 3500)", category: "Tipo de cambio", subcategory: "Oficial", frequency: "D", tags: ["headline"] },
  { id: "bcra.tc_minorista", sourceId: "BCRA", sourceCode: "4", name: "Tipo de cambio minorista (promedio vendedor)", category: "Tipo de cambio", subcategory: "Oficial", frequency: "D" },
  { id: "bcra.banda_inferior", sourceId: "BCRA", sourceCode: "1187", name: "Banda cambiaria — límite inferior", category: "Tipo de cambio", subcategory: "Bandas", frequency: "D" },
  { id: "bcra.banda_superior", sourceId: "BCRA", sourceCode: "1188", name: "Banda cambiaria — límite superior", category: "Tipo de cambio", subcategory: "Bandas", frequency: "D" },
  { id: "bcra.base_monetaria", sourceId: "BCRA", sourceCode: "15", name: "Base monetaria", category: "Dinero", subcategory: "Base monetaria", frequency: "D", tags: ["headline"] },
  { id: "bcra.circulacion", sourceId: "BCRA", sourceCode: "16", name: "Circulación monetaria", category: "Dinero", subcategory: "Base monetaria", frequency: "D" },
  { id: "bcra.m1", sourceId: "BCRA", sourceCode: "1612", name: "M1 en moneda local", category: "Dinero", subcategory: "Agregados monetarios", frequency: "M" },
  { id: "bcra.m2", sourceId: "BCRA", sourceCode: "1618", name: "M2 en moneda local", category: "Dinero", subcategory: "Agregados monetarios", frequency: "M" },
  { id: "bcra.m3", sourceId: "BCRA", sourceCode: "1624", name: "M3 en moneda local", category: "Dinero", subcategory: "Agregados monetarios", frequency: "M" },
  { id: "bcra.m2_diario", sourceId: "BCRA", sourceCode: "109", name: "M2 (diario)", category: "Dinero", subcategory: "Agregados monetarios", frequency: "D" },
  { id: "bcra.m2_privado_yoy", sourceId: "BCRA", sourceCode: "25", name: "M2 privado — var. i.a. promedio móvil 30 días", category: "Dinero", subcategory: "Agregados monetarios", frequency: "D" },
  { id: "bcra.m2_transaccional", sourceId: "BCRA", sourceCode: "197", name: "M2 transaccional del sector privado", category: "Dinero", subcategory: "Agregados monetarios", frequency: "D" },
  { id: "bcra.depositos_privados_pesos", sourceId: "BCRA", sourceCode: "100", name: "Depósitos del sector privado en pesos (incluye CEDROS)", category: "Depósitos", subcategory: "Sector privado", frequency: "D" },
  { id: "bcra.depositos_privados_usd", sourceId: "BCRA", sourceCode: "108", name: "Depósitos del sector privado en dólares", category: "Depósitos", subcategory: "Sector privado", frequency: "D" },
  { id: "bcra.prestamos_privados_usd", sourceId: "BCRA", sourceCode: "125", name: "Préstamos al sector privado en dólares", category: "Crédito", subcategory: "Préstamos", frequency: "D" },
  { id: "bcra.prestamos_personales", sourceId: "BCRA", sourceCode: "114", name: "Préstamos personales al sector privado (pesos)", category: "Crédito", subcategory: "Préstamos por línea", frequency: "D" },
  { id: "bcra.prestamos_tarjetas", sourceId: "BCRA", sourceCode: "115", name: "Préstamos con tarjetas de crédito al sector privado (pesos)", category: "Crédito", subcategory: "Préstamos por línea", frequency: "D" },
  { id: "bcra.prestamos_hipotecarios", sourceId: "BCRA", sourceCode: "112", name: "Préstamos hipotecarios al sector privado (pesos)", category: "Crédito", subcategory: "Préstamos por línea", frequency: "D" },
  { id: "bcra.liquidez_pesos", sourceId: "BCRA", sourceCode: "1221", name: "Liquidez en pesos de las entidades financieras (% de depósitos)", category: "Sistema financiero", subcategory: "Liquidez", frequency: "D" },
  { id: "bcra.prestamos_privados", sourceId: "BCRA", sourceCode: "26", name: "Préstamos al sector privado", category: "Crédito", subcategory: "Préstamos", frequency: "D" },
  { id: "bcra.cer", sourceId: "BCRA", sourceCode: "30", name: "CER (base 2.2.02=1)", category: "Índices de ajuste", subcategory: "CER/UVA", frequency: "D", tags: ["headline"] },
  { id: "bcra.uva", sourceId: "BCRA", sourceCode: "31", name: "UVA (base 31.3.16=14,05)", category: "Índices de ajuste", subcategory: "CER/UVA", frequency: "D" },
  { id: "bcra.uvi", sourceId: "BCRA", sourceCode: "32", name: "UVI (base 31.3.16=14,05)", category: "Índices de ajuste", subcategory: "CER/UVA", frequency: "D" },
  { id: "bcra.icl", sourceId: "BCRA", sourceCode: "40", name: "Índice para Contratos de Locación", category: "Índices de ajuste", subcategory: "ICL", frequency: "D" },
  { id: "bcra.badlar", sourceId: "BCRA", sourceCode: "7", name: "Tasa BADLAR bancos privados (TNA)", category: "Tasas de interés", subcategory: "Pasivas", frequency: "D", tags: ["headline"] },
  { id: "bcra.tamar", sourceId: "BCRA", sourceCode: "44", name: "Tasa TAMAR bancos privados (TNA)", category: "Tasas de interés", subcategory: "Pasivas", frequency: "D" },
  { id: "bcra.tm20", sourceId: "BCRA", sourceCode: "8", name: "Tasa TM20 bancos privados (TNA)", category: "Tasas de interés", subcategory: "Pasivas", frequency: "D" },
  { id: "bcra.plazo_fijo_30d", sourceId: "BCRA", sourceCode: "12", name: "Tasa de depósitos a 30 días (TNA)", category: "Tasas de interés", subcategory: "Pasivas", frequency: "D" },
  { id: "bcra.baibar", sourceId: "BCRA", sourceCode: "11", name: "Tasa BAIBAR interbancaria (TNA)", category: "Tasas de interés", subcategory: "Interbancarias", frequency: "D" },
  { id: "bcra.pases_terceros_1d", sourceId: "BCRA", sourceCode: "150", name: "Tasa de pases entre terceros a 1 día (TNA)", category: "Tasas de interés", subcategory: "Interbancarias", frequency: "D" },
  { id: "bcra.adelantos", sourceId: "BCRA", sourceCode: "13", name: "Tasa de adelantos en cuenta corriente (TNA)", category: "Tasas de interés", subcategory: "Activas", frequency: "D" },
  { id: "bcra.personales", sourceId: "BCRA", sourceCode: "14", name: "Tasa de préstamos personales (TNA)", category: "Tasas de interés", subcategory: "Activas", frequency: "D" },
  { id: "bcra.tasa_politica", sourceId: "BCRA", sourceCode: "160", name: "Tasa de política monetaria (TNA)", category: "Tasas de interés", subcategory: "Política monetaria", frequency: "D", note: "Sin datos desde 2025-07-10 (fin del esquema de tasa de política vía LEFI)." },
  { id: "bcra.inflacion_mensual", sourceId: "BCRA", sourceCode: "27", name: "Inflación mensual (publicada por BCRA)", category: "Precios", subcategory: "Inflación", frequency: "M" },
  { id: "bcra.inflacion_interanual", sourceId: "BCRA", sourceCode: "28", name: "Inflación interanual (publicada por BCRA)", category: "Precios", subcategory: "Inflación", frequency: "M" },
  { id: "bcra.rem_inflacion_12m", sourceId: "BCRA", sourceCode: "29", name: "REM — inflación esperada próximos 12 meses (mediana)", category: "Expectativas", subcategory: "REM", frequency: "M" },

  // ───────────────────────────── INDEC ────────────────────────────
  { id: "indec.ipc_nivel_general", sourceId: "INDEC", sourceCode: "148.3_INIVELNAL_DICI_M_26", name: "IPC Nivel General Nacional (dic-2016=100)", category: "Precios", subcategory: "IPC", unit: "Índice dic-2016=100", frequency: "M", tags: ["headline"] },
  { id: "indec.ipc_nucleo", sourceId: "INDEC", sourceCode: "148.3_INUCLEONAL_DICI_M_19", name: "IPC Núcleo Nacional (dic-2016=100)", category: "Precios", subcategory: "IPC", unit: "Índice dic-2016=100", frequency: "M" },
  { id: "indec.ipc_regulados", sourceId: "INDEC", sourceCode: "148.3_IREGULANAL_DICI_M_22", name: "IPC Regulados Nacional (dic-2016=100)", category: "Precios", subcategory: "IPC", unit: "Índice dic-2016=100", frequency: "M" },
  { id: "indec.ipc_var_mensual", sourceId: "INDEC", sourceCode: "145.3_INGNACUAL_DICI_M_38", name: "IPC Nivel General — variación mensual (publicada)", category: "Precios", subcategory: "IPC", unit: "%", frequency: "M", scale: 100, note: "La API publica la variación como proporción (0,0166). Se normaliza a porcentaje (×100)." },
  { id: "indec.emae", sourceId: "INDEC", sourceCode: "143.3_NO_PR_2004_A_21", name: "EMAE — serie original (2004=100)", category: "Actividad", subcategory: "EMAE", frequency: "M" },
  { id: "indec.emae_desest", sourceId: "INDEC", sourceCode: "143.3_NO_PR_2004_A_31", name: "EMAE — desestacionalizado (2004=100)", category: "Actividad", subcategory: "EMAE", frequency: "M", tags: ["headline"] },
  { id: "indec.pib_real", sourceId: "INDEC", sourceCode: "4.2_OGP_2004_T_17", name: "PIB a precios constantes de 2004", category: "Actividad", subcategory: "PIB", frequency: "Q", tags: ["headline"] },
  { id: "indec.pib_nominal", sourceId: "INDEC", sourceCode: "166.2_PPIB_0_0_3", name: "PIB a precios corrientes", category: "Actividad", subcategory: "PIB", frequency: "Q" },
  { id: "indec.consumo_publico_real", sourceId: "INDEC", sourceCode: "4.2_DGCP_2004_T_30", name: "Consumo público a precios de 2004", category: "Actividad", subcategory: "PIB — demanda", frequency: "Q" },
  { id: "indec.salarios", sourceId: "INDEC", sourceCode: "149.1_TL_INDIIOS_OCTU_0_21", name: "Índice de salarios — total (oct-2016=100)", category: "Empleo e ingresos", subcategory: "Salarios", unit: "Índice oct-2016=100", frequency: "M", tags: ["headline"] },
  { id: "indec.salarios_registrado", sourceId: "INDEC", sourceCode: "149.1_TL_REGIADO_OCTU_0_16", name: "Índice de salarios — registrado (oct-2016=100)", category: "Empleo e ingresos", subcategory: "Salarios", unit: "Índice oct-2016=100", frequency: "M" },
  { id: "indec.salarios_privado_reg", sourceId: "INDEC", sourceCode: "149.1_SOR_PRIADO_OCTU_0_25", name: "Índice de salarios — privado registrado (oct-2016=100)", category: "Empleo e ingresos", subcategory: "Salarios", unit: "Índice oct-2016=100", frequency: "M" },
  { id: "indec.salarios_publico", sourceId: "INDEC", sourceCode: "149.1_SOR_PUBICO_OCTU_0_14", name: "Índice de salarios — sector público (oct-2016=100)", category: "Empleo e ingresos", subcategory: "Salarios", unit: "Índice oct-2016=100", frequency: "M" },
  { id: "indec.exportaciones", sourceId: "INDEC", sourceCode: "74.3_IET_0_M_16", name: "Exportaciones totales", category: "Sector externo", subcategory: "Comercio exterior", frequency: "M", tags: ["headline"] },
  { id: "indec.importaciones", sourceId: "INDEC", sourceCode: "74.3_IIT_0_M_25", name: "Importaciones totales", category: "Sector externo", subcategory: "Comercio exterior", frequency: "M" },
  { id: "indec.saldo_comercial", sourceId: "INDEC", sourceCode: "74.3_ISC_0_M_19", name: "Saldo comercial", category: "Sector externo", subcategory: "Comercio exterior", frequency: "M" },
  { id: "indec.desempleo", sourceId: "INDEC", sourceCode: "45.2_ECTDT_0_T_33", name: "Tasa de desocupación — total 31 aglomerados (EPH)", category: "Empleo e ingresos", subcategory: "Mercado laboral", unit: "%", frequency: "Q", scale: 100, note: "La API publica la tasa como proporción (0,079). Se normaliza a porcentaje (×100).", tags: ["headline"] },
  { id: "indec.tasa_empleo", sourceId: "INDEC", sourceCode: "44.2_ECTET_0_T_30", name: "Tasa de empleo — total 31 aglomerados (EPH)", category: "Empleo e ingresos", subcategory: "Mercado laboral", unit: "%", frequency: "Q", scale: 100, note: "La API publica la tasa como proporción (0,079). Se normaliza a porcentaje (×100)." },
  { id: "indec.tasa_actividad", sourceId: "INDEC", sourceCode: "43.2_ECTAT_0_T_33", name: "Tasa de actividad — total 31 aglomerados (EPH)", category: "Empleo e ingresos", subcategory: "Mercado laboral", unit: "%", frequency: "Q", scale: 100, note: "La API publica la tasa como proporción (0,079). Se normaliza a porcentaje (×100)." },
  { id: "indec.pobreza", sourceId: "INDEC", sourceCode: "64.2_POBLACION_NUA_0_0_34_74", name: "Población bajo la línea de pobreza — total aglomerados (EPH)", category: "Empleo e ingresos", subcategory: "Pobreza", unit: "% de personas", frequency: "S", scale: 100, note: "La API publica el porcentaje como proporción (0,323). Se normaliza a porcentaje (×100).", tags: ["headline"] },
  { id: "indec.gini", sourceId: "INDEC", sourceCode: "65.1_CGI_0_0_21", name: "Coeficiente de Gini del ingreso per cápita familiar", category: "Empleo e ingresos", subcategory: "Distribución del ingreso", frequency: "Q" },
  { id: "indec.isac", sourceId: "INDEC", sourceCode: "33.2_ISAC_NIVELRAL_0_M_18_63", name: "ISAC — nivel general (2004=100)", category: "Actividad", subcategory: "Construcción", frequency: "M" },
  { id: "indec.isac_desest", sourceId: "INDEC", sourceCode: "33.2_ISAC_SIN_EDAD_0_M_23_56", name: "ISAC — desestacionalizado (2004=100)", category: "Actividad", subcategory: "Construcción", frequency: "M" },
  { id: "indec.ipi_manufacturero", sourceId: "INDEC", sourceCode: "453.1_SERIE_ORIGNAL_0_0_14_46", name: "IPI manufacturero — nivel general (2004=100)", category: "Actividad", subcategory: "Industria", frequency: "M" },
  { id: "indec.ipi_manufacturero_desest", sourceId: "INDEC", sourceCode: "453.1_SERIE_DESEADA_0_0_24_58", name: "IPI manufacturero — desestacionalizado (2004=100)", category: "Actividad", subcategory: "Industria", frequency: "M" },
  { id: "indec.ventas_supermercados", sourceId: "INDEC", sourceCode: "455.1_VENTAS_TOTNTA_0_M_26_88", name: "Ventas totales en supermercados (precios corrientes)", category: "Actividad", subcategory: "Estadísticas sectoriales", frequency: "M" },
  { id: "indec.poblacion", sourceId: "INDEC", sourceCode: "9.2_P_2004_T_9", name: "Población de Argentina", category: "Actividad", subcategory: "Demografía", frequency: "Q" },
  { id: "indec.pib_per_capita_usd", sourceId: "INDEC", sourceCode: "9.2_PPCDC_2004_T_33", name: "PIB per cápita en dólares corrientes", category: "Actividad", subcategory: "PIB", frequency: "Q" },
  { id: "indec.viajeros", sourceId: "INDEC", sourceCode: "457.1_VIAJEROS_TLES_0_M_16_50", name: "Viajeros hospedados — total (Encuesta de Ocupación Hotelera)", category: "Actividad", subcategory: "Turismo", frequency: "M" },
  { id: "indec.pernoctaciones", sourceId: "INDEC", sourceCode: "457.1_PERNOCTACILES_0_M_22_51", name: "Pernoctaciones — total (Encuesta de Ocupación Hotelera)", category: "Actividad", subcategory: "Turismo", frequency: "M" },
];

export const DERIVED_SERIES: DerivedSeriesDef[] = [
  {
    id: "calc.ipc_var_acumulada",
    sourceId: "INDEC",
    name: "Inflación acumulada en el año (calculada desde IPC)",
    category: "Precios",
    subcategory: "IPC",
    unit: "%",
    frequency: "M",
    derivation: { op: "ytd_change", base: "indec.ipc_nivel_general" },
    description: "Variación porcentual del IPC Nivel General Nacional respecto de diciembre del año anterior: (IPC_t / IPC_dic(t-1) − 1) × 100.",
    tags: ["headline"],
  },
  {
    id: "calc.salarios_reales",
    sourceId: "INDEC",
    name: "Salario real — índice de salarios deflactado por IPC (dic-2016=100)",
    category: "Empleo e ingresos",
    subcategory: "Salarios",
    unit: "Índice dic-2016=100",
    frequency: "M",
    derivation: { op: "deflate", nominal: "indec.salarios", deflator: "indec.ipc_nivel_general", base: "2016-12-01" },
    description: "Índice de salarios total dividido por el IPC Nivel General Nacional, ambos llevados a base diciembre 2016 = 100: (W_t / W_base) / (IPC_t / IPC_base) × 100.",
    tags: ["headline"],
  },
  {
    id: "calc.salarios_reales_var_interanual",
    sourceId: "INDEC",
    name: "Salario real — variación interanual (calculada)",
    category: "Empleo e ingresos",
    subcategory: "Salarios",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "calc.salarios_reales", lag: 12 },
    description: "Variación interanual del salario real (índice de salarios deflactado por IPC).",
  },
  {
    id: "calc.ipc_var_mensual",
    sourceId: "INDEC",
    name: "Inflación mensual (calculada desde IPC)",
    category: "Precios",
    subcategory: "IPC",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "indec.ipc_nivel_general", lag: 1 },
    description: "Variación porcentual mensual del IPC Nivel General Nacional: (IPC_t / IPC_t-1 − 1) × 100.",
    tags: ["headline"],
  },
  {
    id: "calc.ipc_var_interanual",
    sourceId: "INDEC",
    name: "Inflación interanual (calculada desde IPC)",
    category: "Precios",
    subcategory: "IPC",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "indec.ipc_nivel_general", lag: 12 },
    description: "Variación porcentual interanual del IPC Nivel General Nacional: (IPC_t / IPC_t-12 − 1) × 100.",
    tags: ["headline"],
  },
  {
    id: "calc.ipc_nucleo_var_mensual",
    sourceId: "INDEC",
    name: "Inflación núcleo mensual (calculada)",
    category: "Precios",
    subcategory: "IPC",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "indec.ipc_nucleo", lag: 1 },
    description: "Variación porcentual mensual del IPC Núcleo Nacional.",
  },
  {
    id: "calc.emae_var_interanual",
    sourceId: "INDEC",
    name: "EMAE — variación interanual (calculada)",
    category: "Actividad",
    subcategory: "EMAE",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "indec.emae", lag: 12 },
    description: "Variación interanual de la serie original del EMAE.",
  },
  {
    id: "calc.emae_desest_var_mensual",
    sourceId: "INDEC",
    name: "EMAE desestacionalizado — variación mensual (calculada)",
    category: "Actividad",
    subcategory: "EMAE",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "indec.emae_desest", lag: 1 },
    description: "Variación mensual del EMAE desestacionalizado.",
  },
  {
    id: "calc.pib_real_var_interanual",
    sourceId: "INDEC",
    name: "PIB real — variación interanual (calculada)",
    category: "Actividad",
    subcategory: "PIB",
    unit: "%",
    frequency: "Q",
    derivation: { op: "pct_change", base: "indec.pib_real", lag: 4 },
    description: "Variación interanual del PIB a precios constantes de 2004 (trimestre contra mismo trimestre del año anterior).",
  },
  {
    id: "calc.salarios_var_interanual",
    sourceId: "INDEC",
    name: "Índice de salarios — variación interanual (calculada)",
    category: "Empleo e ingresos",
    subcategory: "Salarios",
    unit: "%",
    frequency: "M",
    derivation: { op: "pct_change", base: "indec.salarios", lag: 12 },
    description: "Variación interanual del índice de salarios total.",
  },
];
