"use client";

import { useState } from "react";
import type { Pt } from "@/lib/analysis/types";
import type { CorrMatrix, CorrMethod, CorrResult, LagCorr } from "@/lib/econ/correlation";
import type { CovType, OlsResult, RegressorSpec } from "@/lib/econ/regression";
import type { CagrResult, Descriptive } from "@/lib/econ/stats";
import type { PreparedDataset } from "@/lib/econ/tasks";
import { datasetSheet, type TabProps } from "./workbench";
import { useRun } from "./use-econ";
import { Card, ChartBox, CorrHeatmap, ErrorBox, Field, fmt, fmtP, inputCls, Legend, LinesChart, Notices, ResultTable, RunButton, selectCls, SIG_NOTE, Stat, hue } from "./ui";

/** Resumen del dataset preparado: receta y notas de alineación. */
export function DatasetSummary({ d, ms }: { d: PreparedDataset; ms?: number }) {
  const { sheet, methodology } = datasetSheet(d);
  return (
    <details className="rounded-md border border-border bg-card p-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Datos usados: <span className="num">{d.dates.length}</span> observaciones {d.dates[0]} → {d.dates[d.dates.length - 1]} · receta y exportación
        {ms !== undefined && <span className="num"> · {Math.round(ms)} ms</span>}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <ul className="flex flex-col gap-1">
          {d.series.map((s) => (
            <li key={s.id}>
              <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">({s.source} {s.code ?? s.id}) → {s.unit}</span>
              {s.log.map((l) => (
                <div key={l} className="num pl-3 text-[10px] text-muted-foreground">
                  {l}
                </div>
              ))}
            </li>
          ))}
        </ul>
        <Notices infos={d.notes} />
        <ResultTable title="Datos del análisis" sheet={sheet} methodology={methodology} maxRows={24} />
      </div>
    </details>
  );
}

// ── Descriptiva ─────────────────────────────────────────────────────────────

interface DescribeOut {
  ms?: number;
  dataset: PreparedDataset;
  stats: { describe: Descriptive; cagr: CagrResult | null; ma: Pt[]; volatility: Pt[] | null; annualization: number }[];
}

