import { Suspense } from "react";
import { EconometricsWorkbench } from "@/components/econ/workbench";
import { PageHeader } from "@/components/ui-kit/panel";

export const metadata = { title: "Econometría" };

export default function EconometricsPage() {
  return (
    <>
      <PageHeader
        code="06 · ECO"
        title="Econometría"
        description="Investigación cuantitativa con cualquier serie oficial del INDEC y el BCRA: estadística descriptiva, transformaciones reproducibles, correlaciones, regresiones con diagnósticos, raíz unitaria, ARIMA, VAR, cointegración, proyecciones con bandas de incertidumbre y backtesting. Los cálculos corren en tu navegador y están verificados contra statsmodels."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
        <EconometricsWorkbench />
      </Suspense>
    </>
  );
}
