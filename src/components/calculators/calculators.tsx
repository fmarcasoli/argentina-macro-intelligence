"use client";

import { useMemo, useState } from "react";
import { AnalysisChart } from "@/components/charts/analysis-chart";
import {
  CalcError,
  compareWages,
  devaluation,
  inflationBetween,
  adjustAmount,
  realChange,
  realIndex,
  realRate,
  referenceMonthlyInflation,
  toConstantPesos,
} from "@/lib/analysis/calculators";
import { resample } from "@/lib/analysis/frequency";
import { DEFAULT_SPEC, type AnalysisSpec } from "@/lib/analysis/pipeline";
import type { Pt, SeriesData, SeriesMeta } from "@/lib/analysis/types";
import { formatNumber, periodLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CalculatorData {
  ipc: SeriesData;
  fx: SeriesData[];
  wages: SeriesData[];
  aggregates: SeriesData[];
  rates: SeriesData[];
}

const TABS = [
  { id: "inflacion", label: "Inflación" },
  { id: "tasas", label: "Tasas reales" },
  { id: "devaluacion", label: "Devaluación" },
  { id: "salarios", label: "Salarios reales" },
  { id: "agregados", label: "Agregados monetarios reales" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : `${formatNumber(v, { decimals: d })} %`);
const money = (v: number) => `$ ${formatNumber(v, { decimals: 2 })}`;
const monthOf = (iso: string) => iso.slice(0, 7);
const toMonth = (ym: string) => `${ym}-01`;
/** Desplaza un mes "YYYY-MM" n meses. */
const shiftMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export function Calculators({ data, initialTab }: { data: CalculatorData; initialTab?: string }) {
  const [tab, setTab] = useState<TabId>((TABS.find((t) => t.id === initialTab)?.id ?? "inflacion") as TabId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Calculadoras">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              history.replaceState(null, "", `?c=${t.id}`);
            }}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground hover:text-foreground",
              tab === t.id && "border-amber text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "inflacion" && <InflationCalc ipc={data.ipc} />}
      {tab === "tasas" && <RealRateCalc ipc={data.ipc} rates={data.rates} />}
      {tab === "devaluacion" && <DevaluationCalc fx={data.fx} ipc={data.ipc} />}
      {tab === "salarios" && <WageCalc wages={data.wages} ipc={data.ipc} />}
      {tab === "agregados" && <AggregatesCalc aggregates={data.aggregates} ipc={data.ipc} />}
    </div>
  );
}

// ───────────────────────── componentes comunes ─────────────────────────

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-card p-3", className)}>
      <h2 className="label-caps mb-3 text-[10px] text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

const inputCls = "num h-8 rounded border border-border bg-background px-2 text-xs";

