"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CatalogSearch } from "@/components/analysis/analysis-builder";
import type { Frequency } from "@/lib/connectors/types";
import type { DatasetSpec, PreparedDataset } from "@/lib/econ/tasks";
import type { TransformStep } from "@/lib/econ/transforms";
import type { ExportSheet } from "@/lib/export";
import { FREQUENCY_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BacktestTab, ForecastTab } from "./tabs-forecast";
import { CorrelationTab, DescriptiveTab, RegressionTab } from "./tabs-basic";
import { CointegrationTab, UnivariateTab, VarTab } from "./tabs-ts";
import { useSeries } from "./use-econ";
import { ErrorBox, Field, Notices, selectCls, inputCls } from "./ui";

/** Recetas de transformación disponibles (cada una es una lista de pasos reproducible). */
export const RECIPES: Record<string, { label: string; steps: TransformStep[] }> = {
  level: { label: "Nivel (sin transformar)", steps: [] },
  log: { label: "Logaritmo natural", steps: [{ op: "log" }] },
  pct: { label: "Var. % período anterior", steps: [{ op: "pct" }] },
  yoy: { label: "Var. % interanual", steps: [{ op: "yoy" }] },
  logdiff: { label: "Dif. logarítmica ×100", steps: [{ op: "logdiff" }] },
  diff: { label: "Diferencia", steps: [{ op: "diff" }] },
  real: { label: "Real (deflactada por IPC)", steps: [{ op: "deflate" }] },
  real_log: { label: "Real, en logaritmo", steps: [{ op: "deflate" }, { op: "log" }] },
  real_logdiff: { label: "Real, dif. logarítmica ×100", steps: [{ op: "deflate" }, { op: "logdiff" }] },
  real_yoy: { label: "Real, var. % interanual", steps: [{ op: "deflate" }, { op: "yoy" }] },
  sa: { label: "Desestacionalizada (clásica)", steps: [{ op: "sa" }] },
  sa_logdiff: { label: "Desest., dif. log. ×100", steps: [{ op: "sa" }, { op: "logdiff" }] },
  index100: { label: "Índice base 100", steps: [{ op: "index100" }] },
  thousand: { label: "÷ 1.000 (cambio de escala)", steps: [{ op: "scale", factor: 0.001, unit: "Miles de la unidad original" }] },
};

export const DATASET_PRESETS: { title: string; description: string; ids: string[]; recipes: string[]; frequency: Frequency; from: string }[] = [
  {
    title: "Inflación, devaluación y emisión",
    description: "Variaciones mensuales del IPC, del tipo de cambio mayorista y de la base monetaria.",
    ids: ["indec.ipc_nivel_general", "bcra.tc_mayorista", "bcra.base_monetaria"],
    recipes: ["logdiff", "logdiff", "logdiff"],
    frequency: "M",
    from: "2017-01-01",
  },
  {
    title: "Salarios e inflación",
    description: "Índice de salarios e IPC en logaritmos (para cointegración) desde 2017.",
    ids: ["indec.salarios", "indec.ipc_nivel_general"],
    recipes: ["log", "log"],
    frequency: "M",
    from: "2017-01-01",
  },
  {
    title: "Actividad, crédito real y tasas",
    description: "EMAE desestacionalizado, préstamos privados reales y BADLAR (var. y nivel).",
    ids: ["indec.emae_desest", "bcra.prestamos_privados", "bcra.badlar"],
    recipes: ["logdiff", "real_logdiff", "level"],
    frequency: "M",
    from: "2017-01-01",
  },
];

