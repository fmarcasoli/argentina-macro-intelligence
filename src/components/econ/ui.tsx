"use client";

import { AlertTriangle, Download, FileSpreadsheet, ImageDown, Info, Loader2, Play } from "lucide-react";
import { useRef } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { downloadPng, downloadTableCsv, downloadTablesXlsx, type ExportSheet } from "@/lib/export";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Formato ─────────────────────────────────────────────────────────────────

/** Número con decimales significativos razonables para resultados estadísticos. */
export function fmt(v: number | null | undefined, decimals?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  if (decimals !== undefined) return formatNumber(v, { decimals });
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return formatNumber(v, { decimals: 0 });
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e7)) return v.toExponential(3).replace(".", ",");
  return formatNumber(v, { decimals: a >= 1000 ? 1 : a >= 10 ? 3 : 4 });
}

/** p-valor con su nivel de significancia. */
export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  const s = p < 1e-4 ? "< 0,0001" : formatNumber(p, { decimals: 4 });
  return `${s}${p < 0.01 ? " ***" : p < 0.05 ? " **" : p < 0.1 ? " *" : ""}`;
}

export const SIG_NOTE = "Significancia: *** p < 0,01 · ** p < 0,05 · * p < 0,10.";

// ── Contenedores y formularios ──────────────────────────────────────────────

export function Card({ title, children, className, actions }: { title: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-card p-3", className)}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="label-caps text-[10px] text-muted-foreground">{title}</h2>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs", className)}>
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

export const inputCls = "num h-8 w-full min-w-0 rounded border border-border bg-background px-2 text-xs";
export const selectCls = "h-8 w-full min-w-0 rounded border border-border bg-background px-1.5 text-xs";

export function RunButton({ busy, onClick, label = "Calcular", disabled }: { busy: boolean; onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex h-8 items-center gap-1.5 self-end rounded border border-amber/60 bg-amber/10 px-3 text-xs font-medium text-foreground hover:bg-amber/20 disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
      {busy ? "Calculando…" : label}
    </button>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded border border-negative/30 bg-negative/5 p-2 text-xs">
      {message}
    </p>
  );
}