function Result({ label, value, strong, note }: { label: string; value: string; strong?: boolean; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border/60 p-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("num", strong ? "text-xl font-medium" : "text-sm")}>{value}</span>
      {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
    </div>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof CalcError ? error.message : error instanceof Error ? error.message : String(error);
  return <p className="rounded border border-negative/30 bg-negative/5 p-2 text-xs">{msg}</p>;
}

function Source({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] leading-relaxed text-muted-foreground">{children}</p>;
}

function safe<T>(fn: () => T): { ok: true; v: T } | { ok: false; e: unknown } {
  try {
    return { ok: true, v: fn() };
  } catch (e) {
    return { ok: false, e };
  }
}

function derivedMeta(id: string, name: string, unit: string, base?: SeriesMeta): SeriesMeta {
  return {
    id,
    name,
    unit,
    source_id: base?.source_id ?? "INDEC",
    source_code: null,
    frequency: "M",
    value_kind: "calculated",
    category: base?.category ?? "",
    subcategory: null,
    panel: null,
    update_status: "ok",
    last_date: null,
    methodology_url: null,
  };
}

function useSpec(ids: string[], patch: Partial<AnalysisSpec> = {}) {
  const [spec, setSpec] = useState<AnalysisSpec>({ ...DEFAULT_SPEC, ids, ...patch });
  return [spec, setSpec] as const;
}

// ───────────────────────── Inflación ─────────────────────────

function InflationCalc({ ipc }: { ipc: SeriesData }) {
  const months = ipc.points.filter((p) => p.v !== null).map((p) => monthOf(p.d));
  const lastM = months[months.length - 1];
  // Por defecto, los últimos 12 meses (equivale a la inflación interanual del último mes).
  const [from, setFrom] = useState(shiftMonth(lastM, -11));
  const [to, setTo] = useState(lastM);
  const [amount, setAmount] = useState("100000");
  const r = useMemo(() => safe(() => inflationBetween(ipc.points, toMonth(from), toMonth(to))), [ipc.points, from, to]);
  const amt = Number(amount.replace(",", "."));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Parámetros">
        <div className="flex flex-col gap-3">
          <Field label="Mes inicial (incluido)" hint={`IPC Nacional disponible desde ${monthOf(months[1] ?? months[0])}.`}>
            <input type="month" className={inputCls} value={from} min={months[1]} max={lastM} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Mes final (incluido)">
            <input type="month" className={inputCls} value={to} min={months[1]} max={lastM} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Importe a actualizar ($)">
            <input inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        {!r.ok ? (
          <ErrorBox error={r.e} />
        ) : (
          <>
            <Card title={`Resultado: ${periodLabel(r.v.fromMonth, "M")} – ${periodLabel(r.v.toMonth, "M")} (${r.v.months} meses)`}>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <Result label="Inflación acumulada" value={pct(r.v.accumulated)} strong />
                <Result label="Promedio mensual (geométrico)" value={pct(r.v.monthlyAverage)} />
                <Result label="Equivalente anual" value={pct(r.v.annualized)} />
                <Result label={`Interanual a ${periodLabel(r.v.toMonth, "M")}`} value={pct(r.v.yoyAtEnd)} />
                <Result
                  label="Importe actualizado"
                  value={Number.isFinite(amt) ? money(adjustAmount(amt, r.v.accumulated)) : "—"}
                  note={Number.isFinite(amt) ? `${money(amt)} de ${periodLabel(r.v.baseMonth, "M")}` : undefined}
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] text-muted-foreground">
                      <th className="py-1 font-normal">Mes</th>
                      <th className="py-1 text-right font-normal">Inflación mensual</th>
                      <th className="py-1 text-right font-normal">Acumulada</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {r.v.monthly.reduce<{ rows: { d: string; m: number; acc: number }[]; acc: number }>(
                      (s, p) => {
                        const acc = (1 + s.acc / 100) * (1 + (p.v as number) / 100) * 100 - 100;
                        s.rows.push({ d: p.d, m: p.v as number, acc });
                        s.acc = acc;
                        return s;
                      },
                      { rows: [], acc: 0 },
                    ).rows.reverse().map((x) => (
                      <tr key={x.d} className="border-t border-border/50">
                        <td className="py-1 text-muted-foreground">{periodLabel(x.d, "M")}</td>
                        <td className="py-1 text-right">{pct(x.m)}</td>
                        <td className="py-1 text-right">{pct(x.acc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Source>
              Fuente: INDEC, IPC Nivel General Nacional (índice dic-2016 = 100, serie 148.3_INIVELNAL_DICI_M_26). Capitalización
              compuesta: acumulada = IPC(final) / IPC(mes anterior al inicial) − 1; incluye la inflación del mes inicial.
              Índice base: {formatNumber(r.v.baseIndex)} ({periodLabel(r.v.baseMonth, "M")}) → {formatNumber(r.v.endIndex)}.
            </Source>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Tasas reales (Fisher) ─────────────────────────

function RealRateCalc({ ipc, rates }: { ipc: SeriesData; rates: SeriesData[] }) {
  const lastRate = (s: SeriesData) => [...s.points].reverse().find((p) => p.v !== null);
  const [days, setDays] = useState("30");
  const [mode, setMode] = useState<"last" | "avg3" | "yoy" | "manual">("avg3");
  const [manual, setManual] = useState("2");
  const [rows, setRows] = useState(() => [
    ...rates.map((s) => ({ label: s.meta.name, tna: String(lastRate(s)?.v ?? ""), date: lastRate(s)?.d ?? null })),
    { label: "Alternativa propia", tna: "30", date: null as string | null },
  ]);

  const ref = useMemo(() => safe(() => (mode === "manual" ? null : referenceMonthlyInflation(ipc.points, mode))), [ipc.points, mode]);
  const monthly = mode === "manual" ? Number(manual.replace(",", ".")) : ref.ok && ref.v ? ref.v.value : NaN;
  const d = Number(days);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Inflación de referencia">
        <div className="flex flex-col gap-3">
          <Field label="Plazo de la colocación (días)">
            <input inputMode="numeric" className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <Field label="Inflación observada (IPC)">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="last">Último mes publicado</option>
              <option value="avg3">Promedio de los últimos 3 meses</option>
              <option value="yoy">Promedio mensual de los últimos 12 meses</option>
              <option value="manual">Ingresar manualmente (% mensual)</option>
            </select>
          </Field>
          {mode === "manual" && (
            <Field label="Inflación mensual esperada (%)">
              <input inputMode="decimal" className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)} />
            </Field>
          )}
          {mode !== "manual" && ref.ok && ref.v && (
            <Result label={`Inflación mensual de referencia (IPC a ${periodLabel(ref.v.month, "M")})`} value={pct(ref.v.value)} />
          )}
          {!ref.ok && <ErrorBox error={ref.e} />}
        </div>
      </Card>
      <Card title="Comparación de alternativas (Fisher)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs">
            <thead>
              <tr className="text-left text-[10px] text-muted-foreground">
                <th className="py-1 font-normal">Alternativa</th>
                <th className="py-1 font-normal">TNA (%)</th>
                <th className="py-1 text-right font-normal">Rendimiento del período</th>
                <th className="py-1 text-right font-normal">TEA</th>
                <th className="py-1 text-right font-normal">Inflación del período</th>
                <th className="py-1 text-right font-normal">Tasa real del período</th>
                <th className="py-1 text-right font-normal">Tasa real anual</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((row, i) => {
                const tna = Number(row.tna.replace(",", "."));
                const r = Number.isFinite(tna) && Number.isFinite(monthly) ? safe(() => realRate(tna, d, monthly)) : null;
                return (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1.5 pr-2">
                      <span className="line-clamp-2">{row.label}</span>
                      {row.date && <span className="text-[10px] text-muted-foreground">BCRA, dato del {row.date}</span>}
                    </td>
                    <td className="py-1.5">
                      <input
                        aria-label={`TNA de ${row.label}`}
                        inputMode="decimal"
                        className={cn(inputCls, "w-20")}
                        value={row.tna}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, tna: e.target.value } : x)))}
                      />
                    </td>
                    {r && r.ok ? (
                      <>
                        <td className="py-1.5 text-right">{pct(r.v.periodNominal)}</td>
                        <td className="py-1.5 text-right">{pct(r.v.tea)}</td>
                        <td className="py-1.5 text-right">{pct(r.v.periodInflation)}</td>
                        <td className={cn("py-1.5 text-right", r.v.periodReal >= 0 ? "text-positive" : "text-negative")}>
                          {r.v.periodReal >= 0 ? "▲ " : "▼ "}
                          {pct(r.v.periodReal)}
                        </td>
                        <td className="py-1.5 text-right">{pct(r.v.realAnnual)}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-1.5 text-right text-muted-foreground">
                        {r && !r.ok ? (r.e as Error).message : "Completá los datos"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Source>
          Fisher exacta: r = (1 + i) / (1 + π) − 1, con i = TNA × días / 365 y π = (1 + inflación mensual)^(días / 30,4) − 1.
          Tasa real anual = (1 + r)^(365 / días) − 1. Tasas: BCRA (Estadísticas Monetarias v4.0); inflación: INDEC (IPC Nivel
          General Nacional). La inflación observada no anticipa la futura: el resultado es una referencia ex post.
        </Source>
      </Card>
    </div>
  );
}

// ───────────────────────── Devaluación ─────────────────────────

function DevaluationCalc({ fx, ipc }: { fx: SeriesData[]; ipc: SeriesData }) {
  const [sel, setSel] = useState(fx[0]?.meta.id ?? "");
  const series = fx.find((s) => s.meta.id === sel) ?? fx[0];
  const last = series.points.at(-1)?.d ?? "";
  const [from, setFrom] = useState(`${Number(last.slice(0, 4)) - 1}${last.slice(4)}`);
  const [to, setTo] = useState(last);
  const r = useMemo(() => safe(() => devaluation(series.points, from, to)), [series.points, from, to]);
  // Inflación del mismo período (meses completos con IPC publicado), para la devaluación real.
  const infl = useMemo(
    () => (r.ok ? safe(() => inflationBetween(ipc.points, `${monthOf(r.v.start.d)}-01`, `${monthOf(r.v.end.d)}-01`)) : null),
    [r, ipc.points],
  );
  const [spec, setSpec] = useSpec([series.meta.id], { transform: "pct_yoy" });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Parámetros">
        <div className="flex flex-col gap-3">
          <Field label="Tipo de cambio">
            <select className={inputCls} value={series.meta.id} onChange={(e) => setSel(e.target.value)}>
              {fx.map((s) => (
                <option key={s.meta.id} value={s.meta.id}>
                  {s.meta.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de cambio inicial (fecha)" hint="Se usa la última cotización publicada en o antes de la fecha.">
            <input type="date" className={inputCls} value={from} max={last} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Tipo de cambio final (fecha)">
            <input type="date" className={inputCls} value={to} max={last} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        {!r.ok ? (
          <ErrorBox error={r.e} />
        ) : (
          <Card title="Resultado">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Result label={`Inicial (${r.v.start.d})`} value={`$ ${formatNumber(r.v.start.v)}`} />
              <Result label={`Final (${r.v.end.d})`} value={`$ ${formatNumber(r.v.end.v)}`} />
              <Result label="Variación acumulada" value={pct(r.v.accumulated)} strong note={`${r.v.days} días`} />
              <Result label="Equivalente anual" value={pct(r.v.annualized)} />
              <Result label={`Interanual al ${r.v.end.d}`} value={pct(r.v.yoyAtEnd)} />
              {infl && infl.ok ? (
                <>
                  <Result
                    label={`Inflación ${periodLabel(infl.v.fromMonth, "M")} – ${periodLabel(infl.v.toMonth, "M")}`}
                    value={pct(infl.v.accumulated)}
                  />
                  <Result
                    label="Devaluación real (vs. IPC)"
                    value={pct(realChange(r.v.accumulated, infl.v.accumulated))}
                    note="Positiva: el peso se depreció en términos reales"
                  />
                </>
              ) : (
                <Result label="Devaluación real" value="—" note={infl && !infl.ok ? (infl.e as Error).message : undefined} />
              )}
            </div>
          </Card>
        )}
        <Card title="Variación interanual del tipo de cambio">
          <AnalysisChart data={[series]} spec={spec} onSpecChange={setSpec} title={`${series.meta.name} — variación`} height={260} defaultRange="5A" controls={{ transform: true, frequency: true, exports: true, table: true }} />
        </Card>
        <Source>Fuente: BCRA (Estadísticas Monetarias v4.0) e INDEC (IPC). Devaluación real = (1 + devaluación) / (1 + inflación) − 1.</Source>
      </div>
    </div>
  );
}

// ───────────────────────── Salarios reales ─────────────────────────

function WageCalc({ wages, ipc }: { wages: SeriesData[]; ipc: SeriesData }) {
  const [sel, setSel] = useState(wages[0]?.meta.id ?? "");
  const series = wages.find((s) => s.meta.id === sel) ?? wages[0];
  const months = ipc.points.filter((p) => p.v !== null).map((p) => monthOf(p.d));
  const lastM = months[months.length - 1];
  const [from, setFrom] = useState(shiftMonth(lastM, -12));
  const [to, setTo] = useState(lastM);
  const [salFrom, setSalFrom] = useState("1000000");
  const [salTo, setSalTo] = useState("");

  const real = useMemo(() => safe(() => realIndex(series.points, ipc.points, "2016-12-01")), [series.points, ipc.points]);
  const chartData: SeriesData[] = useMemo(
    () =>
      real.ok
        ? [
            { meta: derivedMeta(`${series.meta.id}:real`, `${series.meta.name} — real (dic-2016=100)`, "Índice dic-2016=100", series.meta), points: real.v.points },
            { meta: series.meta, points: series.points },
          ]
        : [],
    [real, series],
  );
  const [spec, setSpec] = useSpec(chartData.map((s) => s.meta.id), { layout: "panels", from: "2017-01-01" });
  const a = Number(salFrom.replace(",", "."));
  const b = salTo ? Number(salTo.replace(",", ".")) : undefined;
  const cmp = useMemo(() => safe(() => compareWages(ipc.points, toMonth(from), a, toMonth(to), b)), [ipc.points, from, to, a, b]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Tu salario">
        <div className="flex flex-col gap-3">
          <Field label="Mes inicial">
            <input type="month" className={inputCls} value={from} min={months[0]} max={lastM} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Salario nominal en el mes inicial ($)">
            <input inputMode="decimal" className={inputCls} value={salFrom} onChange={(e) => setSalFrom(e.target.value)} />
          </Field>
          <Field label="Mes final">
            <input type="month" className={inputCls} value={to} min={months[0]} max={lastM} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Salario nominal en el mes final ($, opcional)">
            <input inputMode="decimal" className={inputCls} value={salTo} onChange={(e) => setSalTo(e.target.value)} />
          </Field>
          {cmp.ok ? (
            <div className="grid grid-cols-1 gap-2">
              <Result label="Inflación del período" value={pct(cmp.v.inflationPct)} />
              <Result label="Salario necesario para mantener el poder adquisitivo" value={money(cmp.v.equivalentAtEnd)} strong />
              {cmp.v.realChangePct !== null && (
                <>
                  <Result label={`Tu salario final en pesos de ${periodLabel(toMonth(from), "M")}`} value={money(cmp.v.realOfEndInStartPesos!)} />
                  <Result label="Variación real de tu salario" value={pct(cmp.v.realChangePct)} />
                </>
              )}
            </div>
          ) : (
            <ErrorBox error={cmp.e} />
          )}
        </div>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Evolución histórica: salario nominal vs. real">
          <Field label="Índice de salarios (INDEC)">
            <select className={cn(inputCls, "mb-3 max-w-md")} value={series.meta.id} onChange={(e) => setSel(e.target.value)}>
              {wages.map((s) => (
                <option key={s.meta.id} value={s.meta.id}>
                  {s.meta.name}
                </option>
              ))}
            </select>
          </Field>
          {real.ok ? (
            <AnalysisChart key={series.meta.id} data={chartData} spec={{ ...spec, ids: chartData.map((s) => s.meta.id) }} onSpecChange={setSpec} title="Salario nominal vs. real" height={280} defaultRange="MAX" controls={{ transform: true, layout: true, exports: true, table: true }} />
          ) : (
            <ErrorBox error={real.e} />
          )}
        </Card>
        <Source>
          Salario real = (W_t / W_dic-2016) / (IPC_t / IPC_dic-2016) × 100, con el índice de salarios y el IPC Nivel General
          Nacional del INDEC. Para tu salario: equivalente = salario inicial × IPC(final) / IPC(inicial).
        </Source>
      </div>
    </div>
  );
}

// ───────────────────────── Agregados monetarios reales ─────────────────────────

function AggregatesCalc({ aggregates, ipc }: { aggregates: SeriesData[]; ipc: SeriesData }) {
  const monthly = useMemo(
    () =>
      aggregates.map((s) =>
        s.meta.frequency === "M" ? s : { meta: { ...s.meta, frequency: "M" as const }, points: resample(s.points, s.meta.frequency, "M", "avg").points },
      ),
    [aggregates],
  );
  const real = useMemo(
    () =>
      monthly.map((s) => {
        const r = toConstantPesos(s.points, ipc.points);
        return {
          meta: derivedMeta(`${s.meta.id}:real`, `${s.meta.name} — real`, `${s.meta.unit} — pesos constantes de ${periodLabel(r.refMonth, "M")}`, s.meta),
          points: r.points,
          refMonth: r.refMonth,
        };
      }),
    [monthly, ipc.points],
  );
  const [spec, setSpec] = useSpec(real.map((s) => s.meta.id), { transform: "pct_yoy", from: "2018-01-01", layout: "overlay" });
  const lastYoY = (pts: Pt[]) => {
    const last = pts.at(-1);
    if (!last || last.v === null) return null;
    const d = new Date(`${last.d}T00:00:00Z`);
    const prev = pts.find((p) => p.d === `${d.getUTCFullYear() - 1}-${last.d.slice(5)}`);
    return prev?.v ? ((last.v / prev.v - 1) * 100) : null;
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card title="Último dato en términos reales">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {real.map((s, i) => {
            const nominal = monthly[i];
            const last = s.points.at(-1);
            return (
              <Result
                key={s.meta.id}
                label={`${nominal.meta.name} (${last ? periodLabel(last.d, "M") : "—"})`}
                value={pct(lastYoY(s.points))}
                note={`Var. real interanual · nominal: ${pct(lastYoY(nominal.points))}`}
              />
            );
          })}
        </div>
      </Card>
      <Card title="Agregados deflactados por IPC">
        <AnalysisChart data={real} spec={spec} onSpecChange={setSpec} title="Agregados monetarios reales" height={320} defaultRange="MAX" />
      </Card>
      <Source>
        Valores reales = nominal × IPC(último mes) / IPC(mes), en pesos constantes del último IPC publicado. Las series diarias
        (base monetaria) se promedian por mes; el mes en curso se excluye por incompleto. Fuentes: BCRA (agregados) e INDEC (IPC).
      </Source>
    </div>
  );
}