const TABS = [
  { id: "descriptiva", label: "Estadística descriptiva" },
  { id: "correlacion", label: "Correlaciones" },
  { id: "regresion", label: "Regresión MCO" },
  { id: "series", label: "Series temporales" },
  { id: "var", label: "VAR · Granger · Impulso-respuesta" },
  { id: "cointegracion", label: "Cointegración · VECM" },
  { id: "proyecciones", label: "Proyecciones" },
  { id: "backtesting", label: "Backtesting" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const MAX_SERIES = 6;

export interface TabProps {
  ds: DatasetSpec;
  names: string[];
  ids: string[];
  freqs: Frequency[];
  recipeKeys: string[];
  /** Reemplaza el conjunto de variables (usado por los atajos de proyección). */
  loadDataset: (p: { ids: string[]; recipes: string[]; frequency: Frequency; from: string }) => void;
}

/** Exporta el dataset preparado + la receta de cada serie. */
export function datasetSheet(d: PreparedDataset): { sheet: ExportSheet; methodology: string[] } {
  return {
    sheet: {
      name: "Datos",
      header: ["Fecha", ...d.series.map((s) => `${s.name} [${s.unit}]`)],
      rows: d.dates.map((dt, t) => [dt, ...d.columns.map((c) => c[t])]),
    },
    methodology: [
      ...d.series.flatMap((s) => [`${s.name} — ${s.source} ${s.code ?? s.id} — ${s.recipe}`, ...s.log.map((l) => `   ${l}`)]),
      `Frecuencia común: ${FREQUENCY_LABEL[d.frequency]} · ${d.dates.length} observaciones (${d.dates[0]} a ${d.dates[d.dates.length - 1]}).`,
      ...d.notes,
    ],
  };
}

export function EconometricsWorkbench() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [ids, setIds] = useState<string[]>(() => (params.get("s") ?? "").split(",").filter(Boolean).slice(0, MAX_SERIES));
  const [recipeKeys, setRecipeKeys] = useState<string[]>(() => {
    const r = (params.get("t") ?? "").split(",");
    return ids.map((_, i) => (r[i] && RECIPES[r[i]] ? r[i] : "level"));
  });
  const [frequency, setFrequency] = useState<Frequency | "auto">(() => (params.get("f") as Frequency) || "auto");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [tab, setTab] = useState<TabId>(() => (TABS.find((t) => t.id === params.get("tab"))?.id ?? "descriptiva") as TabId);

  const sync = (next: { ids?: string[]; recipeKeys?: string[]; frequency?: string; from?: string; to?: string; tab?: string }) => {
    const u = new URLSearchParams();
    const s = next.ids ?? ids;
    if (s.length) u.set("s", s.join(","));
    const r = next.recipeKeys ?? recipeKeys;
    if (r.some((k) => k !== "level")) u.set("t", r.join(","));
    const f = next.frequency ?? frequency;
    if (f !== "auto") u.set("f", f);
    const a = next.from ?? from;
    const b = next.to ?? to;
    if (a) u.set("from", a);
    if (b) u.set("to", b);
    u.set("tab", next.tab ?? tab);
    router.replace(`${pathname}?${u}`, { scroll: false });
  };

  const { data, error, loading } = useSeries(ids);
  const ds: DatasetSpec | null = useMemo(() => {
    if (!data) return null;
    const by = new Map(data.series.map((s) => [s.meta.id, s]));
    const series = ids.map((id) => by.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s && s.points.length));
    if (!series.length) return null;
    return {
      series,
      ipc: data.ipc,
      recipes: Object.fromEntries(ids.map((id, i) => [id, RECIPES[recipeKeys[i]]?.steps ?? []])),
      frequency: frequency === "auto" ? undefined : frequency,
      from: from || undefined,
      to: to || undefined,
    };
  }, [data, ids, recipeKeys, frequency, from, to]);

  const available = ds?.series ?? [];
  const tabProps: TabProps | null = ds
    ? {
        ds,
        names: available.map((s) => s.meta.name),
        ids: available.map((s) => s.meta.id),
        freqs: available.map((s) => s.meta.frequency),
        recipeKeys: available.map((s) => recipeKeys[ids.indexOf(s.meta.id)]),
        loadDataset: (p) => loadPreset({ title: "", description: "", ...p }),
      }
    : null;

  const add = (id: string) => {
    if (ids.includes(id) || ids.length >= MAX_SERIES) return;
    const n = [...ids, id];
    const r = [...recipeKeys, "level"];
    setIds(n);
    setRecipeKeys(r);
    sync({ ids: n, recipeKeys: r });
  };
  const remove = (i: number) => {
    const n = ids.filter((_, j) => j !== i);
    const r = recipeKeys.filter((_, j) => j !== i);
    setIds(n);
    setRecipeKeys(r);
    sync({ ids: n, recipeKeys: r });
  };
  const loadPreset = (p: (typeof DATASET_PRESETS)[number]) => {
    setIds(p.ids);
    setRecipeKeys(p.recipes);
    setFrequency(p.frequency);
    setFrom(p.from);
    setTo("");
    sync({ ids: p.ids, recipeKeys: p.recipes, frequency: p.frequency, from: p.from, to: "" });
  };

  const missing = data?.missing ?? [];
  const empty = data ? ids.filter((id) => data.series.some((s) => s.meta.id === id && !s.points.length)) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-3">
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="label-caps mb-2 text-[10px] text-muted-foreground">Variables ({ids.length}/{MAX_SERIES})</h2>
          {ids.length === 0 && <p className="text-xs text-muted-foreground">Agregá series del catálogo o elegí un conjunto de ejemplo.</p>}
          <ol className="flex flex-col gap-2">
            {ids.map((id, i) => {
              const s = data?.series.find((x) => x.meta.id === id);
              return (
                <li key={id} className="rounded border border-border/60 p-2">
                  <div className="flex items-start gap-1.5">
                    <span className="num mt-0.5 text-[10px] text-amber">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-xs">{s?.meta.name ?? id}</span>
                      {s && (
                        <span className="num block truncate text-[10px] text-muted-foreground">
                          {s.meta.source_id} · {FREQUENCY_LABEL[s.meta.frequency]} · {s.meta.unit}
                        </span>
                      )}
                    </span>
                    <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-foreground" aria-label={`Quitar ${s?.meta.name ?? id}`}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <select
                    aria-label={`Transformación de ${s?.meta.name ?? id}`}
                    className={cn(selectCls, "mt-1.5")}
                    value={recipeKeys[i]}
                    onChange={(e) => {
                      const r = recipeKeys.map((k, j) => (j === i ? e.target.value : k));
                      setRecipeKeys(r);
                      sync({ recipeKeys: r });
                    }}
                  >
                    {Object.entries(RECIPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Frecuencia común" className="col-span-2">
              <select
                className={selectCls}
                value={frequency}
                onChange={(e) => {
                  setFrequency(e.target.value as Frequency | "auto");
                  sync({ frequency: e.target.value });
                }}
              >
                <option value="auto">Automática (la menor)</option>
                {(["M", "Q", "A"] as const).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Desde">
              <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => sync({})} />
            </Field>
            <Field label="Hasta">
              <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => sync({})} />
            </Field>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Las series se transforman, se llevan a una frecuencia común (sin desagregar) y se usan solo los períodos con datos en todas. Cada resultado incluye la receta para reproducirlo.
          </p>
        </section>
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="label-caps mb-2 text-[10px] text-muted-foreground">Conjuntos de ejemplo</h2>
          <ul className="flex flex-col gap-1">
            {DATASET_PRESETS.map((p) => (
              <li key={p.title}>
                <button type="button" onClick={() => loadPreset(p)} className="w-full rounded px-1.5 py-1 text-left hover:bg-accent">
                  <span className="block text-xs">{p.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <CatalogSearch onAdd={add} selected={ids} disabled={ids.length >= MAX_SERIES} />
      </aside>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Herramientas econométricas">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                sync({ tab: t.id });
              }}
              className={cn("-mb-px border-b-2 border-transparent px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground", tab === t.id && "border-amber text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        {error && <ErrorBox message={`No se pudieron cargar las series: ${error}`} />}
        {(missing.length > 0 || empty.length > 0) && (
          <Notices warnings={[...missing.map((m) => `La serie ${m} no existe en el catálogo.`), ...empty.map((m) => `La serie ${m} no tiene datos todavía.`)]} />
        )}
        {ids.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Elegí variables para empezar.</p>
        ) : loading || !tabProps ? (
          <div className="h-64 animate-pulse rounded-md bg-muted/30" aria-label="Cargando series" />
        ) : (
          <div role="tabpanel" className="flex min-w-0 flex-col gap-3">
            {tab === "descriptiva" && <DescriptiveTab {...tabProps} />}
            {tab === "correlacion" && <CorrelationTab {...tabProps} />}
            {tab === "regresion" && <RegressionTab {...tabProps} />}
            {tab === "series" && <UnivariateTab {...tabProps} />}
            {tab === "var" && <VarTab {...tabProps} />}
            {tab === "cointegracion" && <CointegrationTab {...tabProps} />}
            {tab === "proyecciones" && <ForecastTab {...tabProps} />}
            {tab === "backtesting" && <BacktestTab {...tabProps} />}
          </div>
        )}
      </div>
    </div>
  );
}
