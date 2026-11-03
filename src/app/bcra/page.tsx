import { SourceHome } from "@/components/source-panels";

export const metadata = { title: "Banco Central" };

export default function BcraPage({ searchParams }: PageProps<"/bcra">) {
  return (
    <SourceHome
      sourceId="BCRA"
      code="03 · BCR"
      title="Banco Central"
      description="Banco Central de la República Argentina. Las 1.610 series de la API de Estadísticas Monetarias v4.0, organizadas en 14 categorías: reservas, tipo de cambio, tasas, dinero, depósitos, crédito, índices de ajuste y sistema financiero."
      headline={["bcra.reservas", "bcra.tc_mayorista", "bcra.tamar", "bcra.base_monetaria"]}
      searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>}
    />
  );
}
