"use client";

import { useState } from "react";
import type { ArimaModel, ArimaOrder, Forecast } from "@/lib/econ/arima";
import type { Decomposition } from "@/lib/econ/decompose";
import type { PreparedDataset } from "@/lib/econ/tasks";
import type { EngleGrangerResult, StationarityVerdict } from "@/lib/econ/unitroot";
import type { GrangerResult, Irf, LagSelection, VarForecast, VarModel } from "@/lib/econ/var";
import type { JohansenResult, VecmModel, VecmRequirements } from "@/lib/econ/vecm";
import { futureDates } from "@/lib/econ/forecast";
import { DatasetSummary } from "./tabs-basic";
import { datasetSheet, type TabProps } from "./workbench";
import { useRun } from "./use-econ";
import { Card, ChartBox, Correlogram, ErrorBox, Field, fmt, fmtP, hue, inputCls, Legend, LinesChart, Notices, ResultTable, RunButton, selectCls, SIG_NOTE, Stat } from "./ui";

const VERDICT: Record<StationarityVerdict["verdict"], string> = {
  stationary: "Estacionaria",
  unit_root: "Raíz unitaria (no estacionaria)",
  inconclusive: "No concluyente",
};

export const ASSUMPTIONS = {
  adf: "ADF — H0: la serie tiene raíz unitaria. Rezagos elegidos por AIC; p-valores de MacKinnon (1994). Baja potencia en muestras cortas y ante quiebres estructurales.",
  kpss: "KPSS — H0: la serie es estacionaria. Ancho de banda automático (Hobijn et al., 1998). El p-valor se interpola en la tabla original y queda acotado entre 0,01 y 0,10.",
  decomposition:
    "Descomposición clásica por medias móviles centradas (como seasonal_decompose de statsmodels). Supone estacionalidad fija en el tiempo y pierde los extremos de la tendencia; no reemplaza al X-13ARIMA-SEATS oficial.",
  hp: "Filtro de Hodrick-Prescott: tendencia suave con λ de Ravn-Uhlig por frecuencia. Tiene sesgo en los extremos de la muestra (la última parte de la tendencia se revisa al llegar datos nuevos).",
  arima:
    "ARIMA por máxima verosimilitud exacta (filtro de Kalman). Supone innovaciones ruido blanco gaussiano y parámetros estables; las bandas reflejan solo el ruido del modelo, no la incertidumbre de los parámetros ni cambios de régimen.",
  var: "VAR de forma reducida estimado por MCO. Supone variables estacionarias y relaciones lineales estables. Los impulsos ortogonalizados dependen del orden de las variables (Cholesky); no identifican shocks estructurales.",
  granger: "Causalidad de Granger: los rezagos de X mejoran la predicción de Y dentro del VAR (prueba F). Indica precedencia temporal y capacidad predictiva, no causalidad económica.",
  johansen:
    "Johansen (traza y máximo autovalor), constante sin restringir. Requiere series I(1); los valores críticos son asintóticos (Osterwald-Lenum) y la prueba tiende a sobrerrechazar en muestras cortas.",
  vecm: "VECM por máxima verosimilitud (Johansen). β normalizado con la identidad en las primeras r filas: los vectores dependen del orden de las series. α mide la velocidad de ajuste al equilibrio.",
};

// ── Univariado ──────────────────────────────────────────────────────────────

interface UniOut {
  ms?: number;
  dataset: PreparedDataset;
  levels: StationarityVerdict;
  diffs: StationarityVerdict | null;
  decomposition: Decomposition | null;
  decompError: string | null;
  hp: { lambda: number; trend: number[]; cycle: number[] } | null;
  trend: { trend: number[]; slope: number; growthPerPeriod: number | null };
  trendLog: boolean;
  acf: number[];
  pacf: number[];
  acfDiff: number[] | null;
  arima: ArimaModel | null;
  arimaTried: { order: ArimaOrder; aicc: number | null; error?: string }[];
  arimaError: string | null;
  forecast: Forecast | null;
}

