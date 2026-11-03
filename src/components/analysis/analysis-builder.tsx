"use client";

import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisChart, seriesStyle } from "@/components/charts/analysis-chart";
import { SaveAnalysisButton } from "@/components/workspace/save-analysis";
import { DEFAULT_SPEC, specFromSearchParams, specToSearchParams, type AnalysisSpec } from "@/lib/analysis/pipeline";
import type { Pt, SeriesData } from "@/lib/analysis/types";
import { FREQUENCY_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CatalogRow {
  id: string;
  source_id: "BCRA" | "INDEC";
  source_code: string | null;
  name: string;
  unit: string;
  frequency: keyof typeof FREQUENCY_LABEL;
  last_date: string | null;
  source_last_date: string | null;
  update_status: string;
  subcategory: string | null;
}

/** Análisis de ejemplo, todos con series oficiales del catálogo. */
export const PRESETS: { title: string; description: string; spec: Partial<AnalysisSpec> & { ids: string[] } }[] = [
  {
    title: "Reservas vs. base monetaria",
    description: "Millones de USD y millones de pesos: paneles con escalas independientes.",
    spec: { ids: ["bcra.reservas", "bcra.base_monetaria"], frequency: "M", layout: "panels", from: "2016-01-01" },
  },
  {
    title: "IPC vs. tipo de cambio",
    description: "Índice base 100 en enero 2017: inflación acumulada contra devaluación.",
    spec: { ids: ["indec.ipc_nivel_general", "bcra.tc_mayorista"], frequency: "M", transform: "index100", from: "2017-01-01" },
  },
  {
    title: "M2 vs. inflación",
    description: "Variación interanual del M2 y del IPC.",
    spec: { ids: ["bcra.m2", "indec.ipc_nivel_general"], frequency: "M", transform: "pct_yoy", from: "2018-01-01" },
  },
  {
    title: "Salarios vs. IPC",
    description: "Índice de salarios e IPC con base 100 común.",
    spec: { ids: ["indec.salarios", "indec.ipc_nivel_general"], frequency: "M", transform: "index100", from: "2017-01-01" },
  },
  {
    title: "EMAE vs. crédito privado",
    description: "Actividad y préstamos al sector privado en términos reales (deflactados por IPC).",
    spec: { ids: ["indec.emae_desest", "bcra.prestamos_privados"], frequency: "M", transform: "real", from: "2017-01-01", layout: "panels" },
  },
  {
    title: "CER vs. inflación",
    description: "El CER replica el IPC con rezago: comparación en base 100.",
    spec: { ids: ["bcra.cer", "indec.ipc_nivel_general"], frequency: "M", transform: "index100", from: "2017-01-01" },
  },
  {
    title: "Tipo de cambio real vs. exportaciones",
    description: "Tipo de cambio mayorista deflactado por IPC (sin inflación externa) y exportaciones en USD.",
    spec: { ids: ["bcra.tc_mayorista", "indec.exportaciones"], frequency: "M", transform: "real", from: "2017-01-01", layout: "panels" },
  },
];

export function AnalysisBuilder() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [spec, setSpecState] = useState<AnalysisSpec>(() => specFromSearchParams(params));
  const [loaded, setLoaded] = useState<{ key: string; series: SeriesData[]; ipc?: Pt[]; errors: Record<string, string>; missing: string[] } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);

  // Abrir un análisis guardado (?a=<id>)
  const savedId = params.get("a");
  useEffect(() => {
    if (!savedId) return;
    let alive = true;
    fetch(`/api/workspace/analyses/${encodeURIComponent(savedId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se encontró el análisis guardado"))))
      .then((j: { analysis: { title: string; definition: Partial<AnalysisSpec> } }) => {
        if (!alive) return;
        const d = j.analysis.definition;
        const next = specFromSearchParams(specToSearchParams({ ...DEFAULT_SPEC, ...d, ids: d.ids ?? [] }));
        setSavedTitle(j.analysis.title);
        setSpecState(next);
        router.replace(`${pathname}?${specToSearchParams(next).toString()}`, { scroll: false });
      })
      .catch((e: Error) => alive && setSavedError(e.message));
    return () => {
      alive = false;
    };
  }, [savedId, pathname, router]);

  const setSpec = (next: AnalysisSpec) => {
    setSpecState(next);
    const qs = specToSearchParams(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Datos de las series seleccionadas (incluye IPC para valores reales).
  const idsKey = spec.ids.join(",");
  useEffect(() => {
    if (!idsKey) return;
    let alive = true;
    fetch(`/api/series?ids=${encodeURIComponent(idsKey)}&ipc=1`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Error al cargar las series");
        return j as { series: SeriesData[]; ipc?: Pt[]; errors: Record<string, string>; missing: string[] };
      })
      .then((j) => alive && setLoaded({ key: idsKey, ...j }))
      .catch((e: Error) => alive && setLoadError({ key: idsKey, message: e.message }));
    return () => {
      alive = false;
    };
  }, [idsKey]);

  const data = loaded?.key === idsKey ? loaded.series : [];
  const fetchError = savedError ?? (loadError?.key === idsKey ? loadError.message : null);
  const loading = Boolean(idsKey) && loaded?.key !== idsKey && !fetchError;
  const addSeries = (id: string) => {
    if (spec.ids.includes(id) || spec.ids.length >= 8) return;
    setSpec({ ...spec, ids: [...spec.ids, id] });
  };
  const removeSeries = (id: string) => setSpec({ ...spec, ids: spec.ids.filter((x) => x !== id) });
  const title = savedTitle ?? (data.length ? data.map((s) => s.meta.name).join(" vs. ") : "Análisis");

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      {/* Selector de variables */}
      <aside className="flex min-w-0 flex-col gap-4">
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="label-caps mb-2 text-[10px] text-muted-foreground">Variables ({spec.ids.length}/8)</h2>
          {spec.ids.length === 0 ? (
            <p className="text-xs text-muted-foreground">Agregá series del catálogo o elegí un análisis de ejemplo.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {spec.ids.map((id, i) => {
                const s = data.find((x) => x.meta.id === id);
                const st = seriesStyle(i);
                return (
                  <li key={id} className="flex min-w-0 items-start gap-2 rounded border border-border/60 p-2">
                    <span
                      aria-hidden
                      className="mt-1.5 inline-block h-0.5 w-4 shrink-0 rounded"
                      style={{ background: st.dashed ? `repeating-linear-gradient(90deg, ${st.color} 0 4px, transparent 4px 7px)` : st.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={`/indicadores/${encodeURIComponent(id)}`} className="line-clamp-2 text-xs hover:text-amber">
                        {s?.meta.name ?? id}
                      </Link>
                      {s && (
                        <div className="num truncate text-[10px] text-muted-foreground">
                          {s.meta.source_id} · {FREQUENCY_LABEL[s.meta.frequency]} · {s.meta.unit}
                        </div>
                      )}
                      {loaded?.errors?.[id] && <div className="text-[10px] text-negative">Error de la fuente: {loaded.errors[id]}</div>}
                      {loaded?.missing?.includes(id) && <div className="text-[10px] text-negative">Serie inexistente en el catálogo</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSeries(id)}
                      aria-label={`Quitar ${s?.meta.name ?? id}`}
                      className="shrink-0 text-muted-foreground hover:text-negative"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <CatalogSearch onAdd={addSeries} selected={spec.ids} disabled={spec.ids.length >= 8} />

        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="label-caps mb-2 text-[10px] text-muted-foreground">Análisis de ejemplo</h2>
          <ul className="flex flex-col gap-1">
            {PRESETS.map((p) => (
              <li key={p.title}>
                <button
                  type="button"
                  onClick={() => {
                    setSavedTitle(p.title);
                    setSpec({ ...DEFAULT_SPEC, ...p.spec });
                  }}
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                >
                  <span className="block text-xs">{p.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      {/* Gráfico y resultados */}
      <section className="min-w-0 rounded-md border border-border bg-card p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{spec.ids.length ? title : "Constructor de análisis"}</h2>
          <SaveAnalysisButton spec={spec} defaultTitle={title} />
        </div>
        {fetchError && <p className="mb-2 rounded border border-negative/30 bg-negative/5 p-2 text-xs">{fetchError}</p>}
        {spec.ids.length === 0 ? (
          <div className="grid h-80 place-items-center rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Elegí variables de cualquier institución en el panel izquierdo. Las series se alinean a una frecuencia común y
            podés transformarlas (variaciones, índice base 100, valores reales) antes de compararlas.
          </div>
        ) : loading && !data.length ? (
          <div className="h-80 animate-pulse rounded bg-muted/30" />
        ) : (
          <AnalysisChart
            key={idsKey}
            data={data}
            ipc={loaded?.ipc}
            spec={spec}
            onSpecChange={setSpec}
            title={title}
            height={360}
            defaultRange="MAX"
          />
        )}
        {loading && <p className="mt-2 text-[11px] text-muted-foreground">Cargando series (las que todavía no tienen datos se descargan de la fuente)…</p>}
      </section>
    </div>
  );
}

function CatalogSearch({ onAdd, selected, disabled }: { onAdd: (id: string) => void; selected: string[]; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"" | "INDEC" | "BCRA">("");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const u = new URLSearchParams({ limit: "15" });
      if (q.trim()) u.set("q", q.trim());
      if (source) u.set("source", source);
      if (!q.trim()) u.set("tracked", "1");
      setBusy(true);
      fetch(`/api/indicators?${u}`)
        .then((r) => r.json())
        .then((j: { rows?: CatalogRow[]; total?: number }) => {
          setRows(j.rows ?? []);
          setTotal(j.total ?? 0);
        })
        .catch(() => setRows([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, source]);

  const sel = useMemo(() => new Set(selected), [selected]);
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <h2 className="label-caps mb-2 text-[10px] text-muted-foreground">Agregar series del catálogo</h2>
      <label className="relative block">
        <span className="sr-only">Buscar series</span>
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ej.: salarios, plazo fijo, desocupación"
          className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-7 text-xs"
        />
      </label>
      <div className="mt-2 flex gap-1" role="group" aria-label="Institución">
        {(["", "INDEC", "BCRA"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setSource(s)}
            aria-pressed={source === s}
            className={cn("rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground", source === s && "border-amber/50 text-amber")}
          >
            {s || "Todas"}
          </button>
        ))}
        <span className="num ml-auto self-center text-[10px] text-muted-foreground">{busy ? "…" : `${total.toLocaleString("es-AR")} series`}</span>
      </div>
      <ul className="mt-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              disabled={disabled || sel.has(r.id)}
              onClick={() => onAdd(r.id)}
              className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-accent disabled:opacity-40"
            >
              <Plus className="mt-0.5 size-3 shrink-0 text-amber" aria-hidden />
              <span className="min-w-0">
                <span className="line-clamp-2 text-xs">{r.name}</span>
                <span className="num block truncate text-[10px] text-muted-foreground">
                  {r.source_id} · {FREQUENCY_LABEL[r.frequency]} · {r.unit}
                  {r.update_status === "discontinued" ? " · discontinuada" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
