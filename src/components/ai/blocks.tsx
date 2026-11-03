"use client";

import { ChevronDown, Database, FileDown, FileSpreadsheet, Wrench } from "lucide-react";
import { useRef } from "react";
import { ChartBox, Legend, LinesChart, Notices, ResultTable, Stat, hue } from "@/components/econ/ui";
import type { Block, SourceRef, ToolTrace } from "@/lib/ai/types";
import { FREQ_NAME } from "@/lib/analysis/frequency";
import { downloadPdf, downloadTablesXlsx, type ExportSheet } from "@/lib/export";
import { Markdown } from "./markdown";

/** Bloques de una respuesta: todo sale de herramientas sobre datos reales. */
export function Blocks({ blocks, methodology = [] }: { blocks: Block[]; methodology?: string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {blocks.map((b, i) => {
        if (b.type === "text") return <div key={i} className="rounded-md border border-border/60 bg-card p-3"><Markdown text={b.text} /></div>;
        if (b.type === "notes") return <Notices key={i} warnings={b.level === "warning" ? b.items : []} infos={b.level === "info" ? b.items : []} />;
        if (b.type === "stats")
          return (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {b.items.map((s, j) => <Stat key={j} label={s.label} value={s.value} note={s.note} />)}
            </div>
          );
        if (b.type === "table")
          return (
            <details key={i} className="rounded-md border border-border bg-card p-3" open={b.rows.length <= 12}>
              <summary className="cursor-pointer text-xs text-muted-foreground">{b.title} <span className="num">({b.rows.length} filas)</span></summary>
              <div className="mt-2">
                <ResultTable title={b.title} sheet={{ name: b.title.slice(0, 31), header: b.header, rows: b.rows }} methodology={methodology} maxRows={60} />
                {b.note && <p className="mt-1 text-[10px] text-muted-foreground">{b.note}</p>}
              </div>
            </details>
          );
        // chart: un panel por unidad
        const sheet: ExportSheet = {
          name: "Gráfico",
          header: ["Fecha", ...b.panels.flatMap((p) => p.series.map((s) => `${s.name} [${p.unit}]`))],
          rows: b.rows.map((r) => [String(r.x), ...b.panels.flatMap((p) => p.series.map((s) => (r[s.key] as number | null) ?? null))]),
        };
        let k = 0;
        return (
          <ChartBox key={i} title={b.title} sheets={[sheet]} methodology={methodology}>
            <div className={b.panels.length > 1 ? "grid gap-3 lg:grid-cols-2" : ""}>
              {b.panels.map((p, j) => {
                const lines = p.series.map((s) => ({ key: s.key, name: s.name, color: hue(k++), dashed: /inferior|superior/.test(s.name) }));
                return (
                  <div key={j}>
                    {b.panels.length > 1 && <p className="mb-1 text-[11px] text-muted-foreground">{p.unit}</p>}
                    <LinesChart data={b.rows} lines={lines} height={b.panels.length > 1 ? 200 : 260} zero={/%|pp|^r$/.test(p.unit)} />
                    <Legend lines={lines} />
                  </div>
                );
              })}
            </div>
            {b.panels.length > 1 && <p className="mt-1 text-[10px] text-muted-foreground">Unidades distintas: un panel por unidad (sin doble eje).</p>}
            {b.note && <p className="mt-1 text-[10px] text-muted-foreground">{b.note}</p>}
          </ChartBox>
        );
      })}
    </div>
  );
}

export function SourcesList({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return null;
  return (
    <div className="rounded-md border border-border/60 p-2 text-[11px]">
      <div className="mb-1 flex items-center gap-1 text-muted-foreground"><Database className="size-3" aria-hidden /> Series utilizadas</div>
      <ul className="flex flex-col gap-0.5">
        {sources.map((s, i) => (
          <li key={`${s.id}-${i}`}>
            <a href={`/indicadores/${encodeURIComponent(s.id)}`} className="font-medium hover:text-amber">{s.name}</a>{" "}
            <span className="text-muted-foreground">
              — {s.source} {s.code ?? "(calculada por la plataforma)"} · {s.unit} · {FREQ_NAME[s.frequency]}
              {s.from && s.to ? ` · ${s.from.slice(0, 7)} a ${s.to.slice(0, 7)}` : ""}
              {s.transform && s.transform !== "Nivel (sin transformar)" ? ` · ${s.transform}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Methodology({ items, tools }: { items: string[]; tools?: ToolTrace[] }) {
  if (!items.length && !tools?.length) return null;
  return (
    <details className="rounded-md border border-border/60 p-2 text-[11px]">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground">
        <ChevronDown className="size-3" aria-hidden /> Metodología y herramientas ejecutadas
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        {items.map((m, i) => <li key={i} className="whitespace-pre-wrap">{m}</li>)}
      </ul>
      {tools && tools.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {tools.map((t, i) => (
            <li key={i} className="num rounded border border-border/50 p-1.5">
              <span className="flex items-center gap-1"><Wrench className="size-3" aria-hidden /> {t.name} <span className={t.ok ? "text-muted-foreground" : "text-negative"}>{t.ok ? "ok" : "error"}</span> <span className="text-muted-foreground">· {t.ms} ms</span></span>
              <code className="block break-all text-[10px] text-muted-foreground">{JSON.stringify(t.args)}</code>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Exporta una respuesta o informe completo: PDF (captura) y Excel (todas las tablas + metodología). */
export function ExportBar({ title, blocks, sources, methodology, node }: { title: string; blocks: Block[]; sources: SourceRef[]; methodology: string[]; node: React.RefObject<HTMLElement | null> }) {
  const sheets: ExportSheet[] = blocks.flatMap((b) =>
    b.type === "table"
      ? [{ name: b.title.slice(0, 31), header: b.header, rows: b.rows }]
      : b.type === "chart"
        ? [{ name: `Gráfico ${b.title}`.slice(0, 31), header: ["Fecha", ...b.panels.flatMap((p) => p.series.map((s) => `${s.name} [${p.unit}]`))], rows: b.rows.map((r) => [String(r.x), ...b.panels.flatMap((p) => p.series.map((s) => (r[s.key] as number | null) ?? null))]) }]
        : [],
  );
  const meth = [...sources.map((s) => `${s.name} — ${s.source} ${s.code ?? "(calculada)"} — ${s.unit} — ${FREQ_NAME[s.frequency]}${s.from ? ` — ${s.from} a ${s.to}` : ""}`), ...methodology];
  const btn = "inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground";
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" className={btn} onClick={() => node.current && void downloadPdf(node.current, title)}>
        <FileDown className="size-3" aria-hidden /> PDF
      </button>
      {sheets.length > 0 && (
        <button type="button" className={btn} onClick={() => void downloadTablesXlsx(title, sheets, meth)}>
          <FileSpreadsheet className="size-3" aria-hidden /> Excel ({sheets.length} {sheets.length === 1 ? "hoja" : "hojas"})
        </button>
      )}
    </div>
  );
}

export function useNodeRef() {
  return useRef<HTMLDivElement>(null);
}
