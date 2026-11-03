import { SourcePage } from "@/components/source-page";

export const metadata = { title: "Banco Central" };

export default function BcraPage() {
  return (
    <SourcePage
      sourceId="BCRA"
      code="03 · BCR"
      title="Banco Central"
      description="Banco Central de la República Argentina. Reservas, tipo de cambio, base monetaria y agregados, tasas de interés e índices de ajuste (CER, UVA, ICL), desde la API de Estadísticas Monetarias v4.0."
      headline={["bcra.reservas", "bcra.tc_mayorista", "bcra.tamar", "bcra.cer"]}
    />
  );
}
