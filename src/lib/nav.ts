export type SectionStatus = "ready" | "construction";

export interface NavSection {
  href: string;
  label: string;
  short: string;
  icon:
    | "overview" | "indec" | "bcra" | "integrated" | "builder" | "econometrics"
    | "simulator" | "calculators" | "ai" | "reports" | "favorites" | "settings";
  status: SectionStatus;
  description: string;
  /** Funcionalidades previstas (para las secciones en construcción). */
  planned?: string[];
}

export const NAV_SECTIONS: NavSection[] = [
  { href: "/", label: "Dashboard", short: "DSH", icon: "overview", status: "ready", description: "Dashboard ejecutivo con los indicadores clave de la economía argentina." },
  { href: "/indec", label: "INDEC", short: "IND", icon: "indec", status: "ready", description: "Series del Instituto Nacional de Estadística y Censos: precios, actividad, salarios y comercio exterior." },
  { href: "/bcra", label: "Banco Central", short: "BCR", icon: "bcra", status: "ready", description: "Series del BCRA: reservas, tipo de cambio, agregados monetarios, tasas e índices de ajuste." },
  {
    href: "/analisis", label: "Análisis integrado", short: "ANL", icon: "integrated", status: "ready",
    description: "Constructor de análisis: cualquier serie del catálogo INDEC y BCRA en un mismo gráfico, con transformaciones y frecuencia común.",
  },
  {
    href: "/constructor", label: "Constructor de indicadores", short: "CON", icon: "builder", status: "construction",
    description: "Creación de indicadores propios a partir de fórmulas sobre series oficiales.",
    planned: ["Editor de fórmulas sobre el catálogo", "Guardado en análisis del usuario", "Trazabilidad completa hasta la fuente"],
  },
  {
    href: "/econometria", label: "Econometría", short: "ECO", icon: "econometrics", status: "ready",
    description: "Estadística, correlaciones, regresiones, raíz unitaria, ARIMA, VAR, cointegración, proyecciones y backtesting sobre cualquier serie del catálogo.",
  },
  {
    href: "/simulador", label: "Simulador macroeconómico", short: "SIM", icon: "simulator", status: "ready",
    description: "Simulaciones aritméticas, escenarios definidos por el usuario y shocks en un modelo VAR estimado con datos oficiales.",
  },
  {
    href: "/calculadoras", label: "Calculadoras económicas", short: "CAL", icon: "calculators", status: "ready",
    description: "Inflación, tasas reales, devaluación, salarios reales y agregados monetarios reales con datos oficiales.",
  },
  {
    href: "/macro-ai", label: "MACRO AI", short: "AI", icon: "ai", status: "ready",
    description: "Asistente de investigación con acceso controlado a las series, cálculos, econometría, gráficos e informes. Modelo local gratuito (Ollama) o modo sin modelo.",
  },
  {
    href: "/reportes", label: "Reportes", short: "REP", icon: "reports", status: "ready",
    description: "Informes automáticos con gráficos, tablas e indicadores, exportables a PDF, Excel y CSV.",
  },
  {
    href: "/favoritos", label: "Favoritos", short: "FAV", icon: "favorites", status: "ready",
    description: "Series favoritas y análisis guardados del espacio de trabajo.",
  },
  { href: "/configuracion", label: "Configuración", short: "CFG", icon: "settings", status: "ready", description: "Estado de las fuentes, sincronizaciones, errores y preferencias." },
];

export function findSection(href: string): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.href === href);
}
