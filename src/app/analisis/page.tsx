import { Suspense } from "react";
import { AnalysisBuilder } from "@/components/analysis/analysis-builder";
import { PageHeader } from "@/components/ui-kit/panel";

export const metadata = { title: "Análisis integrado" };

export default function AnalysisPage() {
  return (
    <>
      <PageHeader
        code="04 · ANL"
        title="Análisis integrado INDEC + BCRA"
        description="Combiná cualquier serie del catálogo, sin importar la institución. Las series se llevan a una frecuencia común (nunca se inventan datos), se transforman y se comparan en paneles con escalas independientes o en un mismo eje cuando las unidades son compatibles."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
        <AnalysisBuilder />
      </Suspense>
    </>
  );
}
