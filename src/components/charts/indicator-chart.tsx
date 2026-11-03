"use client";

import Link from "next/link";
import { useState } from "react";
import { DEFAULT_SPEC, specToSearchParams, type AnalysisSpec } from "@/lib/analysis/pipeline";
import type { Pt, SeriesData } from "@/lib/analysis/types";
import { SaveAnalysisButton } from "@/components/workspace/save-analysis";
import { AnalysisChart } from "./analysis-chart";

/** Gráfico interactivo de la ficha de un indicador. */
export function IndicatorChart({ series, ipc }: { series: SeriesData; ipc?: Pt[] }) {
  const [spec, setSpec] = useState<AnalysisSpec>({ ...DEFAULT_SPEC, ids: [series.meta.id] });
  const daily = series.meta.frequency === "D";
  return (
    <AnalysisChart
      data={[series]}
      ipc={ipc}
      spec={spec}
      onSpecChange={setSpec}
      title={series.meta.name}
      controls={{ transform: true, frequency: true, layout: false, exports: true, table: true }}
      defaultRange={daily ? "3A" : "10A"}
      height={320}
      footer={
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <SaveAnalysisButton spec={spec} defaultTitle={series.meta.name} kind="chart" />
          <Link
            href={`/analisis?${specToSearchParams(spec).toString()}`}
            className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-muted-foreground hover:border-amber/50 hover:text-foreground"
          >
            Combinar con otras series →
          </Link>
        </div>
      }
    />
  );
}