export function DescriptiveTab({ ds }: TabProps) {
  const [window, setWindow] = useState(12);
  const run = useRun<DescribeOut>();
  const r = run.result;
  const methodology = r ? datasetSheet(r.dataset).methodology : [];
  const rowsDef: [string, (s: DescribeOut["stats"][number]) => string | number | null][] = [
    ["Observaciones", (s) => s.describe.n],
    ["Media", (s) => s.describe.mean],
    ["Mediana", (s) => s.describe.median],
    ["Moda", (s) => (s.describe.mode.kind === "exact" ? s.describe.mode.values.map((v) => fmt(v)).join(" · ") + ` (${s.describe.mode.count} veces)` : s.describe.mode.kind === "interval" ? `[${fmt(s.describe.mode.interval![0])}; ${fmt(s.describe.mode.interval![1])}) clase modal` : "—")],
    ["Varianza", (s) => s.describe.variance],
    ["Desvío estándar", (s) => s.describe.std],
    ["Coef. de variación (%)", (s) => s.describe.cv],
    ["Mínimo", (s) => (s.describe.min ? `${fmt(s.describe.min.v)} (${s.describe.min.d})` : null)],
    ["Máximo", (s) => (s.describe.max ? `${fmt(s.describe.max.v)} (${s.describe.max.d})` : null)],
    ["Percentil 5", (s) => s.describe.percentiles.p5],
    ["Percentil 25", (s) => s.describe.percentiles.p25],
    ["Percentil 75", (s) => s.describe.percentiles.p75],
    ["Percentil 95", (s) => s.describe.percentiles.p95],
    ["Asimetría", (s) => s.describe.skewness],
    ["Curtosis (exceso)", (s) => s.describe.kurtosis],
    ["Atípicos (Tukey)", (s) => s.describe.outliers.length],
    ["CAGR (% anual)", (s) => s.cagr?.cagr ?? null],
    ["Crecimiento acumulado (%)", (s) => s.cagr?.total ?? null],
  ];
  return (
    <>
      <Card title="Estadística descriptiva">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Ventana móvil (períodos)" hint="Promedio móvil y volatilidad">
            <input type="number" min={2} max={120} className={`${inputCls} w-28`} value={window} onChange={(e) => setWindow(Math.max(2, Number(e.target.value) || 12))} />
          </Field>
          <RunButton busy={run.busy} onClick={() => void run.exec({ kind: "describe", ds, window })} />
        </div>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && (
        <>
          <DatasetSummary d={r.dataset} ms={r.ms} />
          <Card title="Resumen por serie">
            <ResultTable
              title="Estadística descriptiva"
              methodology={[...methodology, "Varianza y desvío muestrales (n−1). Percentiles con interpolación lineal. CAGR = (final/inicial)^(1/años) − 1, años = días/365,25. Atípicos: fuera de Q1 − 1,5·IQR y Q3 + 1,5·IQR."]}
              sheet={{ name: "Descriptiva", header: ["Estadístico", ...r.dataset.series.map((s) => s.name)], rows: rowsDef.map(([name, f]) => [name, ...r.stats.map(f)]) }}
            />
            <p className="mt-2 text-[10px] text-muted-foreground">
              Moda: si ningún valor se repite (habitual en series continuas) se informa la clase modal de un histograma (ancho de Freedman-Diaconis). CV vacío cuando la media es ~0 o la serie cambia de signo.
            </p>
          </Card>
          {r.dataset.series.map((s, j) => {
            const st = r.stats[j];
            const ma = new Map(st.ma.map((p) => [p.d, p.v]));
            const vol = new Map((st.volatility ?? []).map((p) => [p.d, p.v]));
            const data = r.dataset.dates.map((d, t) => ({ x: d, v: r.dataset.columns[j][t], ma: ma.get(d) ?? null, vol: vol.get(d) ?? null }));
            const lines = [
              { key: "v", name: s.name, color: hue(j) },
              { key: "ma", name: `Promedio móvil ${window}`, color: "var(--chart-4)", dashed: true },
            ];
            return (
              <ChartBox
                key={s.id}
                title={`${s.name} — ${s.unit}`}
                sheets={[{ name: "Serie", header: ["Fecha", s.name, `Prom. móvil ${window}`, "Volatilidad anualizada (%)"], rows: data.map((x) => [x.x, x.v, x.ma, x.vol]) }]}
                methodology={methodology}
              >
                <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Media" value={fmt(st.describe.mean)} />
                  <Stat label="Desvío" value={fmt(st.describe.std)} />
                  <Stat label="Mín." value={fmt(st.describe.min?.v)} note={st.describe.min?.d} />
                  <Stat label="Máx." value={fmt(st.describe.max?.v)} note={st.describe.max?.d} />
                </div>
                <LinesChart data={data} lines={lines} zero />
                <Legend lines={lines} />
                {st.volatility && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] text-muted-foreground">
                      Volatilidad móvil: desvío de las variaciones logarítmicas en {window} períodos, anualizado (×√{st.annualization}), en %.
                    </p>
                    <LinesChart data={data} lines={[{ key: "vol", name: "Volatilidad anualizada (%)", color: "var(--chart-2)" }]} height={160} />
                  </div>
                )}
              </ChartBox>
            );
          })}
        </>
      )}
    </>
  );
}

// ── Correlaciones ──────────────────────────────────────────────────────────

interface CorrOut {
  ms?: number;
  dataset: PreparedDataset;
  matrix: CorrMatrix;
  pair: CorrResult | null;
  lagged: LagCorr[];
  rolling: { d: string; r: number | null }[];
  warnings: string[];
}

