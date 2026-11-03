import { SourceHome } from "@/components/source-panels";

export const metadata = { title: "INDEC" };

export default function IndecPage({ searchParams }: PageProps<"/indec">) {
  return (
    <SourceHome
      sourceId="INDEC"
      code="02 · IND"
      title="INDEC"
      description="Instituto Nacional de Estadística y Censos. Más de 10.000 series de la API oficial de Series de Tiempo, organizadas en 12 categorías. Cada serie tiene su ficha con gráfico histórico, tabla de observaciones y metodología."
      headline={["calc.ipc_var_mensual", "indec.emae_desest", "indec.desempleo", "indec.pobreza"]}
      searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>}
    />
  );
}
