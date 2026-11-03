"use client";

import { useState } from "react";
import type { Pt } from "@/lib/analysis/types";
import type { ArimaOrder } from "@/lib/econ/arima";
import type { BacktestResult, Revision, VintageObservation } from "@/lib/econ/backtest";
import { METHOD_LABEL, type ForecastMethod, type ForecastResult, type ForecastSpec } from "@/lib/econ/forecast";
import type { PreparedDataset } from "@/lib/econ/tasks";
import type { Frequency } from "@/lib/connectors/types";
import { DatasetSummary } from "./tabs-basic";
import { ASSUMPTIONS } from "./tabs-ts";
import { datasetSheet, RECIPES, type TabProps } from "./workbench";
import { useRun } from "./use-econ";
import { Card, ChartBox, ErrorBox, Field, fmt, inputCls, Legend, LinesChart, Notices, ResultTable, RunButton, selectCls, Stat } from "./ui";

/** Atajos de proyección para las variables pedidas: todas con series oficiales del catálogo. */
export const FORECAST_PRESETS: { title: string; ids: string[]; recipes: string[]; frequency: Frequency; from: string; method: ForecastMethod; log: boolean; note: string }[] = [
  { title: "Inflación mensual", ids: ["indec.ipc_nivel_general"], recipes: ["logdiff"], frequency: "M", from: "2017-01-01", method: "auto_arima", log: false, note: "Dif. logarítmica del IPC (≈ % mensual), ARIMA automático." },
  { title: "Reservas internacionales", ids: ["bcra.reservas"], recipes: ["level"], frequency: "M", from: "2016-01-01", method: "auto_arima", log: true, note: "Fin de mes, en logaritmos." },
  { title: "Tipo de cambio mayorista", ids: ["bcra.tc_mayorista"], recipes: ["level"], frequency: "M", from: "2017-01-01", method: "auto_arima", log: true, note: "Promedio mensual, en logaritmos." },
  { title: "Base monetaria", ids: ["bcra.base_monetaria"], recipes: ["level"], frequency: "M", from: "2017-01-01", method: "auto_arima", log: true, note: "Promedio mensual, en logaritmos." },
  { title: "Tasa BADLAR", ids: ["bcra.badlar"], recipes: ["level"], frequency: "M", from: "2017-01-01", method: "auto_arima", log: false, note: "Promedio mensual (% TNA)." },
  { title: "Actividad (EMAE desest.)", ids: ["indec.emae_desest"], recipes: ["level"], frequency: "M", from: "2017-01-01", method: "auto_arima", log: true, note: "EMAE desestacionalizado, en logaritmos." },
  { title: "Salarios reales", ids: ["calc.salarios_reales"], recipes: ["level"], frequency: "M", from: "2017-01-01", method: "auto_arima", log: true, note: "Índice de salarios deflactado por IPC." },
];

type ExogScenario = { mode: "last" | "growth" | "manual"; growth: number; manual: string };

interface ForecastOut {
  ms?: number;
  dataset: PreparedDataset;
  history: Pt[];
  result: ForecastResult;
}

function exogPath(hist: number[], sc: ExogScenario, h: number): number[] | null {
  const last = hist[hist.length - 1];
  if (sc.mode === "last") return Array(h).fill(last);
  if (sc.mode === "growth") return Array.from({ length: h }, (_, i) => last * Math.pow(1 + sc.growth / 100, i + 1));
  const v = sc.manual.split(/[;\s]+/).map((x) => Number(x.replace(",", "."))).filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return Array.from({ length: h }, (_, i) => v[Math.min(i, v.length - 1)]);
}

