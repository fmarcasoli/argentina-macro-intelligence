import { ReportsView } from "@/components/ai/reports-view";
import { PageHeader } from "@/components/ui-kit/panel";

export const metadata = { title: "Reportes" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        code="10 · REP"
        title="Informes automáticos"
        description="Informes diario, mensual, de inflación, monetario, cambiario, de reservas, de actividad, de salarios reales y personalizados, con gráficos, tablas e indicadores calculados con datos oficiales. Se exportan a PDF, Excel y CSV. No requieren inteligencia artificial."
      />
      <ReportsView />
    </>
  );
}