function stationarityRows(label: string, v: StationarityVerdict): (string | number | null)[][] {
  return [
    [`${label} · ADF (${v.adf.regression === "ct" ? "constante y tendencia" : v.adf.regression === "c" ? "constante" : "sin constante"}, ${v.adf.usedLag} rezagos)`, v.adf.stat, fmtP(v.adf.p), v.adf.crit["5%"], v.adf.nobs],
    [`${label} · KPSS (${v.kpss.lags} rezagos)`, v.kpss.stat, `${v.kpss.pBound === "lower" ? "< " : v.kpss.pBound === "upper" ? "> " : ""}${fmt(v.kpss.p, 3)}`, v.kpss.crit["5%"], null],
  ];
}

export function UnivariateTab({ ds, names }: TabProps) {
  const [col, setCol] = useState(0);
  const [trend, setTrend] = useState<"c" | "ct">("c");
  const [model, setModel] = useState<"additive" | "multiplicative">("multiplicative");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [order, setOrder] = useState<ArimaOrder>({ p: 1, d: 1, q: 0 });
  const [constant, setConstant] = useState(true);
  const [horizon, setHorizon] = useState(12);
  const run = useRun<UniOut>();
  const r = run.result;
  const methodology = r ? datasetSheet(r.dataset).methodology : [];
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
  return (
    <>
      <Card title="Series temporales: tendencia, estacionalidad, raíz unitaria y ARIMA">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Serie" className="col-span-2">
            <select className={selectCls} value={col} onChange={(e) => setCol(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Términos de las pruebas">
            <select className={selectCls} value={trend} onChange={(e) => setTrend(e.target.value as "c" | "ct")}>
              <option value="c">Constante</option>
              <option value="ct">Constante y tendencia</option>
            </select>
          </Field>
          <Field label="Estacionalidad">
            <select className={selectCls} value={model} onChange={(e) => setModel(e.target.value as "additive" | "multiplicative")}>
              <option value="multiplicative">Multiplicativa</option>
              <option value="additive">Aditiva</option>
            </select>
          </Field>
          <Field label="ARIMA">
            <select className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as "auto" | "manual")}>
              <option value="auto">Automático (AICc)</option>
              <option value="manual">Orden manual</option>
            </select>
          </Field>
          {mode === "manual" && (
            <>
              <Field label="p (AR)">
                <input type="number" className={inputCls} value={order.p} min={0} max={6} onChange={(e) => setOrder({ ...order, p: num(e.target.value, 0, 6) })} />
              </Field>
              <Field label="d (diferencias)">
                <input type="number" className={inputCls} value={order.d} min={0} max={2} onChange={(e) => setOrder({ ...order, d: num(e.target.value, 0, 2) })} />
              </Field>
              <Field label="q (MA)">
                <input type="number" className={inputCls} value={order.q} min={0} max={6} onChange={(e) => setOrder({ ...order, q: num(e.target.value, 0, 6) })} />
              </Field>
              <Field label="Constante / deriva">
                <select className={selectCls} value={constant ? "1" : "0"} onChange={(e) => setConstant(e.target.value === "1")}>
                  <option value="1">Sí</option>
                  <option value="0">No</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Horizonte de pronóstico">
            <input type="number" className={inputCls} value={horizon} min={1} max={60} onChange={(e) => setHorizon(num(e.target.value, 1, 60))} />
          </Field>
          <RunButton busy={run.busy} onClick={() => void run.exec({ kind: "univariate", ds, column: col, trend, model, arima: mode === "auto" ? "auto" : order, constant: order.d < 2 && constant, horizon })} />
        </div>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && <UnivariateResult r={r} col={col} methodology={methodology} horizon={horizon} />}
    </>
  );
}

function UnivariateResult({ r, col, methodology, horizon }: { r: UniOut; col: number; methodology: string[]; horizon: number }) {
  const d = r.dataset;
  const s = d.series[col];
  const y = d.columns[col];
  const fc = r.forecast;
  const fd = fc ? futureDates(d.dates[d.dates.length - 1], d.frequency, fc.mean.length) : [];
  const b80 = fc?.bands.find((b) => b.level === 0.8);
  const b95 = fc?.bands.find((b) => b.level === 0.95);
  const fcData = [
    ...d.dates.slice(-Math.max(36, horizon * 3)).map((dt) => ({ x: dt, y: y[d.dates.indexOf(dt)] })),
    ...fd.map((dt, i) => ({ x: dt, f: fc!.mean[i], lo80: b80?.lower[i], hi80: b80?.upper[i], lo95: b95?.lower[i], hi95: b95?.upper[i] })),
  ];
  const decoData = d.dates.map((dt, t) => ({
    x: dt,
    y: y[t],
    trend: r.decomposition?.trend[t] ?? null,
    adj: r.decomposition?.adjusted[t] ?? null,
    hp: r.hp?.trend[t] ?? null,
    lin: r.trend.trend[t],
  }));
  const meth = [...methodology, ASSUMPTIONS.adf, ASSUMPTIONS.kpss, ASSUMPTIONS.decomposition, ASSUMPTIONS.hp, ASSUMPTIONS.arima];
  return (
    <>
      <DatasetSummary d={d} ms={r.ms} />
      <Card title={`Estacionariedad — ${s.name}`}>
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <Stat label="En niveles" value={VERDICT[r.levels.verdict]} note={r.levels.text} />
          {r.diffs && <Stat label="En primeras diferencias" value={VERDICT[r.diffs.verdict]} note={r.diffs.text} />}
        </div>
        <ResultTable
          title="Pruebas de raíz unitaria"
          methodology={meth}
          sheet={{
            name: "Raíz unitaria",
            header: ["Prueba", "Estadístico", "p-valor", "Valor crítico 5 %", "Obs."],
            rows: [...stationarityRows("Niveles", r.levels), ...(r.diffs ? stationarityRows("Diferencias", r.diffs) : [])],
          }}
        />
        <Notices infos={[ASSUMPTIONS.adf, ASSUMPTIONS.kpss]} />
      </Card>

      <ChartBox
        title="Tendencia y estacionalidad"
        sheets={[
          {
            name: "Descomposición",
            header: ["Fecha", "Serie", "Tendencia (MM centrada)", "Desestacionalizada", "Tendencia HP", r.trendLog ? "Tendencia log-lineal" : "Tendencia lineal"],
            rows: decoData.map((x) => [x.x, x.y, x.trend, x.adj, x.hp, x.lin]),
          },
        ]}
        methodology={meth}
      >
        <LinesChart
          data={decoData}
          lines={[
            { key: "y", name: "Serie", color: "var(--chart-4)" },
            ...(r.decomposition ? [{ key: "adj", name: "Desestacionalizada", color: "var(--chart-1)" }] : []),
            ...(r.hp ? [{ key: "hp", name: `Tendencia HP (λ = ${r.hp.lambda})`, color: "var(--chart-2)" }] : []),
            { key: "lin", name: r.trendLog ? "Tendencia log-lineal" : "Tendencia lineal", color: "var(--chart-3)", dashed: true },
          ]}
        />
        <Legend
          lines={[
            { key: "y", name: "Serie", color: "var(--chart-4)" },
            ...(r.decomposition ? [{ key: "adj", name: "Desestacionalizada", color: "var(--chart-1)" }] : []),
            ...(r.hp ? [{ key: "hp", name: `Tendencia HP (λ = ${r.hp.lambda})`, color: "var(--chart-2)" }] : []),
            { key: "lin", name: r.trendLog ? "Tendencia log-lineal" : "Tendencia lineal", color: "var(--chart-3)", dashed: true },
          ]}
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Stat label={r.trendLog ? "Crecimiento tendencial por período" : "Pendiente por período"} value={r.trendLog ? `${fmt(r.trend.growthPerPeriod, 3)} %` : fmt(r.trend.slope)} />
          {r.decomposition && <Stat label="Fuerza de la estacionalidad (0–1)" value={fmt(r.decomposition.strength, 3)} note="1 − Var(residuo)/Var(residuo + estacional)" />}
          {r.decomposition && (
            <Stat
              label="Factores estacionales"
              value={r.decomposition.factors.map((f) => fmt(f, r.decomposition!.model === "multiplicative" ? 3 : 2)).join(" · ")}
              note={`Desde ${d.dates[0].slice(5, 7)}/${d.dates[0].slice(0, 4)}, ${r.decomposition.model === "multiplicative" ? "multiplicativos" : "aditivos"}`}
            />
          )}
        </div>
        {r.decompError && <Notices infos={[`Estacionalidad: ${r.decompError}`]} />}
      </ChartBox>

      <Card title="Autocorrelación">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">ACF (niveles)</p>
            <Correlogram values={r.acf} n={y.length} label="Función de autocorrelación" />
          </div>
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">PACF (niveles)</p>
            <Correlogram values={r.pacf} n={y.length} label="Función de autocorrelación parcial" />
          </div>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Líneas punteadas: ±1,96/√n (significancia aproximada al 5 % bajo ruido blanco).</p>
      </Card>

      <Card title="Modelo ARIMA">
        {r.arimaError && <ErrorBox message={r.arimaError} />}
        {r.arima && (
          <>
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Modelo" value={`ARIMA(${r.arima.order.p},${r.arima.order.d},${r.arima.order.q})`} strong note={r.arima.constant ? (r.arima.order.d ? "con deriva" : "con media") : "sin constante"} />
              <Stat label="Log-verosimilitud" value={fmt(r.arima.llf, 2)} />
              <Stat label="AIC / AICc / BIC" value={`${fmt(r.arima.aic, 1)} / ${fmt(r.arima.aicc, 1)} / ${fmt(r.arima.bic, 1)}`} />
              <Stat label="Ljung-Box residuos" value={r.arima.ljungBox ? fmtP(r.arima.ljungBox.p) : "—"} note={r.arima.ljungBox ? `${r.arima.ljungBox.lags} rezagos` : undefined} />
            </div>
            <ResultTable
              title="Parámetros ARIMA"
              methodology={meth}
              sheet={{ name: "ARIMA", header: ["Parámetro", "Estimación", "Error estándar", "z", "p-valor"], rows: r.arima.params.map((p) => [p.name, p.value, p.se, p.z, fmtP(p.p)]) }}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">{SIG_NOTE} Errores estándar por hessiana numérica (información observada).</p>
            <Notices warnings={r.arima.warnings} />
            {r.arimaTried.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Modelos comparados ({r.arimaTried.length})</summary>
                <ResultTable
                  title="Selección ARIMA"
                  methodology={meth}
                  sheet={{ name: "Selección", header: ["Orden", "AICc", "Nota"], rows: [...r.arimaTried].sort((a, b) => (a.aicc ?? 1e99) - (b.aicc ?? 1e99)).map((t) => [`(${t.order.p},${t.order.d},${t.order.q})`, t.aicc, t.error ?? ""]) }}
                />
              </details>
            )}
          </>
        )}
      </Card>
      {fc && (
        <ChartBox
          title={`Pronóstico ARIMA a ${fc.mean.length} períodos`}
          sheets={[{ name: "Pronóstico", header: ["Fecha", "Pronóstico", "80 % inf.", "80 % sup.", "95 % inf.", "95 % sup."], rows: fd.map((dt, i) => [dt, fc.mean[i], b80?.lower[i] ?? null, b80?.upper[i] ?? null, b95?.lower[i] ?? null, b95?.upper[i] ?? null]) }]}
          methodology={meth}
        >
          <Notices warnings={["Proyección estadística, no una certeza: supone que la dinámica pasada se mantiene. Las bandas no incluyen cambios de política o de régimen."]} />
          <LinesChart
            data={fcData}
            lines={[
              { key: "y", name: "Observado", color: "var(--chart-1)" },
              { key: "f", name: "Pronóstico", color: "var(--chart-2)", dashed: true, band: [{ lo: "lo95", hi: "hi95", opacity: 0.12 }, { lo: "lo80", hi: "hi80", opacity: 0.22 }] },
            ]}
            refX={d.dates[d.dates.length - 1]}
          />
          <Legend lines={[{ key: "y", name: "Observado", color: "var(--chart-1)" }, { key: "f", name: "Pronóstico (bandas 80 % y 95 %)", color: "var(--chart-2)", dashed: true }]} />
        </ChartBox>
      )}
    </>
  );
}

