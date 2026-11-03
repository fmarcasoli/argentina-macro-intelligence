"use client";

import { AlertTriangle, Download, FileSpreadsheet, ImageDown, Info, Table2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Brush,
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
import { FREQ_NAME } from "@/lib/analysis/frequency";
import { runAnalysis, type AnalysisResult, type AnalysisSpec } from "@/lib/analysis/pipeline";
import { AGG_LABEL, TRANSFORM_LABEL, type Aggregation, type Pt, type SeriesData, type Transform } from "@/lib/analysis/types";
import { isNominalPesos } from "@/lib/analysis/units";
import type { Frequency } from "@/lib/connectors/types";
import { downloadCsv, downloadPng, downloadXlsx } from "@/lib/export";
import { formatNumber, isPercentUnit, periodLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Motor de gráficos de la plataforma. Recibe series reales (metadatos +
 * observaciones) y aplica, en el navegador, la misma canalización pura y
 * testeada que el resto del sistema (src/lib/analysis/pipeline.ts):
 * frecuencia común → transformación → validaciones → gráfico + tabla.
 *
 * - Superpone series solo si sus unidades resultantes son compatibles; si no,
 *   muestra paneles sincronizados con escalas independientes (nunca doble eje).
 * - Zoom con el navegador inferior; períodos predefinidos o personalizados.
 * - Exporta CSV, Excel (con hoja de metadatos) e imagen PNG.
 */

// Colores por posición fija en la selección (la serie conserva su color aunque cambie el filtro).
const HUES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];
export function seriesStyle(i: number) {
  return { color: HUES[i % HUES.length], dashed: i >= HUES.length };
}

const RANGES = [
  { id: "1A", years: 1 },
  { id: "3A", years: 3 },
  { id: "5A", years: 5 },
  { id: "10A", years: 10 },
  { id: "MAX", years: null },
] as const;

const MAX_RENDER_POINTS = 1500;
const toTs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface ChartControls {
  transform?: boolean;
  frequency?: boolean;
  layout?: boolean;
  exports?: boolean;
  table?: boolean;
}

export function AnalysisChart({
  data,
  ipc,
  spec,
  onSpecChange,
  title,
  controls = { transform: true, frequency: true, layout: true, exports: true, table: true },
  height = 320,
  defaultRange = "5A",
  footer,
}: {
  data: SeriesData[];
  ipc?: Pt[];
  spec: AnalysisSpec;
  onSpecChange: (s: AnalysisSpec) => void;
  title: string;
  controls?: ChartControls;
  height?: number;
  defaultRange?: (typeof RANGES)[number]["id"];
  footer?: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  // Período: si no hay from/to explícitos se aplica el rango predefinido, contado desde el último dato.
  const lastDate = useMemo(
    () => data.reduce<string | undefined>((m, s) => { const d = s.points.at(-1)?.d; return d && (!m || d > m) ? d : m; }, undefined),
    [data],
  );
  const [preset, setPreset] = useState<string | null>(spec.from || spec.to ? null : defaultRange);
  const presetFrom = useMemo(() => {
    const years = RANGES.find((r) => r.id === preset)?.years;
    if (!years || !lastDate || spec.from || spec.to) return undefined;
    return iso(toTs(lastDate) - years * 365.25 * 86_400_000);
  }, [preset, lastDate, spec.from, spec.to]);
  const effective = useMemo(() => ({ ...spec, from: spec.from ?? presetFrom }), [spec, presetFrom]);
  const result = useMemo(() => runAnalysis(data, effective, ipc), [data, effective, ipc]);
  const visibleRows = result.rows;

  const set = (patch: Partial<AnalysisSpec>) => onSpecChange({ ...spec, ...patch });
  const canReal = data.some((s) => isNominalPesos(s.meta.unit, s.meta.name));

  const runExport = async (kind: "csv" | "xlsx" | "png") => {
    setBusy(kind);
    try {
      const exported: AnalysisResult = { ...result, rows: visibleRows };
      if (kind === "csv") downloadCsv(exported, title);
      else if (kind === "xlsx") await downloadXlsx(exported, title, spec.transform);
      else if (captureRef.current) await downloadPng(captureRef.current, title);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Período">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setPreset(r.id);
                if (spec.from || spec.to) set({ from: undefined, to: undefined });
              }}
              aria-pressed={preset === r.id && !spec.from && !spec.to}
              className={cn(
                "num rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground",
                preset === r.id && !spec.from && !spec.to && "bg-secondary text-amber",
              )}
            >
              {r.id}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Desde
          <input
            type="date"
            value={spec.from ?? ""}
            onChange={(e) => {
              setPreset(null);
              set({ from: e.target.value || undefined });
            }}
            className="num h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Hasta
          <input
            type="date"
            value={spec.to ?? ""}
            onChange={(e) => {
              setPreset(null);
              set({ to: e.target.value || undefined });
            }}
            className="num h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          />
        </label>

        {controls.transform && (
          <Select
            label="Transformación"
            value={spec.transform}
            onChange={(v) => set({ transform: v as Transform })}
            options={(Object.keys(TRANSFORM_LABEL) as Transform[])
              .filter((t) => t !== "real" || canReal)
              .map((t) => ({ value: t, label: TRANSFORM_LABEL[t] }))}
          />
        )}
        {controls.transform && spec.transform === "index100" && (
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Base 100 en
            <input
              type="month"
              value={spec.baseDate?.slice(0, 7) ?? ""}
              onChange={(e) => set({ baseDate: e.target.value ? `${e.target.value}-01` : undefined })}
              className="num h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
              aria-label="Mes base del índice"
            />
            {spec.baseDate && (
              <button type="button" onClick={() => set({ baseDate: undefined })} className="hover:text-foreground" aria-label="Volver a la base al inicio del período">
                ×
              </button>
            )}
          </label>
        )}
        {controls.frequency && (
          <>
            <Select
              label="Frecuencia"
              value={spec.frequency}
              onChange={(v) => set({ frequency: v as AnalysisSpec["frequency"] })}
              options={[
                { value: "auto", label: `Automática (${FREQ_NAME[result.frequency]})` },
                ...(["D", "M", "Q", "S", "A"] as Frequency[]).map((f) => ({ value: f, label: FREQ_NAME[f][0].toUpperCase() + FREQ_NAME[f].slice(1) })),
              ]}
            />
            {result.series.some((s) => s.aggregation) && (
              <Select
                label="Agregación"
                value={spec.aggregation ?? "default"}
                onChange={(v) => set({ aggregation: v === "default" ? null : (v as Aggregation) })}
                options={[
                  { value: "default", label: "Según tipo de serie" },
                  ...(Object.keys(AGG_LABEL) as Aggregation[]).map((a) => ({ value: a, label: AGG_LABEL[a] })),
                ]}
              />
            )}
          </>
        )}
        {controls.layout && data.length > 1 && (
          <Select
            label="Disposición"
            value={spec.layout}
            onChange={(v) => set({ layout: v as AnalysisSpec["layout"] })}
            options={[
              { value: "auto", label: "Automática" },
              { value: "overlay", label: "Un eje (superpuestas)" },
              { value: "panels", label: "Paneles (escalas independientes)" },
            ]}
          />
        )}
        <div className="ml-auto flex items-center gap-1">
          {controls.table && (
            <IconButton onClick={() => setShowTable((v) => !v)} pressed={showTable} label="Tabla de datos">
              <Table2 className="size-3.5" />
            </IconButton>
          )}
          {controls.exports && (
            <>
              <IconButton onClick={() => runExport("csv")} label="Exportar CSV" busy={busy === "csv"}>
                <Download className="size-3.5" />
                <span className="text-[10px]">CSV</span>
              </IconButton>
              <IconButton onClick={() => runExport("xlsx")} label="Exportar Excel" busy={busy === "xlsx"}>
                <FileSpreadsheet className="size-3.5" />
                <span className="text-[10px]">XLSX</span>
              </IconButton>
              <IconButton onClick={() => runExport("png")} label="Exportar imagen" busy={busy === "png"}>
                <ImageDown className="size-3.5" />
                <span className="text-[10px]">PNG</span>
              </IconButton>
            </>
          )}
        </div>
      </div>

      {/* Gráfico (lo que se exporta como imagen) */}
      <div ref={captureRef} className="flex min-w-0 flex-col gap-2 bg-card">
        <ChartArea
          key={`${visibleRows[0]?.d}-${visibleRows.length}-${spec.transform}-${result.overlay}`}
          result={result}
          rows={visibleRows}
          height={height}
          title={title}
        />
        <p className="text-[10px] text-muted-foreground">
          Fuente: {[...new Set(result.series.map((s) => s.meta.source_id))].join(" y ")} · {TRANSFORM_LABEL[spec.transform]} · frecuencia{" "}
          {FREQ_NAME[result.frequency]} · Argentina Macro Intelligence
        </p>
      </div>

      <Notices result={result} />
      {showTable && <DataTable result={result} rows={visibleRows} />}
      {footer}
    </div>
  );
}

function ChartArea({
  result,
  rows,
  height,
  title,
}: {
  result: AnalysisResult;
  rows: AnalysisResult["rows"];
  height: number;
  title: string;
}) {
  // Zoom: ventana visible sobre las filas del período (controlada por el navegador inferior).
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const keyed = useMemo(
    () =>
      rows.map((r) => {
        const o: Record<string, number | null> = { ts: toTs(r.d) };
        r.values.forEach((v, i) => (o[`s${i}`] = v));
        return o;
      }),
    [rows],
  );
  const z = zoom && zoom.end < keyed.length ? zoom : { start: 0, end: Math.max(0, keyed.length - 1) };
  const windowed = useMemo(() => thin(keyed.slice(z.start, z.end + 1)), [keyed, z.start, z.end]);
  const simplified = z.end - z.start + 1 > MAX_RENDER_POINTS;

  if (rows.length === 0) {
    return (
      <div style={{ height }} className="grid place-items-center rounded border border-dashed border-border text-xs text-muted-foreground">
        Sin datos para el período y la transformación elegidos.
      </div>
    );
  }

  const series = result.series.map((s, i) => ({ ...s, key: `s${i}`, ...seriesStyle(i) }));
  const panels = result.overlay ? [series] : series.map((s) => [s]);
  const panelHeight = result.overlay ? height : Math.max(150, Math.round(height / Math.min(series.length, 3)) + 30);

  return (
    <div className="flex flex-col gap-1" aria-label={title}>
      {result.overlay && series.length > 1 && <Legend series={series} />}
      {panels.map((group, gi) => (
        <div key={gi} className="min-w-0">
          {!result.overlay && (
            <div className="flex min-w-0 items-center gap-2 text-[11px]">
              <LegendSwatch color={group[0].color} dashed={group[0].dashed} />
              <span className="truncate text-foreground">{group[0].meta.name}</span>
              <span className="num shrink-0 text-muted-foreground">{group[0].unit}</span>
            </div>
          )}
          {result.overlay && <div className="num text-[10px] text-muted-foreground">{group[0].unit}</div>}
          <div style={{ height: panelHeight }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={windowed} syncId="ami-analysis" margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  {...axisProps}
                  tickFormatter={(ts: number) => xTick(ts, windowed)}
                  ticks={ticksFor(windowed)}
                  hide={!result.overlay && gi < panels.length - 1}
                />
                <YAxis {...axisProps} width={60} domain={["auto", "auto"]} tickFormatter={yTick} />
                <Tooltip
                  content={(p: TooltipContentProps<TooltipValueType, number | string>) => (
                    <TooltipBody {...p} series={group} frequency={result.frequency} />
                  )}
                  cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                />
                {group.some((s) => s.unit === "%") && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />}
                {group.map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "6 4" : undefined}
                    dot={windowed.length < 40 ? { r: 2.5, strokeWidth: 0, fill: s.color } : false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}

      {/* Navegador para zoom */}
      {keyed.length > 12 && (
        <div className="h-14 w-full" data-html2canvas-ignore>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={thin(keyed)} margin={{ top: 0, right: 8, bottom: 0, left: 60 }}>
              <Area dataKey="s0" stroke="var(--chart-4)" fill="var(--chart-4)" fillOpacity={0.15} isAnimationActive={false} dot={false} />
              <Brush
                dataKey="ts"
                height={26}
                stroke="var(--amber)"
                fill="var(--card)"
                travellerWidth={8}
                tickFormatter={(ts: number) => iso(ts).slice(0, 7)}
                onChange={(r: { startIndex?: number; endIndex?: number }) => {
                  if (r.startIndex === undefined || r.endIndex === undefined) return;
                  const full = keyed.length;
                  const thinned = thin(keyed).length;
                  const scale = (full - 1) / Math.max(1, thinned - 1);
                  setZoom({ start: Math.round(r.startIndex * scale), end: Math.round(r.endIndex * scale) });
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {simplified && (
        <p className="text-[10px] text-muted-foreground">
          Vista simplificada para graficar ({formatNumber(z.end - z.start + 1, { decimals: 0 })} observaciones). La tabla y las exportaciones contienen todos los datos.
        </p>
      )}
    </div>
  );
}

/** Reduce puntos para el render conservando el primero y el último (los datos completos van a tabla y exportación). */
function thin<T>(rows: T[]): T[] {
  if (rows.length <= MAX_RENDER_POINTS) return rows;
  const step = Math.ceil(rows.length / MAX_RENDER_POINTS);
  const out = rows.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

const axisProps = {
  stroke: "var(--muted-foreground)",
  tick: { fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-plex-mono)" },
  tickLine: false,
  axisLine: false,
} as const;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function spanYears(rows: Record<string, number | null>[]) {
  if (rows.length < 2) return 0;
  return ((rows[rows.length - 1].ts as number) - (rows[0].ts as number)) / (365.25 * 86_400_000);
}

function ticksFor(rows: Record<string, number | null>[]) {
  if (rows.length < 2) return undefined;
  const yearly = spanYears(rows) > 3;
  const firsts: number[] = [];
  let last = "";
  for (const r of rows) {
    const d = new Date(r.ts as number);
    const k = yearly ? `${d.getUTCFullYear()}` : `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (k !== last) {
      firsts.push(r.ts as number);
      last = k;
    }
  }
  const step = Math.max(1, Math.ceil(firsts.length / 8));
  return firsts.filter((_, i) => i % step === 0);
}

function xTick(ts: number, rows: Record<string, number | null>[]) {
  const d = new Date(ts);
  return spanYears(rows) > 3 ? String(d.getUTCFullYear()) : `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

const yTick = (v: number) =>
  Math.abs(v) >= 1e6
    ? formatNumber(v, { compact: true })
    : new Intl.NumberFormat("es-AR", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 }).format(v);

type StyledSeries = AnalysisResult["series"][number] & { key: string; color: string; dashed: boolean };

function TooltipBody({
  active,
  payload,
  label,
  series,
  frequency,
}: TooltipContentProps<TooltipValueType, number | string> & { series: StyledSeries[]; frequency: Frequency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="max-w-xs rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
      <div className="num mb-1 text-muted-foreground">{periodLabel(iso(label as number), frequency)}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        const v = p?.value;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <LegendSwatch color={s.color} dashed={s.dashed} />
            {series.length > 1 && <span className="truncate text-muted-foreground">{s.meta.name}</span>}
            <span className="num ml-auto pl-3 whitespace-nowrap text-foreground">
              {v === null || v === undefined ? "s/d" : formatNumber(Number(v))}
              {isPercentUnit(s.unit) ? " %" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LegendSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-0.5 w-4 shrink-0 rounded"
      style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }}
    />
  );
}

function Legend({ series }: { series: StyledSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Leyenda">
      {series.map((s) => (
        <li key={s.key} className="flex min-w-0 items-center gap-1.5">
          <LegendSwatch color={s.color} dashed={s.dashed} />
          <span className="truncate">{s.meta.name}</span>
          <span className="num text-[10px] text-muted-foreground/70">{s.meta.source_id}</span>
        </li>
      ))}
    </ul>
  );
}

function Notices({ result }: { result: AnalysisResult }) {
  if (!result.notices.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-[11px]" aria-label="Advertencias del análisis">
      {result.notices.map((n, i) => (
        <li
          key={i}
          className={cn(
            "flex items-start gap-1.5 rounded border px-2 py-1",
            n.level === "warning" ? "border-warning/30 bg-warning/5 text-foreground" : "border-border text-muted-foreground",
          )}
        >
          {n.level === "warning" ? (
            <AlertTriangle className="mt-px size-3 shrink-0 text-warning" aria-label="Advertencia" />
          ) : (
            <Info className="mt-px size-3 shrink-0" aria-label="Información" />
          )}
          <span>{n.message}</span>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ result, rows }: { result: AnalysisResult; rows: AnalysisResult["rows"] }) {
  const LIMIT = 400;
  const shown = [...rows].reverse().slice(0, LIMIT);
  return (
    <div className="max-h-96 overflow-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-normal">Período</th>
            {result.series.map((s, i) => (
              <th key={i} className="px-2 py-1.5 text-right font-normal">
                <span className="line-clamp-2">{s.meta.name}</span>
                <span className="num block text-[10px] text-muted-foreground/70">{s.unit}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num">
          {shown.map((r) => (
            <tr key={r.d} className="border-b border-border/50 last:border-0">
              <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{periodLabel(r.d, result.frequency)}</td>
              {r.values.map((v, i) => (
                <td key={i} className="px-2 py-1 text-right">
                  {v === null ? <span className="text-muted-foreground/60">s/d</span> : formatNumber(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMIT && (
        <p className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          Se muestran los últimos {LIMIT} períodos de {formatNumber(rows.length, { decimals: 0 })}. Exportá CSV o Excel para ver todos.
        </p>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-7 max-w-52 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconButton({
  children,
  onClick,
  label,
  pressed,
  busy,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  pressed?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={busy}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-muted-foreground hover:border-amber/50 hover:text-foreground disabled:opacity-50",
        pressed && "border-amber/50 text-amber",
      )}
    >
      {children}
    </button>
  );
}
