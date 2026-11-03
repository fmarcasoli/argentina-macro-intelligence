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
];

export const DERIVED_SERIES: DerivedSeriesDef[] = [
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