export function CorrelationTab({ ds, names }: TabProps) {
  const [method, setMethod] = useState<CorrMethod>("pearson");
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.min(1, names.length - 1));
  const [maxLag, setMaxLag] = useState(12);
  const [window, setWindow] = useState(24);
  const run = useRun<CorrOut>();
  const r = run.result;
  const methodology = r ? datasetSheet(r.dataset).methodology : [];
  if (names.length < 2) return <Notices infos={["Elegí al menos dos series para calcular correlaciones."]} />;
  return (
    <>
      <Card title="Correlaciones">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Método">
            <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as CorrMethod)}>
              <option value="pearson">Pearson (lineal)</option>
              <option value="spearman">Spearman (rangos)</option>
            </select>
          </Field>
          <Field label="Serie X (adelanta)">
            <select className={selectCls} value={a} onChange={(e) => setA(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Serie Y">
            <select className={selectCls} value={b} onChange={(e) => setB(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Rezagos ±">
            <input type="number" min={0} max={36} className={inputCls} value={maxLag} onChange={(e) => setMaxLag(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Ventana móvil">
            <input type="number" min={6} max={240} className={inputCls} value={window} onChange={(e) => setWindow(Math.max(6, Number(e.target.value) || 24))} />
          </Field>
          <RunButton busy={run.busy} disabled={a === b} onClick={() => void run.exec({ kind: "correlation", ds, method, pair: [a, b], maxLag, window })} />
        </div>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && (
        <>
          <DatasetSummary d={r.dataset} ms={r.ms} />
          <Notices warnings={r.warnings} />
          <Card title={`Matriz de correlaciones (${r.matrix.method === "pearson" ? "Pearson" : "Spearman"}, n = ${r.matrix.n}, ${r.dataset.dates[0]} → ${r.dataset.dates[r.dataset.dates.length - 1]})`}>
            <CorrHeatmap names={r.matrix.names} r={r.matrix.r} p={r.matrix.p} />
            <p className="mt-2 text-[10px] text-muted-foreground">{SIG_NOTE} H0: correlación poblacional nula (t con n − 2 g.l.). Azul: positiva; naranja: negativa.</p>
            <div className="mt-2">
              <ResultTable
                title="Matriz de correlaciones"
                methodology={methodology}
                sheet={{
                  name: "Correlaciones",
                  header: ["Par de series", "Coeficiente", "p-valor", "n"],
                  rows: r.matrix.names.flatMap((na, i) =>
                    r.matrix.names.slice(i + 1).map((nb, k) => [`${na} × ${nb}`, r.matrix.r[i][i + 1 + k], fmtP(r.matrix.p[i][i + 1 + k]), r.matrix.n]),
                  ),
                }}
              />
            </div>
          </Card>
          {r.pair && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Coeficiente" value={fmt(r.pair.r, 4)} strong />
              <Stat label="p-valor" value={fmtP(r.pair.p)} />
              <Stat label="Observaciones" value={String(r.pair.n)} />
              <Stat label="IC 95 % (Fisher)" value={r.pair.ci95 ? `${fmt(r.pair.ci95[0], 3)} — ${fmt(r.pair.ci95[1], 3)}` : "—"} />
            </div>
          )}
          {r.lagged.length > 0 && (
            <ChartBox
              title={`Correlación con rezagos: ${names[a]} (t − k) vs. ${names[b]} (t)`}
              sheets={[{ name: "Rezagos", header: ["Rezago k", "Coeficiente", "p-valor", "n"], rows: r.lagged.map((l) => [l.lag, l.r, l.p, l.n]) }]}
              methodology={[...methodology, "k > 0: la serie X adelanta a Y en k períodos; k < 0: Y adelanta a X. Cada rezago usa su propio n."]}
            >
              <LinesChart data={r.lagged.map((l) => ({ x: String(l.lag), r: l.r }))} lines={[{ key: "r", name: "Correlación" }]} zero height={220} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Máximo |r| en k = {(() => {
                  const best = r.lagged.reduce((m, l) => (Math.abs(l.r) > Math.abs(m.r) ? l : m));
                  return `${best.lag} (r = ${fmt(best.r, 3)}, p ${fmtP(best.p)})`;
                })()}. Un rezago con mayor correlación no prueba que X cause Y.
              </p>
            </ChartBox>
          )}
          {r.rolling.length > 0 && (
            <ChartBox
              title={`Correlación móvil (${window} períodos)`}
              sheets={[{ name: "Correlación móvil", header: ["Fecha (fin de ventana)", "Coeficiente"], rows: r.rolling.map((x) => [x.d, x.r]) }]}
              methodology={methodology}
            >
              <LinesChart data={r.rolling.map((x) => ({ x: x.d, r: x.r }))} lines={[{ key: "r", name: "Correlación móvil" }]} zero height={220} />
            </ChartBox>
          )}
        </>
      )}
    </>
  );
}

// ── Regresión ───────────────────────────────────────────────────────────────

interface RegOut {
  ms?: number;
  dataset: PreparedDataset;
  design: { dates: string[]; dropped: number; y: number[] };
  result: OlsResult;
  warnings: string[];
}

const parseLags = (s: string) =>
  [...new Set(s.split(/[,\s]+/).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 24))].sort((a, b) => a - b);

export function RegressionTab({ ds, names }: TabProps) {
  const [dep, setDep] = useState(0);
  const [lags, setLags] = useState<string[]>(() => names.map(() => "0"));
  const [use, setUse] = useState<boolean[]>(() => names.map((_, i) => i !== 0));
  const [depLags, setDepLags] = useState("");
  const [cov, setCov] = useState<CovType>("HAC");
  const [constant, setConstant] = useState(true);
  const run = useRun<RegOut>();
  const r = run.result;
  const methodology = r ? datasetSheet(r.dataset).methodology : [];
  const regressors: RegressorSpec[] = names
    .map((n, i) => ({ column: i, name: n, lags: parseLags(lags[i] ?? "0") }))
    .filter((x, i) => i !== dep && use[i] && x.lags.length);
  return (
    <>
      <Card title="Regresión lineal por mínimos cuadrados ordinarios">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Variable dependiente (Y)">
            <select className={selectCls} value={dep} onChange={(e) => setDep(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Rezagos de Y (autorregresivos)" hint="Ej.: 1, 2 · vacío = ninguno">
            <input className={inputCls} value={depLags} onChange={(e) => setDepLags(e.target.value)} placeholder="ninguno" />
          </Field>
          <Field label="Errores estándar">
            <select className={selectCls} value={cov} onChange={(e) => setCov(e.target.value as CovType)}>
              <option value="nonrobust">Clásicos (homocedásticos)</option>
              <option value="HC1">Robustos a heterocedasticidad (HC1)</option>
              <option value="HAC">Newey-West (HAC): autocorrelación</option>
            </select>
          </Field>
          <Field label="Constante">
            <select className={selectCls} value={constant ? "1" : "0"} onChange={(e) => setConstant(e.target.value === "1")}>
              <option value="1">Con constante</option>
              <option value="0">Sin constante</option>
            </select>
          </Field>
        </div>
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs text-muted-foreground">Variables explicativas y sus rezagos (0 = contemporánea; ej. &quot;0, 1, 3&quot;)</legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {names.map((n, i) =>
              i === dep ? null : (
                <li key={i} className="flex items-center gap-2 rounded border border-border/60 p-1.5">
                  <input type="checkbox" checked={use[i] ?? false} onChange={(e) => setUse(use.map((u, j) => (j === i ? e.target.checked : u)))} aria-label={`Usar ${n}`} />
                  <span className="min-w-0 flex-1 truncate text-xs">{n}</span>
                  <input className={`${inputCls} w-24`} value={lags[i] ?? "0"} onChange={(e) => setLags(lags.map((l, j) => (j === i ? e.target.value : l)))} aria-label={`Rezagos de ${n}`} />
                </li>
              ),
            )}
          </ul>
        </fieldset>
        <div className="mt-3 flex justify-end">
          <RunButton
            busy={run.busy}
            disabled={!regressors.length && !parseLags(depLags).filter((x) => x > 0).length}
            onClick={() => void run.exec({ kind: "regression", ds, dep, regressors, depLags: parseLags(depLags).filter((x) => x > 0), covType: cov, constant })}
            label="Estimar"
          />
        </div>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && <RegressionResult r={r} methodology={methodology} name={names[dep]} />}
    </>
  );
}