// ── VAR ─────────────────────────────────────────────────────────────────────

interface VarOut {
  ms?: number;
  dataset: PreparedDataset;
  selection: LagSelection;
  model: Omit<VarModel, "residuals" | "zzInv">;
  granger: GrangerResult[];
  irf: Irf;
  fevd: number[][][];
  forecast: VarForecast;
  warnings: string[];
}

export function VarTab({ ds, names }: TabProps) {
  const [p, setP] = useState<"aic" | "bic" | number>("aic");
  const [maxLags, setMaxLags] = useState(6);
  const [horizon, setHorizon] = useState(12);
  const [orth, setOrth] = useState(true);
  const [impulse, setImpulse] = useState(0);
  const run = useRun<VarOut>();
  const r = run.result;
  if (names.length < 2) return <Notices infos={["El VAR necesita al menos dos series (idealmente estacionarias: variaciones o diferencias)."]} />;
  const methodology = r ? [...datasetSheet(r.dataset).methodology, ASSUMPTIONS.var, ASSUMPTIONS.granger] : [];
  return (
    <>
      <Card title="Vector autorregresivo (VAR), causalidad de Granger e impulso-respuesta">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Rezagos">
            <select className={selectCls} value={String(p)} onChange={(e) => setP(e.target.value === "aic" || e.target.value === "bic" ? e.target.value : Number(e.target.value))}>
              <option value="aic">Elegir por AIC</option>
              <option value="bic">Elegir por BIC</option>
              {[1, 2, 3, 4, 6, 12].map((k) => (
                <option key={k} value={k}>{`${k}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Máx. rezagos a comparar">
            <input type="number" className={inputCls} min={1} max={24} value={maxLags} onChange={(e) => setMaxLags(Math.max(1, Math.min(24, Number(e.target.value) || 6)))} />
          </Field>
          <Field label="Horizonte">
            <input type="number" className={inputCls} min={2} max={48} value={horizon} onChange={(e) => setHorizon(Math.max(2, Math.min(48, Number(e.target.value) || 12)))} />
          </Field>
          <Field label="Impulsos">
            <select className={selectCls} value={orth ? "1" : "0"} onChange={(e) => setOrth(e.target.value === "1")}>
              <option value="1">Ortogonalizados (Cholesky)</option>
              <option value="0">No ortogonalizados</option>
            </select>
          </Field>
          <Field label="Shock en" className="col-span-2 lg:col-span-1">
            <select className={selectCls} value={impulse} onChange={(e) => setImpulse(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={i} value={i}>{`${i + 1}. ${n}`}</option>
              ))}
            </select>
          </Field>
          <RunButton busy={run.busy} onClick={() => void run.exec({ kind: "var", ds, p, maxLags, horizon, orthogonalized: orth })} label="Estimar" />
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">El orden de las variables en la lista de la izquierda es el orden de Cholesky: la primera no reacciona en el impacto a shocks de las siguientes.</p>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && (
        <>
          <DatasetSummary d={r.dataset} ms={r.ms} />
          <Notices warnings={r.warnings} infos={[ASSUMPTIONS.var]} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Rezagos" value={String(r.model.p)} strong note={`AIC: ${r.selection.selected.aic} · BIC: ${r.selection.selected.bic} · HQ: ${r.selection.selected.hqic}`} />
            <Stat label="Observaciones efectivas" value={String(r.model.nobs)} />
            <Stat label="Estabilidad" value={r.model.stable ? "Estable" : "Inestable"} note={`Radio espectral ${fmt(r.model.spectralRadius, 4)}`} />
            <Stat label="AIC / BIC" value={`${fmt(r.model.aic, 3)} / ${fmt(r.model.bic, 3)}`} />
          </div>
          <Card title="Selección de rezagos (muestra común)">
            <ResultTable
              title="Selección de rezagos VAR"
              methodology={methodology}
              sheet={{ name: "Rezagos", header: ["p", "AIC", "BIC", "HQ", "FPE"], rows: r.selection.table.map((t) => [t.p, t.aic, t.bic, t.hqic, t.fpe]) }}
              highlight={(row) => row[0] === r.model.p}
            />
          </Card>
          <Card title="Coeficientes por ecuación">
            <ResultTable
              title="Coeficientes VAR"
              methodology={[...methodology, "Errores estándar con Σu corregida por grados de libertad; p-valores con normal asintótica."]}
              sheet={{
                name: "Coeficientes",
                header: ["Regresor", ...r.model.names.map((n) => `Ec. ${n}`)],
                rows: [
                  ["Constante", ...r.model.intercept.map((v, i) => `${fmt(v)} (${fmt(r.model.interceptSe[i], 3)})`)],
                  ...r.model.A.flatMap((A, l) =>
                    r.model.names.map((nj, j) => [`${nj} (t−${l + 1})`, ...r.model.names.map((_, i) => `${fmt(A[i][j])} (${fmt(r.model.ASe[l][i][j], 3)})${sigStars(A[i][j] / r.model.ASe[l][i][j])}`)]),
                  ),
                  ["R²", ...r.model.r2.map((v) => fmt(v, 3))],
                ],
              }}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Coeficiente (error estándar). {SIG_NOTE}</p>
          </Card>
          <Card title="Causalidad de Granger (prueba F en cada ecuación)">
            <ResultTable
              title="Causalidad de Granger"
              methodology={methodology}
              sheet={{ name: "Granger", header: ["H0: no predice", "F", "g.l.", "p-valor"], rows: r.granger.map((g) => [`${g.causing} → ${g.caused}`, g.f, `${g.df1}, ${g.df2}`, fmtP(g.p)]) }}
              highlight={(row) => typeof row[3] === "string" && row[3].includes("**")}
            />
            <Notices infos={[ASSUMPTIONS.granger]} />
          </Card>
          <IrfChart r={r} impulse={impulse} methodology={methodology} />
          <Card title={`Descomposición de la varianza del error de pronóstico (horizonte ${r.fevd.length})`}>
            <ResultTable
              title="Descomposición de varianza"
              methodology={methodology}
              sheet={{
                name: "FEVD",
                header: ["Variable", ...r.model.names.map((n) => `% por shocks de ${n}`)],
                rows: r.model.names.map((n, i) => [n, ...r.fevd[r.fevd.length - 1][i].map((v) => v * 100)]),
              }}
            />
          </Card>
        </>
      )}
    </>
  );
}

const sigStars = (t: number) => {
  const a = Math.abs(t);
  return a > 2.576 ? " ***" : a > 1.96 ? " **" : a > 1.645 ? " *" : "";
};

function IrfChart({ r, impulse, methodology }: { r: VarOut; impulse: number; methodology: string[] }) {
  const names = r.model.names;
  const H = r.irf.irf.length;
  return (
    <ChartBox
      title={`Impulso-respuesta: shock en ${names[impulse]}${r.irf.orthogonalized ? " (1 desvío estándar, Cholesky)" : " (unitario, no ortogonalizado)"}`}
      sheets={[
        {
          name: "Impulso-respuesta",
          header: ["Período", ...names.flatMap((n) => [n, `${n} inf.`, `${n} sup.`])],
          rows: Array.from({ length: H }, (_, s) => [s, ...names.flatMap((_, i) => [r.irf.irf[s][i][impulse], r.irf.lower?.[s][i][impulse] ?? null, r.irf.upper?.[s][i][impulse] ?? null])]),
        },
      ]}
      methodology={[...methodology, `Bandas al ${Math.round(r.irf.level * 100)} % por Monte Carlo de los coeficientes (${r.irf.draws} réplicas, semilla fija).`]}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {names.map((n, i) => {
          const data = Array.from({ length: H }, (_, s) => ({ x: String(s), v: r.irf.irf[s][i][impulse], lo: r.irf.lower?.[s][i][impulse] ?? null, hi: r.irf.upper?.[s][i][impulse] ?? null }));
          return (
            <div key={i}>
              <p className="mb-1 text-[11px] text-muted-foreground">Respuesta de {n}</p>
              <LinesChart data={data} lines={[{ key: "v", name: `Respuesta de ${n}`, color: hue(i), band: [{ lo: "lo", hi: "hi", opacity: 0.18 }] }]} zero height={180} />
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Bandas al {Math.round(r.irf.level * 100)} % (Monte Carlo). Respuestas de un modelo de forma reducida: dependen del orden de identificación y no son efectos causales.
      </p>
    </ChartBox>
  );
}

// ── Cointegración / VECM ────────────────────────────────────────────────────

interface CointOut {
  ms?: number;
  dataset: PreparedDataset;
  requirements: VecmRequirements;
  engleGranger: EngleGrangerResult | null;
  johansen: JohansenResult;
  rank: number;
  vecm: Omit<VecmModel, "varForm"> | null;
  vecmForecast: VarForecast | null;
  vecmError: string | null;
  forcedRank: boolean;
}

export function CointegrationTab({ ds, names, recipeKeys }: TabProps) {
  const [kArDiff, setK] = useState(1);
  const [rank, setRank] = useState<"auto" | number>("auto");
  const [horizon, setHorizon] = useState(12);
  const run = useRun<CointOut>();
  const r = run.result;
  if (names.length < 2) return <Notices infos={["La cointegración necesita al menos dos series en niveles (o logaritmos)."]} />;
  const transformed = recipeKeys.filter((k) => !["level", "log", "real", "real_log", "sa", "thousand", "index100"].includes(k));
  const methodology = r ? [...datasetSheet(r.dataset).methodology, ASSUMPTIONS.johansen, ASSUMPTIONS.vecm] : [];
  return (
    <>
      <Card title="Cointegración (Engle-Granger y Johansen) y modelo de corrección de errores (VECM)">
        {transformed.length > 0 && <Notices warnings={["La cointegración se analiza en niveles o logaritmos: las variaciones o diferencias ya son estacionarias y no corresponde aplicarla."]} />}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Rezagos en diferencias (k)">
            <input type="number" className={inputCls} min={1} max={12} value={kArDiff} onChange={(e) => setK(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Rango de cointegración">
            <select className={selectCls} value={String(rank)} onChange={(e) => setRank(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
              <option value="auto">Según Johansen (traza 5 %)</option>
              {names.slice(1).map((_, i) => (
                <option key={i} value={i + 1}>{`Forzar r = ${i + 1}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Horizonte de pronóstico">
            <input type="number" className={inputCls} min={1} max={48} value={horizon} onChange={(e) => setHorizon(Math.max(1, Math.min(48, Number(e.target.value) || 12)))} />
          </Field>
          <RunButton busy={run.busy} onClick={() => void run.exec({ kind: "cointegration", ds, kArDiff, rank, horizon })} />
        </div>
      </Card>
      {run.error && <ErrorBox message={run.error} />}
      {r && (
        <>
          <DatasetSummary d={r.dataset} ms={r.ms} />
          <Card title="Requisitos del VECM">
            <div className="mb-2">
              <Stat
                label="¿Se cumplen?"
                value={r.requirements.ok ? `Sí: series I(1) con ${r.johansen.rank} relación(es) de cointegración` : "No"}
                strong
                note={r.requirements.ok ? undefined : "El VECM no corresponde con estos datos (ver motivos)."}
              />
            </div>
            <Notices warnings={[...r.requirements.reasons, ...(r.forcedRank ? ["Rango forzado manualmente aunque no se cumplen los requisitos: el VECM resultante no está respaldado por las pruebas."] : [])]} />
            <ResultTable
              title="Orden de integración"
              methodology={methodology}
              sheet={{
                name: "Integración",
                header: ["Serie", "Niveles", "Diferencias", "I(1)"],
                rows: r.requirements.integration.map((x) => [x.name, VERDICT[x.levels as StationarityVerdict["verdict"]], VERDICT[x.diffs as StationarityVerdict["verdict"]], x.i1 ? "Sí" : "No"]),
              }}
            />
          </Card>
          <Card title={`Prueba de Johansen (constante, k = ${r.johansen.kArDiff}, ${r.johansen.nobs} obs.)`}>
            <ResultTable
              title="Johansen"
              methodology={methodology}
              sheet={{
                name: "Johansen",
                header: ["H0: rango ≤", "Autovalor", "Traza", "Crítico traza 5 %", "Máx. autovalor", "Crítico máx. 5 %"],
                rows: r.johansen.trace.map((t, i) => [`r ≤ ${i}`, r.johansen.eigenvalues[i], t, r.johansen.traceCrit[i][1], r.johansen.maxEig[i], r.johansen.maxEigCrit[i][1]]),
              }}
              highlight={(row) => typeof row[2] === "number" && typeof row[3] === "number" && row[2] > row[3]}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Filas resaltadas: se rechaza H0 al 5 %. Rango elegido: el primer r que no se rechaza ({r.johansen.rank}).</p>
            {r.engleGranger && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Engle-Granger (τ)" value={fmt(r.engleGranger.stat, 3)} note={`Y = ${r.dataset.series[0].name}`} />
                <Stat label="p-valor (MacKinnon)" value={fmtP(r.engleGranger.p)} />
                <Stat label="Crítico 5 %" value={fmt(r.engleGranger.crit["5%"], 3)} />
                <Stat label="Coef. de largo plazo" value={r.engleGranger.coefficients.slice(1).map((c) => fmt(c, 4)).join(" · ")} />
              </div>
            )}
            <Notices infos={[ASSUMPTIONS.johansen]} />
          </Card>
          {r.vecmError && <ErrorBox message={r.vecmError} />}
          {r.vecm && (
            <Card title={`VECM (r = ${r.vecm.rank}, ${r.vecm.kArDiff} rezago(s) en diferencias)`}>
              <div className="grid gap-3 md:grid-cols-2">
                <ResultTable
                  title="Vectores de cointegración β"
                  methodology={methodology}
                  sheet={{ name: "Beta", header: ["Serie", ...r.vecm.beta[0].map((_, j) => `β${j + 1}`)], rows: r.vecm.names.map((n, i) => [n, ...r.vecm!.beta[i]]) }}
                />
                <ResultTable
                  title="Velocidades de ajuste α"
                  methodology={methodology}
                  sheet={{ name: "Alfa", header: ["Ecuación", ...r.vecm.alpha[0].map((_, j) => `α${j + 1}`)], rows: r.vecm.names.map((n, i) => [`Δ ${n}`, ...r.vecm!.alpha[i]]) }}
                />
              </div>
              <Notices infos={[ASSUMPTIONS.vecm, "α negativo en la ecuación de una variable indica que corrige hacia el equilibrio de largo plazo cuando se desvía."]} />
              {r.vecmForecast && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] text-muted-foreground">Pronóstico del VECM (bandas 95 %, sin incertidumbre de parámetros)</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {r.vecm.names.map((n, i) => {
                      const fd = futureDates(r.dataset.dates[r.dataset.dates.length - 1], r.dataset.frequency, r.vecmForecast!.mean.length);
                      const hist = r.dataset.dates.slice(-36).map((dt) => ({ x: dt, y: r.dataset.columns[i][r.dataset.dates.indexOf(dt)] }));
                      const band = r.vecmForecast!.bands.find((b) => b.level === 0.95)!;
                      const data = [...hist, ...fd.map((dt, s) => ({ x: dt, f: r.vecmForecast!.mean[s][i], lo: band.lower[s][i], hi: band.upper[s][i] }))];
                      return (
                        <div key={i}>
                          <p className="mb-1 text-[11px]">{n}</p>
                          <LinesChart data={data} lines={[{ key: "y", name: n, color: hue(i) }, { key: "f", name: "Pronóstico", dashed: true, color: "var(--chart-2)", band: [{ lo: "lo", hi: "hi" }] }]} height={180} refX={r.dataset.dates[r.dataset.dates.length - 1]} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
