"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import type { Frequency } from "@/lib/connectors/types";
import type { SeriesPoint } from "@/lib/data/queries";
import { formatNumber, periodLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ChartSeries {
  key: string;
  label: string;
  points: SeriesPoint[];
  /** Variable CSS del color (por slot fijo, nunca por posición en pantalla). */
  color?: string;
  dashed?: boolean;
}

const RANGES = [
  { id: "1A", years: 1 },
  { id: "3A", years: 3 },
  { id: "5A", years: 5 },
  { id: "10A", years: 10 },
  { id: "MAX", years: null },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const SLOT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];

function toTs(iso: string) {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function TimeSeriesChart({
  series,
  frequency,
  unit,
  kind = "line",
  height = 260,
  defaultRange = "5A",
  showRangeSelector = true,
  zeroLine,
}: {
  series: ChartSeries[];
  frequency: Frequency;
  unit?: string;
  kind?: "line" | "bar";
  height?: number;
  defaultRange?: RangeId;
  showRangeSelector?: boolean;
  zeroLine?: boolean;
}) {
  const [range, setRange] = useState<RangeId>(defaultRange);

  const data = useMemo(() => {
    const lastTs = Math.max(...series.flatMap((s) => s.points.map((p) => toTs(p.d))));
    const years = RANGES.find((r) => r.id === range)?.years ?? null;
    const minTs = years && Number.isFinite(lastTs) ? lastTs - years * 365.25 * 86_400_000 : -Infinity;
    const rows = new Map<number, Record<string, number | null>>();
    for (const s of series) {
      for (const p of s.points) {
        const ts = toTs(p.d);
        if (ts < minTs) continue;
        const row = rows.get(ts) ?? { ts };
        row[s.key] = p.v;
        rows.set(ts, row);
      }
    }
    return [...rows.values()].sort((a, b) => (a.ts as number) - (b.ts as number));
  }, [series, range]);

  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SLOT_COLORS[i % SLOT_COLORS.length] }));
  const empty = data.length === 0;

  // Marcas del eje X: primer dato de cada año (rangos largos) o de cada mes (rangos cortos), espaciadas para no superponerse.
  const { ticks, yearly } = useMemo(() => {
    if (data.length < 2) return { ticks: undefined as number[] | undefined, yearly: false };
    const span = ((data[data.length - 1].ts as number) - (data[0].ts as number)) / (365.25 * 86_400_000);
    const yearly = span > 3;
    const firsts: number[] = [];
    let lastKey = "";
    for (const row of data) {
      const d = new Date(row.ts as number);
      const key = yearly ? `${d.getUTCFullYear()}` : `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (key !== lastKey) {
        firsts.push(row.ts as number);
        lastKey = key;
      }
    }
    const step = Math.max(1, Math.ceil(firsts.length / 8));
    return { ticks: firsts.filter((_, i) => i % step === 0), yearly };
  }, [data]);

  const xTick = (ts: number) => {
    const d = new Date(ts);
    const m = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][d.getUTCMonth()];
    return yearly ? String(d.getUTCFullYear()) : `${m} ${String(d.getUTCFullYear()).slice(2)}`;
  };

  const yTick = (v: number) =>
    Math.abs(v) >= 1e6
      ? formatNumber(v, { compact: true })
      : new Intl.NumberFormat("es-AR", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 }).format(v);

  const TooltipBody = ({ active, payload, label }: TooltipContentProps<TooltipValueType, number | string>) => {
    if (!active || !payload?.length) return null;
    const iso = new Date(label as number).toISOString().slice(0, 10);
    return (
      <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
        <div className="num mb-1 text-muted-foreground">{periodLabel(iso, frequency)}</div>
        {payload.map((p) => {
          const s = colored.find((c) => c.key === p.dataKey);
          return (
            <div key={String(p.dataKey)} className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s?.color }} />
              {colored.length > 1 && <span className="text-muted-foreground">{s?.label}</span>}
              <span className="num ml-auto pl-3 text-foreground">
                {p.value === null || p.value === undefined ? "s/d" : formatNumber(Number(p.value))}
                {unit && /%/.test(unit) ? " %" : ""}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const axisProps = {
    stroke: "var(--muted-foreground)",
    tick: { fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-plex-mono)" },
    tickLine: false,
    axisLine: false,
  } as const;

  return (
    <div className="flex flex-col gap-2">
      {(showRangeSelector || colored.length > 1) && (
        <div className="flex flex-wrap items-center gap-3">
          {colored.length > 1 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Leyenda">
              {colored.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-4 rounded"
                    style={{
                      background: s.dashed ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` : s.color,
                    }}
                  />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          {showRangeSelector && (
            <div className="ml-auto flex rounded-md border border-border p-0.5" role="group" aria-label="Rango temporal">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  aria-pressed={range === r.id}
                  className={cn(
                    "num rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground",
                    range === r.id && "bg-secondary text-amber",
                  )}
                >
                  {r.id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ height }} className="w-full">
        {empty ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">Sin datos para el rango</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {kind === "bar" ? (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="ts" {...axisProps} tickFormatter={xTick} ticks={ticks} interval={0} />
                <YAxis {...axisProps} width={56} tickFormatter={yTick} />
                <Tooltip content={TooltipBody} cursor={{ fill: "var(--accent)", opacity: 0.6 }} />
                {zeroLine && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
                {colored.map((s) => (
                  <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  {...axisProps}
                  tickFormatter={xTick}
                  ticks={ticks}
                />
                <YAxis {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={yTick} />
                <Tooltip
                  content={TooltipBody}
                  cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                />
                {zeroLine && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
                {colored.map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={s.dashed ? 1.5 : 2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