function RegressionResult({ r, methodology, name }: { r: RegOut; methodology: string[]; name: string }) {
  const o = r.result;
  const d = o.diagnostics;
  const covLabel = o.covType === "HAC" ? `Newey-West (HAC, ${o.hacLags} rezagos)` : o.covType === "HC1" ? "robustos HC1" : "clásicos";
  const meth = [
    ...methodology,
    `MCO. Errores estándar ${covLabel}. Intervalos al ${Math.round(o.confidence * 100)} % con t de Student (${o.dfResid} g.l.).`,
    `Se descartaron ${r.design.dropped} observaciones iniciales por los rezagos (no se rellenan).`,
    ...r.warnings,
  ];
  const fitted = r.design.dates.map((dt, t) => ({ x: dt, y: r.design.y[t], fit: o.fitted[t], e: o.residuals[t] }));
  return (
    <>
      <DatasetSummary d={r.dataset} ms={r.ms} />
      <Notices warnings={r.warnings} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="R²" value={fmt(o.r2, 4)} strong />
        <Stat label="R² ajustado" value={fmt(o.adjR2, 4)} strong />
        <Stat label="Observaciones" value={String(o.n)} note={`${r.design.dates[0]} → ${r.design.dates[r.design.dates.length - 1]}`} />
        <Stat label="F conjunta" value={fmt(o.fStat)} note={`p ${fmtP(o.fP)}`} />
        <Stat label="σ residual" value={fmt(o.sigma)} />
        <Stat label="AIC / BIC" value={`${fmt(o.aic, 1)} / ${fmt(o.bic, 1)}`} />
      </div>
      <Card title={`Coeficientes — Y: ${name}`}>
        <ResultTable
          title="Regresión MCO"
          methodology={meth}
          sheet={{
            name: "Coeficientes",
            header: ["Variable", "Coeficiente", "Error estándar", "t", "p-valor", `IC ${Math.round(o.confidence * 100)} % inf.`, `IC ${Math.round(o.confidence * 100)} % sup.`],
            rows: o.coefficients.map((c) => [c.name, c.coef, c.se, c.t, fmtP(c.p), c.ciLow, c.ciHigh]),
          }}
          highlight={(row) => typeof row[4] === "string" && row[4].includes("**")}
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          {SIG_NOTE} Errores estándar {covLabel}. Un coeficiente significativo indica asociación condicional en la muestra, no causalidad.
        </p>
      </Card>
      <Card title="Diagnósticos de residuos">
        <ResultTable
          title="Diagnósticos de residuos"
          methodology={meth}
          sheet={{
            name: "Diagnósticos",
            header: ["Prueba", "Estadístico", "p-valor", "Lectura"],
            rows: [
              ["Durbin-Watson (autocorrelación de orden 1)", d.durbinWatson, null, d.durbinWatson < 1.5 ? "Autocorrelación positiva" : d.durbinWatson > 2.5 ? "Autocorrelación negativa" : "Sin evidencia fuerte"],
              ...(d.ljungBox ? [[`Ljung-Box (${d.ljungBox.lags} rezagos)`, d.ljungBox.q, fmtP(d.ljungBox.p), d.ljungBox.p < 0.05 ? "Residuos autocorrelacionados" : "No se rechaza ruido blanco"] as (string | number | null)[]] : []),
              ["Jarque-Bera (normalidad)", d.jarqueBera.stat, fmtP(d.jarqueBera.p), d.jarqueBera.p < 0.05 ? "Residuos no normales" : "No se rechaza normalidad"],
              ...(d.breuschPagan ? [["Breusch-Pagan (heterocedasticidad)", d.breuschPagan.lm, fmtP(d.breuschPagan.p), d.breuschPagan.p < 0.05 ? "Heterocedasticidad: usá errores robustos" : "No se rechaza homocedasticidad"] as (string | number | null)[]] : []),
              ["Número de condición (X normalizada)", d.conditionNumber, null, d.conditionNumber > 30 ? "Posible multicolinealidad" : "Aceptable"],
              ...d.vif.map((v) => [`VIF — ${v.name}`, v.vif, null, v.vif > 10 ? "Multicolinealidad alta" : v.vif > 5 ? "Moderada" : "Baja"] as (string | number | null)[]),
            ],
          }}
        />
      </Card>
      <ChartBox title="Observado, ajustado y residuos" sheets={[{ name: "Ajuste", header: ["Fecha", "Observado", "Ajustado", "Residuo"], rows: fitted.map((f) => [f.x, f.y, f.fit, f.e]) }]} methodology={meth}>
        <LinesChart data={fitted} lines={[{ key: "y", name: "Observado" }, { key: "fit", name: "Ajustado", dashed: true, color: "var(--chart-2)" }]} />
        <Legend lines={[{ key: "y", name: "Observado" }, { key: "fit", name: "Ajustado", dashed: true, color: "var(--chart-2)" }]} />
        <p className="mt-3 mb-1 text-[11px] text-muted-foreground">Residuos</p>
        <LinesChart data={fitted} lines={[{ key: "e", name: "Residuo", color: "var(--chart-4)" }]} zero height={150} />
      </ChartBox>
    </>
  );
}