export function ForecastTab({ ds, names, loadDataset }: TabProps) {
  const [target, setTarget] = useState(0);
  const [method, setMethod] = useState<ForecastMethod>("auto_arima");
  const [horizon, setHorizon] = useState(12);
  const [log, setLog] = useState(false);
  const [order, setOrder] = useState<ArimaOrder>({ p: 1, d: 1, q: 0 });
  const [varLags, setVarLags] = useState(2);
  const [exog, setExog] = useState<number[]>([]);
  const [scen, setScen] = useState<Record<number, ExogScenario>>({});
  const [scenError, setScenError] = useState<string | null>(null);
  const run = useRun<ForecastOut>();
  const r = run.result;
  const needsExog = method === "regression" || method === "var";
  const others = names.map((n, i) => ({ n, i })).filter((x) => x.i !== target);
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

  const exec = async () => {
    setScenError(null);
    const cols = needsExog ? exog.filter((c) => c !== target) : [];
    const spec: ForecastSpec = { method, horizon, log, order: method === "arima" ? order : undefined, constant: order.d < 2, varLags };
    if (method === "regression") {
      // El escenario se arma sobre el último dato observado de cada explicativa.
      const { prepare } = await import("@/lib/econ/tasks");
      try {
        const d = prepare(ds);
        const fut: number[][] = [];
        for (const c of cols) {
          const p = exogPath(d.columns[c], scen[c] ?? { mode: "last", growth: 0, manual: "" }, horizon);
          if (!p) throw new Error(`Escenario inválido para ${names[c]}`);
          fut.push(p);
        }
        spec.exogFuture = fut;
      } catch (e) {
        setScenError((e as Error).message);
        return;
      }
    }
    void run.exec({ kind: "forecast", ds, target, spec, exogColumns: cols });
  };

  return (
    <>
      <Card title="Atajos: proyecciones de variables clave">
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {FORECAST_PRESETS.map((p) => (
            <li key={p.title}>
              <button
                type="button"
                className="h-full w-full rounded border border-border/60 px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  loadDataset(p);
                  setTarget(0);
                  setMethod(p.method);
                  setLog(p.log);
                }}
              >
                <span className="block text-xs">{p.title}</span>
                <span className="block text-[10px] text-muted-foreground">{p.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Proyección">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Variable a proyectar" className="col-span-2">
            <select className={selectCls} value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Método" className="col-span-2">
            <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as ForecastMethod)}>
              {(Object.keys(METHOD_LABEL) as ForecastMethod[]).map((m) => (
                <option key={m} value={m} disabled={(m === "regression" || m === "var") && names.length < 2}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Horizonte (períodos)">
            <input type="number" className={inputCls} min={1} max={60} value={horizon} onChange={(e) => setHorizon(num(e.target.value, 1, 60))} />
          </Field>
          <Field label="Escala del modelo">
            <select className={selectCls} value={log ? "1" : "0"} onChange={(e) => setLog(e.target.value === "1")}>
              <option value="0">Niveles</option>
              <option value="1">Logaritmos (series positivas)</option>
            </select>
          </Field>
          {method === "arima" && (
            <>
              <Field label="p">
                <input type="number" className={inputCls} min={0} max={6} value={order.p} onChange={(e) => setOrder({ ...order, p: num(e.target.value, 0, 6) })} />
              </Field>
              <Field label="d">
                <input type="number" className={inputCls} min={0} max={2} value={order.d} onChange={(e) => setOrder({ ...order, d: num(e.target.value, 0, 2) })} />
              </Field>
              <Field label="q">
                <input type="number" className={inputCls} min={0} max={6} value={order.q} onChange={(e) => setOrder({ ...order, q: num(e.target.value, 0, 6) })} />
              </Field>
            </>
          )}
          {method === "var" && (
            <Field label="Rezagos del VAR">
              <input type="number" className={inputCls} min={1} max={12} value={varLags} onChange={(e) => setVarLags(num(e.target.value, 1, 12))} />
            </Field>
          )}
        </div>
        {needsExog && (
          <fieldset className="mt-3">
            <legend className="mb-1 text-xs text-muted-foreground">{method === "regression" ? "Variables explicativas y su escenario futuro" : "Otras variables del VAR"}</legend>
            <ul className="flex flex-col gap-2">
              {others.map(({ n, i }) => {
                const sc = scen[i] ?? { mode: "last", growth: 0, manual: "" };
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-1.5">
                    <input type="checkbox" checked={exog.includes(i)} onChange={(e) => setExog(e.target.checked ? [...exog, i] : exog.filter((x) => x !== i))} aria-label={`Usar ${n}`} />
                    <span className="min-w-0 flex-1 truncate text-xs">{n}</span>
                    {method === "regression" && exog.includes(i) && (
                      <>
                        <select className={`${selectCls} w-auto`} value={sc.mode} onChange={(e) => setScen({ ...scen, [i]: { ...sc, mode: e.target.value as ExogScenario["mode"] } })} aria-label={`Escenario de ${n}`}>
                          <option value="last">Constante en el último valor</option>
                          <option value="growth">Crece a tasa fija</option>
                          <option value="manual">Valores manuales</option>
                        </select>
                        {sc.mode === "growth" && (
                          <input className={`${inputCls} w-24`} value={sc.growth} onChange={(e) => setScen({ ...scen, [i]: { ...sc, growth: Number(e.target.value) || 0 } })} aria-label="% por período" placeholder="% por período" />
                        )}
                        {sc.mode === "manual" && (
                          <input className={`${inputCls} w-56`} value={sc.manual} onChange={(e) => setScen({ ...scen, [i]: { ...sc, manual: e.target.value } })} aria-label="Valores separados por punto y coma" placeholder="Ej.: 3; 2,8; 2,5" />
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <p className="max-w-xl text-[10px] text-muted-foreground">El período histórico de estimación es el elegido a la izquierda (Desde/Hasta). Las bandas muestran incertidumbre; la proyección no es una certeza.</p>
          <RunButton busy={run.busy} onClick={() => void exec()} disabled={needsExog && !exog.filter((c) => c !== target).length} label="Proyectar" />
        </div>
      </Card>
      {scenError && <ErrorBox message={scenError} />}
      {run.error && <ErrorBox message={run.error} />}
      {r && <ForecastView r={r} name={names[target]} />}
    </>
  );
}

function ForecastView({ r, name }: { r: ForecastOut; name: string }) {
  const f = r.result;
  const lvl = (p: (typeof f.points)[number], l: number) => p.bands.find((b) => b.level === l);
  const hist = r.history.slice(-Math.max(48, f.points.length * 3));
  const data = [
    ...hist.map((p) => ({ x: p.d, y: p.v })),
    ...f.points.map((p) => ({ x: p.d, f: p.mean, lo80: lvl(p, 0.8)?.lower ?? null, hi80: lvl(p, 0.8)?.upper ?? null, lo95: lvl(p, 0.95)?.lower ?? null, hi95: lvl(p, 0.95)?.upper ?? null })),
  ];
  const methodology = [
    ...datasetSheet(r.dataset).methodology,
    `Método: ${f.label}. Estimación: ${f.estimation.from} → ${f.estimation.to} (${f.estimation.n} obs.).`,
    ...f.details.map((d) => `${d.name}: ${d.value}`),
    ...(f.method === "arima" || f.method === "auto_arima" ? [ASSUMPTIONS.arima] : []),
    ...f.warnings,
  ];
  const lines = [
    { key: "y", name: "Observado", color: "var(--chart-1)" },
    { key: "f", name: "Proyección (bandas 80 % y 95 %)", color: "var(--chart-2)", dashed: true, band: [{ lo: "lo95", hi: "hi95", opacity: 0.12 }, { lo: "lo80", hi: "hi80", opacity: 0.22 }] },
  ];
  const last = f.points[f.points.length - 1];
  return (
    <>
      <DatasetSummary d={r.dataset} ms={r.ms} />
      <Notices warnings={f.warnings} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Método" value={f.label} />
        <Stat label="Estimación" value={`${f.estimation.from} → ${f.estimation.to}`} note={`${f.estimation.n} observaciones`} />
        <Stat label={`Proyección central a ${f.points.length} períodos`} value={fmt(last.mean)} strong note={last.d} />
        <Stat label="Rango 95 % al final" value={`${fmt(lvl(last, 0.95)?.lower)} — ${fmt(lvl(last, 0.95)?.upper)}`} />
      </div>
      <ChartBox
        title={`Proyección: ${name}`}
        sheets={[
          {
            name: "Proyección",
            header: ["Fecha", "Proyección central", "80 % inf.", "80 % sup.", "95 % inf.", "95 % sup."],
            rows: f.points.map((p) => [p.d, p.mean, lvl(p, 0.8)?.lower ?? null, lvl(p, 0.8)?.upper ?? null, lvl(p, 0.95)?.lower ?? null, lvl(p, 0.95)?.upper ?? null]),
          },
          { name: "Modelo", header: ["Elemento", "Valor"], rows: f.details.map((d) => [d.name, d.value]) },
        ]}
        methodology={methodology}
      >
        <LinesChart data={data} lines={lines} refX={hist[hist.length - 1]?.d} />
        <Legend lines={lines} />
      </ChartBox>
      <Card title="Modelo estimado">
        <ResultTable title="Modelo de proyección" methodology={methodology} sheet={{ name: "Modelo", header: ["Elemento", "Valor"], rows: f.details.map((d) => [d.name, d.value]) }} />
      </Card>
    </>
  );
}

// ── Backtesting ────────────────────────────────────────────────────────────

interface BacktestOut {
  ms?: number;
  dataset: PreparedDataset;
  result: BacktestResult;
}

export function BacktestTab({ ds, names, ids, freqs, recipeKeys }: TabProps) {
  const [target, setTarget] = useState(0);
  const [method, setMethod] = useState<ForecastMethod>("auto_arima");
  const [horizon, setHorizon] = useState(6);
  const [log, setLog] = useState(false);
  const [order, setOrder] = useState<ArimaOrder>({ p: 1, d: 1, q: 0 });
  const [start, setStart] = useState("2022-01-01");
  const [step, setStep] = useState(1);
  const [useVintages, setUseVintages] = useState(true);
  const [vintageNote, setVintageNote] = useState<string | null>(null);
  const run = useRun<BacktestOut>();
  const r = run.result;
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

  const exec = async () => {
    setVintageNote(null);
    let vintages: { observations: VintageObservation[]; revisions: Revision[]; recipe: (typeof RECIPES)[string]["steps"] } | undefined;
    if (useVintages) {
      try {
        const res = await fetch(`/api/series/vintages?id=${encodeURIComponent(ids[target])}`);
        const j = (await res.json()) as { observations?: VintageObservation[]; revisions?: Revision[]; trackedSince?: string | null; error?: string };
        if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
        vintages = { observations: j.observations ?? [], revisions: j.revisions ?? [], recipe: RECIPES[recipeKeys[target]]?.steps ?? [] };
        setVintageNote(
          j.trackedSince
            ? `La plataforma registra publicaciones y revisiones de esta serie desde ${j.trackedSince} (${(j.revisions ?? []).length} revisiones registradas). Para orígenes anteriores se usan los datos vigentes.`
            : null,
        );
      } catch (e) {
        setVintageNote(`No se pudieron obtener las versiones publicadas (${(e as Error).message}): se usan los datos vigentes.`);
      }
    }
    void run.exec({
      kind: "backtest",
      ds,
      target,
      spec: { method, horizon, log, order: method === "arima" ? order : undefined, constant: order.d < 2, varLags: 2 },
      exogColumns: method === "var" ? names.map((_, i) => i).filter((i) => i !== target) : [],
      start,
      step,
      vintages,
    });
  };

  return (
    <>
      <Card title="Backtesting: evaluación histórica de pronósticos">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Variable" className="col-span-2">
            <select className={selectCls} value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Modelo" className="col-span-2">
            <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as ForecastMethod)}>
              {(["naive", "drift", "mean", "arima", "auto_arima", "var"] as ForecastMethod[]).map((m) => (
                <option key={m} value={m} disabled={m === "var" && names.length < 2}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Primer origen">
            <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Horizonte">
            <input type="number" className={inputCls} min={1} max={24} value={horizon} onChange={(e) => setHorizon(num(e.target.value, 1, 24))} />
          </Field>
          <Field label="Paso entre orígenes">
            <input type="number" className={inputCls} min={1} max={24} value={step} onChange={(e) => setStep(num(e.target.value, 1, 24))} />
          </Field>
          <Field label="Escala">
            <select className={selectCls} value={log ? "1" : "0"} onChange={(e) => setLog(e.target.value === "1")}>
              <option value="0">Niveles</option>
              <option value="1">Logaritmos</option>
            </select>
          </Field>
          {method === "arima" && (
            <>
              <Field label="p">
                <input type="number" className={inputCls} min={0} max={6} value={order.p} onChange={(e) => setOrder({ ...order, p: num(e.target.value, 0, 6) })} />
              </Field>
              <Field label="d">
                <input type="number" className={inputCls} min={0} max={2} value={order.d} onChange={(e) => setOrder({ ...order, d: num(e.target.value, 0, 2) })} />
              </Field>
              <Field label="q">
                <input type="number" className={inputCls} min={0} max={6} value={order.q} onChange={(e) => setOrder({ ...order, q: num(e.target.value, 0, 6) })} />
              </Field>
            </>
          )}
          <Field label="Versiones publicadas" className="col-span-2">
            <select className={selectCls} value={useVintages ? "1" : "0"} onChange={(e) => setUseVintages(e.target.value === "1")} disabled={method === "var"}>
              <option value="1">Usar vintages cuando existan</option>
              <option value="0">Solo datos vigentes</option>
            </select>
          </Field>
          <RunButton busy={run.busy} onClick={() => void exec()} label="Evaluar" />
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          En cada origen el modelo se reestima solo con datos hasta esa fecha (ventana expansiva). {method === "auto_arima" && "El ARIMA automático reelige el orden en cada origen: puede tardar."}{" "}
          {freqs[target] !== "M" && freqs[target] !== ds.frequency ? "Las vintages solo se usan si la serie no cambia de frecuencia al alinear." : ""}
        </p>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && <BacktestView r={r} name={names[target]} vintageNote={vintageNote} method={method} />}
    </>
  );
}

function BacktestView({ r, name, vintageNote, method }: { r: BacktestOut; name: string; vintageNote: string | null; method: ForecastMethod }) {
  const b = r.result;
  const methodology = [
    ...datasetSheet(r.dataset).methodology,
    `Modelo: ${METHOD_LABEL[method]}. ${b.origins} orígenes, horizonte ${b.horizon}.`,
    "MAE = promedio |pronóstico − observado|; RMSE = raíz del error cuadrático medio; MAPE = promedio |error/observado| × 100; sesgo = promedio (pronóstico − observado).",
    ...b.notes,
    ...(b.mapeNote ? [b.mapeNote] : []),
  ];
  const one = b.records.filter((x) => x.h === 1);
  const data = one.map((x) => ({ x: x.target, y: x.actual, f: x.forecast, lo: x.lower95, hi: x.upper95 }));
  const lines = [
    { key: "y", name: "Observado", color: "var(--chart-1)" },
    { key: "f", name: "Pronóstico a 1 período (banda 95 %)", color: "var(--chart-2)", dashed: true, band: [{ lo: "lo", hi: "hi", opacity: 0.15 }] },
  ];
  return (
    <>
      <DatasetSummary d={r.dataset} ms={r.ms} />
      <Notices warnings={[...(b.mapeNote ? [b.mapeNote] : []), ...(b.failures.length ? [`${b.failures.length} origen(es) no pudieron estimarse (${b.failures[0].error}).`] : [])]} infos={[...b.notes, ...(vintageNote ? [vintageNote] : [])]} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Orígenes" value={String(b.origins)} />
        <Stat label="MAE" value={fmt(b.overall.mae)} strong />
        <Stat label="RMSE" value={fmt(b.overall.rmse)} strong />
        <Stat label="MAPE" value={b.overall.mape === null ? "No apropiado" : `${fmt(b.overall.mape, 2)} %`} />
        <Stat label="Sesgo medio" value={fmt(b.overall.bias)} note={b.overall.bias > 0 ? "Sobreestima" : "Subestima"} />
        <Stat label="RMSE relativo al ingenuo" value={fmt(b.overall.relRmse, 3)} note={b.coverage95 !== null ? `Cobertura banda 95 %: ${fmt(b.coverage95 * 100, 1)} %` : undefined} />
      </div>
      <Card title="Errores por horizonte">
        <ResultTable
          title={`Backtesting ${name}`}
          methodology={methodology}
          sheet={{
            name: "Por horizonte",
            header: ["Horizonte", "Pronósticos", "MAE", "RMSE", "MAPE (%)", "Sesgo", "RMSE ingenuo", "RMSE relativo"],
            rows: b.byHorizon.map((x) => [x.h, x.n, x.mae, x.rmse, x.mape, x.bias, x.naiveRmse, x.relRmse]),
          }}
        />
      </Card>
      <ChartBox
        title="Pronósticos a un período vs. observado"
        sheets={[{ name: "Pronósticos", header: ["Origen", "Fecha objetivo", "Horizonte", "Pronóstico", "Observado", "95 % inf.", "95 % sup.", "Vintage"], rows: b.records.map((x) => [x.origin, x.target, x.h, x.forecast, x.actual, x.lower95, x.upper95, x.vintage ? "sí" : "no"]) }]}
        methodology={methodology}
      >
        <LinesChart data={data} lines={lines} />
        <Legend lines={lines} />
      </ChartBox>
    </>
  );
}
