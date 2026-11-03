import { SourcePage } from "@/components/source-page";

export const metadata = { title: "INDEC" };

export default function IndecPage() {
  return (
    <SourcePage
      sourceId="INDEC"
      code="02 · IND"
      title="INDEC"
      description="Instituto Nacional de Estadística y Censos. Precios, actividad, PIB, salarios y comercio exterior, obtenidos de la API oficial de Series de Tiempo del Estado Nacional."
      headline={["calc.ipc_var_mensual", "indec.emae_desest", "indec.pib_real", "indec.exportaciones"]}
    />
  );
}
