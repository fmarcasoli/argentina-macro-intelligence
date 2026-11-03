"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRun, useSeries } from "@/components/econ/use-econ";
import { Card, ChartBox, ErrorBox, Field, fmt, hue, inputCls, Legend, LinesChart, Notices, ResultTable, RunButton, selectCls, Stat } from "@/components/econ/ui";
import { RECIPES } from "@/components/econ/workbench";
import {
  compound,
  expandPath,
  realExchangeChange,
  realRateMonthly,
  realVariation,
  runScenario,
  SIM_KIND_LABEL,
  stockPath,
  type ArithmeticResult,
  type ModelShockResult,
  type ScenarioPaths,
  type ScenarioStart,
  type Segment,
  type SimKind,
} from "@/lib/econ/simulator";
import type { PreparedDataset } from "@/lib/econ/tasks";
import { cn } from "@/lib/utils";

export interface SimulatorDefaults {
  start: ScenarioStart;
  /** Valores de referencia recientes (para precargar supuestos). */
  recent: { inflation: number; devaluation: number; baseGrowth: number; wageGrowth: number; rate: number | null; reserveFlow: number };
  sources: { name: string; value: string; date: string }[];
}

const TABS: { id: SimKind; label: string }[] = [
  { id: "arithmetic", label: "1 · Simulaciones aritméticas" },
  { id: "scenario", label: "2 · Escenarios del usuario" },
  { id: "model", label: "3 · Modelo estadístico estimado" },
];

function KindBanner({ kind }: { kind: SimKind }) {
  const k = SIM_KIND_LABEL[kind];
  return (
    <div className="rounded-md border border-amber/40 bg-amber/5 p-3 text-xs">
      <p className="font-medium">{k.title}</p>
      <p className="mt-0.5 text-muted-foreground">{k.disclaimer}</p>
    </div>
  );
}

export function Simulator({ defaults }: { defaults: SimulatorDefaults }) {
  const [tab, setTab] = useState<SimKind>("scenario");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Tipo de simulación">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("-mb-px border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground hover:text-foreground", tab === t.id && "border-amber text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <KindBanner kind={tab} />
      {tab === "arithmetic" && <ArithmeticPanel defaults={defaults} />}
      {tab === "scenario" && <ScenarioPanel defaults={defaults} />}
      {tab === "model" && <ModelPanel />}
    </div>
  );
}

// ── 1. Aritméticas ──────────────────────────────────────────────────────────