export function Notices({ warnings = [], infos = [] }: { warnings?: string[]; infos?: string[] }) {
  if (!warnings.length && !infos.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {warnings.map((w, i) => (
        <li key={`w${i}`} className="flex gap-1.5 rounded border border-amber/30 bg-amber/5 px-2 py-1.5 text-[11px] leading-snug">
          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber" aria-hidden />
          <span>{w}</span>
        </li>
      ))}
      {infos.map((w, i) => (
        <li key={`i${i}`} className="flex gap-1.5 px-2 py-0.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded border border-border/60 p-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("num truncate", strong ? "text-lg font-medium" : "text-sm")}>{value}</span>
      {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
    </div>
  );
}

// ── Tablas exportables ──────────────────────────────────────────────────────

export function ResultTable({
  sheet,
  title,
  methodology = [],
  maxRows,
  highlight,
}: {
  sheet: ExportSheet;
  title: string;
  methodology?: string[];
  maxRows?: number;
  highlight?: (row: ExportSheet["rows"][number]) => boolean;
}) {
  const rows = maxRows ? sheet.rows.slice(0, maxRows) : sheet.rows;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex justify-end gap-1">
        <ExportButtons title={title} sheets={[sheet]} methodology={methodology} />
      </div>
      <div className="max-h-[420px] overflow-auto rounded border border-border/60">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {sheet.header.map((h, i) => (
                <th key={i} className={cn("border-b border-border px-2 py-1.5 font-medium text-muted-foreground", i === 0 ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn("border-b border-border/40", highlight?.(r) && "bg-amber/5")}>
                {r.map((v, j) => (
                  <td key={j} className={cn("px-2 py-1", j === 0 ? "text-left" : "num text-right")}>
                    {typeof v === "number" ? fmt(v) : (v ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {maxRows && sheet.rows.length > maxRows && (
        <p className="text-[10px] text-muted-foreground">Se muestran {maxRows} de {sheet.rows.length} filas; la exportación incluye todas.</p>
      )}
    </div>
  );
}

const btn = "inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground";

export function ExportButtons({ title, sheets, methodology = [], node }: { title: string; sheets: ExportSheet[]; methodology?: string[]; node?: React.RefObject<HTMLElement | null> }) {
  return (
    <>
      <button type="button" className={btn} onClick={() => downloadTableCsv(title, sheets[0], methodology)} title="Descargar CSV">
        <Download className="size-3" aria-hidden /> CSV
      </button>
      <button type="button" className={btn} onClick={() => void downloadTablesXlsx(title, sheets, methodology)} title="Descargar Excel">
        <FileSpreadsheet className="size-3" aria-hidden /> Excel
      </button>
      {node && (
        <button type="button" className={btn} onClick={() => node.current && void downloadPng(node.current, title)} title="Descargar imagen">
          <ImageDown className="size-3" aria-hidden /> PNG
        </button>
      )}
    </>
  );
}

// ── Gráficos ────────────────────────────────────────────────────────────────

const HUES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];
export const hue = (i: number) => HUES[i % HUES.length];

const axisProps = {
  stroke: "var(--muted-foreground)",
  tick: { fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-plex-mono)" },
  tickLine: false,
  axisLine: false,
} as const;

export interface LineSpec {
  key: string;
  name: string;
  color?: string;
  dashed?: boolean;
  /** Banda (área) entre `${key}_lo` y `${key}_hi`. */
  band?: { lo: string; hi: string; opacity?: number }[];
}

type Row = Record<string, number | string | null | undefined | [number, number]>;

function ChartTooltip({ active, payload, label, lines }: TooltipContentProps<TooltipValueType, number | string> & { lines: LineSpec[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  return (
    <div className="max-w-xs rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
      <div className="num mb-1 text-muted-foreground">{String(label)}</div>
      {lines.map((l, i) => {
        const v = row?.[l.key];
        if (v === undefined) return null;
        return (
          <div key={l.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0" style={{ background: l.color ?? hue(i) }} />
            <span className="min-w-0 truncate text-muted-foreground">{l.name}</span>
            <span className="num ml-auto pl-2">{typeof v === "number" ? fmt(v) : "—"}</span>
          </div>
        );
      })}
      {lines.flatMap((l) =>
        (l.band ?? []).map((b) => {
          const lo = row?.[b.lo];
          const hi = row?.[b.hi];
          if (typeof lo !== "number" || typeof hi !== "number") return null;
          return (
            <div key={b.lo} className="num pl-5 text-[10px] text-muted-foreground">
              {b.lo.includes("80") ? "80 %" : b.lo.includes("95") ? "95 %" : "Banda"}: {fmt(lo)} — {fmt(hi)}
            </div>
          );
        }),
      )}
    </div>
  );
}

/**
 * Gráfico de líneas sobre un eje X categórico (fechas o pasos), con bandas
 * opcionales (abanico de incertidumbre). Un solo eje Y: nunca doble escala.
 */
export function LinesChart({
  data,
  lines,
  height = 280,
  xKey = "x",
  zero,
  refX,
  yLabel,
}: {
  data: Row[];
  lines: LineSpec[];
  height?: number;
  xKey?: string;
  zero?: boolean;
  refX?: string;
  yLabel?: string;
}) {
  // Recharts dibuja áreas de rango con [lo, hi] en una sola clave.
  const rows = data.map((r) => {
    const out: Row = { ...r };
    for (const l of lines) for (const b of l.band ?? []) {
      const lo = r[b.lo];
      const hi = r[b.hi];
      out[`${b.lo}__range`] = typeof lo === "number" && typeof hi === "number" ? [lo, hi] : null;
    }
    return out;
  });
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`Gráfico: ${lines.map((l) => l.name).join(", ")}${yLabel ? ` (${yLabel})` : ""}`}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey={xKey} {...axisProps} minTickGap={28} />
          <YAxis {...axisProps} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip content={(p: TooltipContentProps<TooltipValueType, number | string>) => <ChartTooltip {...p} lines={lines} />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
          {zero && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
          {refX && <ReferenceLine x={refX} stroke="var(--muted-foreground)" strokeDasharray="4 3" />}
          {lines.flatMap((l, i) =>
            (l.band ?? []).map((b) => (
              <Area
                key={`${l.key}-${b.lo}`}
                dataKey={`${b.lo}__range`}
                stroke="none"
                fill={l.color ?? hue(i)}
                fillOpacity={b.opacity ?? 0.15}
                isAnimationActive={false}
                connectNulls={false}
                activeDot={false}
              />
            )),
          )}
          {lines.map((l, i) => (
            <Line
              key={l.key}
              type="linear"
              dataKey={l.key}
              name={l.name}
              stroke={l.color ?? hue(i)}
              strokeWidth={2}
              strokeDasharray={l.dashed ? "6 4" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ lines }: { lines: LineSpec[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {lines.map((l, i) => (
        <li key={l.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: l.color ?? hue(i), borderTop: l.dashed ? "2px dashed" : undefined }} />
          {l.name}
        </li>
      ))}
    </ul>
  );
}

/** Correlograma (ACF/PACF) o barras por rezago con bandas ±z/√n. */
export function Correlogram({ values, n, height = 180, label, start = 1 }: { values: number[]; n: number; height?: number; label: string; start?: number }) {
  const band = 1.96 / Math.sqrt(n);
  const data = values.slice(start).map((v, i) => ({ lag: i + start, v }));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="lag" {...axisProps} />
          <YAxis {...axisProps} width={44} domain={[-1, 1]} tickFormatter={(v: number) => fmt(v, 1)} />
          <Tooltip
            content={({ active, payload }: TooltipContentProps<TooltipValueType, number | string>) =>
              active && payload?.length ? (
                <div className="rounded border border-border bg-popover px-2 py-1 text-xs shadow">
                  Rezago {String((payload[0].payload as { lag: number }).lag)}: <span className="num">{fmt(payload[0].value as number, 3)}</span>
                </div>
              ) : null
            }
          />
          <ReferenceLine y={band} stroke="var(--chart-2)" strokeDasharray="4 3" />
          <ReferenceLine y={-band} stroke="var(--chart-2)" strokeDasharray="4 3" />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" />
          <Bar dataKey="v" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Matriz de correlaciones: color divergente con punto medio neutro, valores siempre visibles. */
export function CorrHeatmap({ names, r, p }: { names: string[]; r: number[][]; p: number[][] }) {
  const color = (v: number) => {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `color-mix(in oklab, var(--chart-1) ${Math.round(a * 70)}%, transparent)` : `color-mix(in oklab, var(--chart-2) ${Math.round(a * 70)}%, transparent)`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th />
            {names.map((n, j) => (
              <th key={j} className="max-w-28 px-1 pb-1 text-left align-bottom text-[10px] font-normal text-muted-foreground">
                <span className="line-clamp-3">{n}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((n, i) => (
            <tr key={i}>
              <th className="max-w-40 pr-2 text-left text-[10px] font-normal text-muted-foreground">
                <span className="line-clamp-2">{n}</span>
              </th>
              {names.map((_, j) => (
                <td key={j} className="p-0.5">
                  <div className="num flex h-10 w-16 flex-col items-center justify-center rounded" style={{ background: i === j ? "var(--muted)" : color(r[i][j]) }} title={`r = ${fmt(r[i][j], 3)} · p = ${fmtP(p[i][j])}`}>
                    <span>{fmt(r[i][j], 2)}</span>
                    {i !== j && <span className="text-[9px] text-muted-foreground">{p[i][j] < 0.01 ? "***" : p[i][j] < 0.05 ? "**" : p[i][j] < 0.1 ? "*" : ""}</span>}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Contenedor de gráfico con exportación PNG. */
export function ChartBox({ title, children, sheets, methodology }: { title: string; children: React.ReactNode; sheets?: ExportSheet[]; methodology?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Card title={title} actions={sheets ? <ExportButtons title={title} sheets={sheets} methodology={methodology} node={ref} /> : undefined}>
      <div ref={ref} className="bg-card">
        {children}
      </div>
    </Card>
  );
}
