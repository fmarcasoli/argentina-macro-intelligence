"use client";

import { FileText, Loader2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CatalogSearch } from "@/components/analysis/analysis-builder";
import { ErrorBox, Notices } from "@/components/econ/ui";
import { buildReport, REPORT_LABEL, type Report, type ReportKind } from "@/lib/ai/reports";
import { cn } from "@/lib/utils";
import { Blocks, ExportBar, Methodology, SourcesList } from "./blocks";
import { browserDataClient } from "./client";
import { Markdown } from "./markdown";

/** Informes automáticos: se generan en el navegador con datos oficiales; no requieren modelo de lenguaje. */
export function ReportsView() {
  const [kind, setKind] = useState<ReportKind>("mensual");
  const [ids, setIds] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(() => browserDataClient(), []);
  const ref = useRef<HTMLDivElement>(null);

  const generate = async (k: ReportKind) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await buildReport(k, client, { ids }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const all = report?.sections.flatMap((s) => s.blocks) ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1">
          {(Object.keys(REPORT_LABEL) as ReportKind[]).map((k) => (
            <li key={k}>
              <button type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("w-full rounded-md border px-2.5 py-2 text-left", kind === k ? "border-amber/60 bg-amber/5" : "border-border hover:bg-accent")}>
                <span className="block text-xs font-medium">{REPORT_LABEL[k].title}</span>
                <span className="block text-[10px] text-muted-foreground">{REPORT_LABEL[k].description}</span>
              </button>
            </li>
          ))}
        </ul>
        {kind === "personalizado" && (
          <>
            <ul className="flex flex-col gap-1 text-xs">
              {ids.map((id) => (
                <li key={id} className="flex items-center gap-1 rounded border border-border px-2 py-1">
                  <span className="num min-w-0 flex-1 truncate">{id}</span>
                  <button type="button" onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={`Quitar ${id}`}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
            <CatalogSearch onAdd={(id) => setIds((xs) => (xs.includes(id) || xs.length >= 6 ? xs : [...xs, id]))} selected={ids} disabled={ids.length >= 6} />
          </>
        )}
        <button type="button" disabled={busy || (kind === "personalizado" && !ids.length)} onClick={() => void generate(kind)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-amber/60 bg-amber/10 text-xs font-medium hover:bg-amber/20 disabled:opacity-50">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />} {busy ? "Generando…" : "Generar informe"}
        </button>
      </aside>
      <div className="flex min-w-0 flex-col gap-3">
        {error && <ErrorBox message={error} />}
        {!report && !busy && <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Elegí un informe y generalo. Todos usan datos oficiales almacenados en la plataforma y muestran la fecha y frecuencia de cada dato.</p>}
        {report && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-[11px] text-muted-foreground">Generado {new Date(report.generatedAt).toLocaleString("es-AR")}</span>
              <div className="ml-auto"><ExportBar title={report.title} blocks={all} sources={report.sources} methodology={report.methodology} node={ref} /></div>
            </div>
            <div ref={ref} className="flex flex-col gap-4 bg-background">
              <h2 className="text-lg font-semibold">{report.title}</h2>
              <Notices infos={report.coverage} />
              {report.sections.map((s) => (
                <section key={s.title} className="flex flex-col gap-2">
                  <h3 className="label-caps text-[11px] text-muted-foreground">{s.title}</h3>
                  {s.text.length > 0 && <div className="rounded-md border border-border bg-card p-3"><Markdown text={s.text.join("\n\n")} /></div>}
                  <Blocks blocks={s.blocks} methodology={report.methodology} />
                </section>
              ))}
              {report.warnings.length > 0 && <Notices warnings={report.warnings} />}
              <SourcesList sources={report.sources} />
              <Methodology items={report.methodology} />
              <p className="text-[10px] text-muted-foreground">Textos descriptivos generados a partir de los datos (sin interpretación causal). Las series mensuales y trimestrales muestran su último dato publicado, no datos diarios.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