function NumIn({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" step="any" className={inputCls} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function ArithBox({ title, children, result }: { title: string; children: React.ReactNode; result: ArithmeticResult }) {
  return (
    <Card title={title}>
      <div className="grid grid-cols-2 gap-2">{children}</div>
      <div className="mt-3 rounded border border-border/60 p-2">
        <div className="num text-lg">
          {fmt(result.value, 2)} {result.unit}
        </div>
        <div className="num mt-1 text-[10px] text-muted-foreground">{result.formula}</div>
        {result.steps.map((s) => (
          <div key={s} className="num text-[10px] text-muted-foreground">
            {s}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ArithmeticPanel({ defaults }: { defaults: SimulatorDefaults }) {
  const r = defaults.recent;
  const [a, setA] = useState({ nominal: 30, inflation: 25 });
  const [b, setB] = useState({ monthly: Number(r.inflation.toFixed(2)), months: 12 });
  const [c, setC] = useState({ dev: Number(r.devaluation.toFixed(2)), inf: Number(r.inflation.toFixed(2)), ext: 0.25 });
  const [d, setD] = useState({ tna: r.rate ?? 30, inf: Number(r.inflation.toFixed(2)) });
  const [e, setE] = useState({ start: Math.round(defaults.start.reserves), flow: 0, months: 12 });
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <ArithBox title="Variación real (salarios, base monetaria, crédito)" result={realVariation(a.nominal, a.inflation)}>
        <NumIn label="Variación nominal (%)" value={a.nominal} onChange={(v) => setA({ ...a, nominal: v })} />
        <NumIn label="Inflación del mismo período (%)" value={a.inflation} onChange={(v) => setA({ ...a, inflation: v })} />
      </ArithBox>
      <ArithBox title="Inflación (o crecimiento) acumulada" result={compound(b.monthly, b.months)}>
        <NumIn label="Tasa mensual (%)" value={b.monthly} onChange={(v) => setB({ ...b, monthly: v })} hint="Precargada con el último IPC mensual" />
        <NumIn label="Meses" value={b.months} onChange={(v) => setB({ ...b, months: Math.max(1, Math.round(v)) })} />
      </ArithBox>
      <ArithBox title="Tipo de cambio real bilateral" result={realExchangeChange(c.dev, c.inf, c.ext)}>
        <NumIn label="Devaluación nominal (%)" value={c.dev} onChange={(v) => setC({ ...c, dev: v })} />
        <NumIn label="Inflación local (%)" value={c.inf} onChange={(v) => setC({ ...c, inf: v })} />
        <NumIn label="Inflación externa (%)" value={c.ext} onChange={(v) => setC({ ...c, ext: v })} hint="Supuesto del usuario" />
      </ArithBox>
      <ArithBox title="Tasa de interés real (plazo fijo 30 días)" result={realRateMonthly(d.tna, d.inf)}>
        <NumIn label="TNA (%)" value={d.tna} onChange={(v) => setD({ ...d, tna: v })} hint={r.rate !== null ? "Precargada con el último dato del BCRA" : undefined} />
        <NumIn label="Inflación mensual (%)" value={d.inf} onChange={(v) => setD({ ...d, inf: v })} />
      </ArithBox>
      <ArithBox title="Evolución hipotética de reservas (millones de US$)" result={stockPath(e.start, e.flow, e.months)}>
        <NumIn label="Stock inicial" value={e.start} onChange={(v) => setE({ ...e, start: v })} hint={`Último dato: ${defaults.start.date}`} />
        <NumIn label="Flujo neto mensual" value={e.flow} onChange={(v) => setE({ ...e, flow: v })} />
        <NumIn label="Meses" value={e.months} onChange={(v) => setE({ ...e, months: Math.max(1, Math.round(v)) })} />
      </ArithBox>
    </div>
  );
}

// ── 2. Escenarios ───────────────────────────────────────────────────────────

const VARS: { key: keyof ScenarioPaths; label: string; unit: string }[] = [
  { key: "inflation", label: "Inflación mensual", unit: "%" },
  { key: "devaluation", label: "Devaluación mensual (mayorista)", unit: "%" },
  { key: "baseGrowth", label: "Crecimiento mensual de la base monetaria", unit: "%" },
  { key: "wageGrowth", label: "Aumento mensual del salario nominal", unit: "%" },
  { key: "rate", label: "Tasa de plazo fijo (TNA)", unit: "%" },
  { key: "reserveFlow", label: "Variación mensual de reservas", unit: "M US$" },
  { key: "foreignInflation", label: "Inflación externa mensual", unit: "%" },
];

function SegmentsEditor({ label, unit, segments, onChange, n }: { label: string; unit: string; segments: Segment[]; onChange: (s: Segment[]) => void; n: number }) {
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1">{label}</span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">{i === 0 ? "Primeros" : "Luego"}</span>
            <input type="number" min={1} max={n} className={`${inputCls} w-14`} value={s.months} aria-label={`Meses del tramo ${i + 1}`} onChange={(e) => onChange(segments.map((x, j) => (j === i ? { ...x, months: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))} />
            <span className="text-muted-foreground">meses:</span>
            <input type="number" step="any" className={`${inputCls} w-20`} value={s.value} aria-label={`Valor del tramo ${i + 1}`} onChange={(e) => onChange(segments.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
            {segments.length > 1 && (
              <button type="button" onClick={() => onChange(segments.filter((_, j) => j !== i))} aria-label="Quitar tramo" className="text-muted-foreground hover:text-foreground">
                <Trash2 className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {segments.length < 4 && (
        <button type="button" onClick={() => onChange([...segments, { months: 6, value: segments[segments.length - 1].value }])} className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
          <Plus className="size-3" /> Agregar tramo
        </button>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">El último tramo se mantiene hasta el final del horizonte.</p>
    </div>
  );
}

function ScenarioPanel({ defaults }: { defaults: SimulatorDefaults }) {
  const r = defaults.recent;
  const round = (v: number) => Number(v.toFixed(2));
  const [n, setN] = useState(12);
  const [segs, setSegs] = useState<Record<keyof ScenarioPaths, Segment[]>>(() => ({
    inflation: [{ months: 12, value: round(r.inflation) }],
    devaluation: [{ months: 12, value: round(r.devaluation) }],
    baseGrowth: [{ months: 12, value: round(r.baseGrowth) }],
    wageGrowth: [{ months: 12, value: round(r.wageGrowth) }],
    rate: [{ months: 12, value: round(r.rate ?? 30) }],
    reserveFlow: [{ months: 12, value: Math.round(r.reserveFlow) }],
    foreignInflation: [{ months: 12, value: 0.25 }],
  }));
  const result = useMemo(() => {
    const paths = Object.fromEntries(VARS.map((v) => [v.key, expandPath(segs[v.key], n)])) as unknown as ScenarioPaths;
    return runScenario(defaults.start, paths);
  }, [segs, n, defaults.start]);
  const rows = result.rows;
  const chartA = [{ x: defaults.start.date, inf: 0, dev: 0 }, ...rows.map((x) => ({ x: x.d, inf: x.inflationAcc, dev: x.devaluationAcc }))];
  const chartB = [{ x: defaults.start.date, w: 100, fx: 100, base: 100 }, ...rows.map((x) => ({ x: x.d, w: x.realWageIndex, fx: x.realFxIndex, base: (x.realBase / defaults.start.base) * 100 }))];
  const linesA = [{ key: "inf", name: "Inflación acumulada (%)" }, { key: "dev", name: "Devaluación acumulada (%)", color: "var(--chart-2)" }];
  const linesB = [
    { key: "w", name: "Salario real", color: "var(--chart-3)" },
    { key: "fx", name: "Tipo de cambio real", color: "var(--chart-2)" },
    { key: "base", name: "Base monetaria real", color: "var(--chart-5)" },
  ];
  const methodology = [
    SIM_KIND_LABEL.scenario.disclaimer,
    `Punto de partida: ${defaults.start.date}. ${defaults.sources.map((s) => `${s.name}: ${s.value} (${s.date})`).join("; ")}.`,
    "IPC(t) = IPC(t−1)·(1 + π); TC(t) = TC(t−1)·(1 + dev); TCR = TC·P*/P (inicio = 100); base real = base / (P/P0); salario real = (W/W0)/(P/P0)·100; reservas(t) = reservas(t−1) + flujo; tasa real mensual = (1 + TNA·30/365)/(1 + π) − 1.",
    ...VARS.map((v) => `${v.label}: ${segs[v.key].map((s) => `${s.months} meses a ${s.value}`).join(", luego ")}`),
  ];
  return (
    <>
      <Card title="Supuestos mensuales">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Horizonte (meses)">
            <input type="number" min={1} max={60} className={`${inputCls} w-24`} value={n} onChange={(e) => setN(Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 12))))} />
          </Field>
          <p className="max-w-xl text-[10px] text-muted-foreground">
            Los valores iniciales salen de los últimos datos oficiales; los supuestos vienen precargados con valores recientes (último mes o promedio de los últimos 3 meses) y podés cambiarlos.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {VARS.map((v) => (
            <SegmentsEditor key={v.key} label={v.label} unit={v.unit} n={n} segments={segs[v.key]} onChange={(s) => setSegs({ ...segs, [v.key]: s })} />
          ))}
        </div>
      </Card>
      <Card title="Punto de partida (datos oficiales)">
        <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {defaults.sources.map((s) => (
            <li key={s.name} className="flex gap-2">
              <span className="text-muted-foreground">{s.name}</span>
              <span className="num ml-auto">{s.value}</span>
              <span className="num text-[10px] text-muted-foreground">{s.date}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {result.summary.map((s) => (
          <Stat key={s.name} label={s.name} value={s.value} />
        ))}
      </div>
      <Notices warnings={result.notes} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartBox title="Precios y tipo de cambio (acumulado desde el inicio)" sheets={[{ name: "Acumulados", header: ["Mes", "Inflación acumulada (%)", "Devaluación acumulada (%)"], rows: chartA.map((x) => [x.x, x.inf, x.dev]) }]} methodology={methodology}>
          <LinesChart data={chartA} lines={linesA} zero height={240} />
          <Legend lines={linesA} />
        </ChartBox>
        <ChartBox title="Variables reales (inicio = 100)" sheets={[{ name: "Reales", header: ["Mes", "Salario real", "Tipo de cambio real", "Base monetaria real"], rows: chartB.map((x) => [x.x, x.w, x.fx, x.base]) }]} methodology={methodology}>
          <LinesChart data={chartB} lines={linesB} height={240} />
          <Legend lines={linesB} />
        </ChartBox>
      </div>
      <Card title="Trayectoria mensual">
        <ResultTable
          title="Escenario macro"
          methodology={methodology}
          sheet={{
            name: "Escenario",
            header: ["Mes", "IPC", "Infl. acum. (%)", "TC mayorista", "Dev. acum. (%)", "TCR (inicio=100)", "Base (M$)", "Reservas (M US$)", "Salario real", "Tasa real mensual (%)", "$100 en plazo fijo (reales)"],
            rows: rows.map((x) => [x.d, x.ipc, x.inflationAcc, x.fx, x.devaluationAcc, x.realFxIndex, x.base, x.reserves, x.realWageIndex, x.realRateMonthly, x.realDepositValue]),
          }}
        />
      </Card>
    </>
  );
}

// ── 3. Modelo estimado ──────────────────────────────────────────────────────

const MODEL_VARS: { id: string; recipe: keyof typeof RECIPES; label: string; unit: string }[] = [
  { id: "indec.ipc_nivel_general", recipe: "logdiff", label: "Inflación mensual", unit: "≈ %" },
  { id: "bcra.tc_mayorista", recipe: "logdiff", label: "Devaluación mensual", unit: "≈ %" },
  { id: "bcra.base_monetaria", recipe: "logdiff", label: "Crecimiento de la base monetaria", unit: "≈ %" },
  { id: "indec.salarios", recipe: "logdiff", label: "Aumento de salarios nominales", unit: "≈ %" },
  { id: "bcra.badlar", recipe: "diff", label: "Cambio en la tasa BADLAR", unit: "p.p. de TNA" },
  { id: "indec.emae_desest", recipe: "logdiff", label: "Crecimiento de la actividad (EMAE desest.)", unit: "≈ %" },
];

interface ShockOut {
  dataset: PreparedDataset;
  result: ModelShockResult;
  ms?: number;
}

function ModelPanel() {
  const [selected, setSelected] = useState<string[]>(["bcra.tc_mayorista", "indec.ipc_nivel_general", "indec.salarios"]);
  const [from, setFrom] = useState("2017-01-01");
  const [p, setP] = useState(2);
  const [shock, setShock] = useState(0);
  const [size, setSize] = useState(10);
  const [horizon, setHorizon] = useState(12);
  const vars = selected.map((id) => MODEL_VARS.find((v) => v.id === id)!);
  const { data, error, loading } = useSeries(selected);
  const run = useRun<ShockOut>();
  const r = run.result;
  // Etiquetas legibles de la última corrida (el orden puede cambiar después).
  const [runLabels, setRunLabels] = useState<string[]>([]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const n = [...selected];
    [n[i], n[j]] = [n[j], n[i]];
    setSelected(n);
    setShock(shock === i ? j : shock === j ? i : shock);
  };
  const exec = () => {
    if (!data) return;
    const by = new Map(data.series.map((s) => [s.meta.id, s]));
    const series = selected.map((id) => by.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s?.points.length));
    setRunLabels(series.map((s) => MODEL_VARS.find((v) => v.id === s.meta.id)?.label ?? s.meta.name));
    void run.exec({
      kind: "shock",
      ds: { series, ipc: data.ipc, recipes: Object.fromEntries(vars.map((v) => [v.id, RECIPES[v.recipe].steps])), frequency: "M", from },
      p,
      shockVar: shock,
      shockSize: size,
      horizon,
    });
  };
  const methodology = r ? [SIM_KIND_LABEL.model.disclaimer, ...r.result.notes, ...r.dataset.series.flatMap((s) => [`${s.name}: ${s.recipe}`, ...s.log])] : [];
  return (
    <>
      <Card title="Modelo: VAR de variaciones mensuales">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <fieldset>
            <legend className="mb-1 text-xs text-muted-foreground">Variables (el orden define la identificación de Cholesky)</legend>
            <ul className="flex flex-col gap-1">
              {MODEL_VARS.map((v) => {
                const i = selected.indexOf(v.id);
                return (
                  <li key={v.id} className="flex items-center gap-2 rounded border border-border/60 p-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={i >= 0}
                      aria-label={v.label}
                      onChange={(e) => {
                        const n = e.target.checked ? [...selected, v.id] : selected.filter((x) => x !== v.id);
                        setSelected(n);
                        setShock(0);
                      }}
                    />
                    <span className="num w-4 text-amber">{i >= 0 ? i + 1 : ""}</span>
                    <span className="min-w-0 flex-1">{v.label}</span>
                    <span className="text-[10px] text-muted-foreground">{v.unit}</span>
                    {i >= 0 && (
                      <>
                        <button type="button" className="px-1 text-muted-foreground hover:text-foreground" onClick={() => move(i, -1)} aria-label={`Subir ${v.label}`}>
                          ↑
                        </button>
                        <button type="button" className="px-1 text-muted-foreground hover:text-foreground" onClick={() => move(i, 1)} aria-label={`Bajar ${v.label}`}>
                          ↓
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="grid grid-cols-2 content-start gap-3">
            <Field label="Estimar desde">
              <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Rezagos del VAR">
              <input type="number" min={1} max={6} className={inputCls} value={p} onChange={(e) => setP(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))))} />
            </Field>
            <Field label="Shock en" className="col-span-2">
              <select className={selectCls} value={shock} onChange={(e) => setShock(Number(e.target.value))}>
                {vars.map((v, i) => (
                  <option key={v.id} value={i}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Tamaño del shock (${vars[shock]?.unit ?? ""})`}>
              <input type="number" step="any" className={inputCls} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            </Field>
            <Field label="Horizonte (meses)">
              <input type="number" min={2} max={36} className={inputCls} value={horizon} onChange={(e) => setHorizon(Math.max(2, Math.min(36, Math.round(Number(e.target.value) || 12))))} />
            </Field>
            <RunButton busy={run.busy || loading} onClick={exec} disabled={selected.length < 2 || !data} label="Simular shock" />
          </div>
        </div>
      </Card>
      {error && <ErrorBox message={error} />}
      {run.error && <ErrorBox message={run.error} />}
      {r && (
        <>
          <Notices warnings={r.result.notes.filter((n) => /estable|4 veces/.test(n))} infos={r.result.notes.filter((n) => !/estable|4 veces/.test(n))} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Observaciones" value={String(r.result.model.nobs)} note={`${r.dataset.dates[0]} → ${r.dataset.dates[r.dataset.dates.length - 1]}`} />
            <Stat label="Rezagos" value={String(r.result.model.p)} />
            <Stat label="Estabilidad" value={r.result.model.stable ? "Estable" : "Inestable"} note={`Radio espectral ${fmt(r.result.model.spectralRadius, 3)}`} />
            <Stat label="Shock" value={`${fmt(r.result.shockSize)} en ${runLabels[r.result.shockVar] ?? ""}`} />
          </div>
          <ChartBox
            title="Respuestas estimadas al shock (desvío respecto de la trayectoria sin shock)"
            sheets={[
              {
                name: "Respuestas",
                header: ["Mes", ...r.result.model.names.flatMap((n, i) => { const l = runLabels[i] ?? n; return [l, `${l} inf.`, `${l} sup.`, `${l} acumulada`]; })],
                rows: Array.from({ length: r.result.response[0].length }, (_, s) => [s, ...r.result.model.names.flatMap((_, i) => [r.result.response[i][s], r.result.lower[i][s], r.result.upper[i][s], r.result.cumulative[i][s]])]),
              },
            ]}
            methodology={methodology}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {r.result.model.names.map((n, i) => {
                const rows = r.result.response[i].map((v, s) => ({ x: String(s), v, lo: r.result.lower[i][s], hi: r.result.upper[i][s], acc: r.result.cumulative[i][s] }));
                const lines = [
                  { key: "v", name: "Respuesta mensual", color: hue(i), band: [{ lo: "lo", hi: "hi", opacity: 0.18 }] },
                  { key: "acc", name: "Acumulada", color: "var(--chart-4)", dashed: true },
                ];
                return (
                  <div key={n}>
                    <p className="mb-1 text-[11px]">
                      {runLabels[i] ?? n} <span className="text-muted-foreground">({n})</span>
                    </p>
                    <LinesChart data={rows} lines={lines} zero height={190} />
                    <Legend lines={lines} />
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Bandas al {Math.round(r.result.level * 100)} % (Monte Carlo). Mes 0 = impacto. Regularidades estadísticas del período de estimación, no efectos causales.
            </p>
          </ChartBox>
        </>
      )}
    </>
  );
}
