"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { SeriesPoint } from "@/lib/data/queries";

/** Mini gráfico de tendencia. Sin ejes ni tooltip: el valor exacto está al lado. */
export function Sparkline({ data, className }: { data: SeriesPoint[]; className?: string }) {
  if (data.length < 2) return <div className={className} />;
  return (
    <div className={className} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }} accessibilityLayer={false}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke="var(--chart-1)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
