"use client";

import { useMemo, useState } from "react";
import { ChartBox, ErrorBox, Field, fmt, inputCls, Legend, LinesChart, Notices, ResultTable, Stat } from "@/components/econ/ui";
import { rangeChange, type RangeChange } from "@/lib/analysis/breakdown";
import type { Pt } from "@/lib/analysis/types";
import type { Frequency } from "@/lib/connectors/types";
import { formatNumber } from "@/lib/format";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const name = (iso: string, f: Frequency) => {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7)) - 1;
  return f === "Q" ? `${m / 3 + 1}º trim. ${y}` : f === "S" ? `${m / 6 + 1}º sem. ${y}` : f === "A" ? y : `${MONTHS[m]} ${y}`;
};
const shiftMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Variación de cualquier indicador entre dos fechas elegidas libremente, con
 * base 0 al comienzo del período: acumulada, promedio por período, anualizada,
 * trayectoria acumulada y cada período individual.
 */
export function RangeCalculator({ points, frequency, unit, seriesName }: { points: Pt[]; frequency: Frequency; unit: string; seriesName: string }) {
  const valid = points.filter((p) => p.v !== null);
  const lastYm = (valid.at(-1)?.d ?? new Date().toISOString()).slice(0, 7);
  const firstYm = (valid[0]?.d ?? lastYm).slice(0, 7);
  const [from, setFrom] = useState(shiftMonth(lastYm, -11));
  const [to, setTo] = useState(lastYm);
  const [base100, setBase100] = useState("");
  const [view, setView] = useState<"cum" | "index">("cum");

  const res = useMemo((): { ok: true; r: RangeChange } | { ok: false; e: string } => {
    try {
      return { ok: true, r: rangeChange(points, frequency, unit, seriesName, `${from}-01`, `${to}-01`, { base100: base100 ? `${base100}-01` : undefined }) };
    } catch (e) {
      return { ok: false, e: (e as Error).message };
    }
  }, [points, frequency, unit, seriesName, from, to, base100]);

  const presets: { label: string; from: string; to: string }[] = [
    { label: "Últimos 12 meses", from: shiftMonth(lastYm, -11), to: lastYm },
    { label: "Año en curso", from: `${lastYm.slice(0, 4)}-01`, to: lastYm },
    { label: `Año ${Number(lastYm.slice(0, 4)) - 1}`, from: `${Number(lastYm.slice(0, 4)) - 1}-01`, to: `${Number(lastYm.slice(0, 4)) - 1}-12` },
    { label: "Últimos 3 años", from: shiftMonth(lastYm, -35), to: lastYm },
  ];

  const r = res.ok ? res.r : null;
  const cu = r?.mode === "rate" ? "pp" : "%";
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${formatNumber(v, { decimals: 2 })} ${cu === "pp" ? "pp" : "%"}`);
  const showIndex = view === "index" && Boolean(r?.base100);
  const chart = r
    ? showIndex
      ? r.rows.map((x) => ({ x: name(x.d, r.frequency), c: x.index }))
      : [
          ...(r.base && r.mode !== "rate" ? [{ x: `${name(r.base.d, r.frequency)} (base)`, c: 0 }] : []),
          ...r.rows.map((x) => ({ x: name(x.d, r.frequency), c: x.cumulative })),
        ]
    : [];
  const idxLabel = r?.base100 ? `Índice (${name(r.base100.d, r.frequency)} = 100)` : "Índice base 100";
  const lines = [{ key: "c", name: showIndex ? idxLabel : r?.mode === "rate" ? "Cambio acumulado (pp)" : "Variación acumulada (%)" }];
  const methodology = r
    ? [
        `${seriesName} — variación entre ${name(r.from, r.frequency)} y ${name(r.to, r.frequency)}.`,
        r.mode === "level"
          ? `Base 0 al comienzo del período: acumulada(t) = V(t) / V(${name(r.base!.d, r.frequency)}) − 1. El primer período elegido ya incluye su propia variación.`
          : r.mode === "compound"
            ? "La serie es una tasa de variación por período: la acumulada se obtiene componiendo Π(1 + r) − 1."
            : "La serie es una tasa: el cambio se mide en puntos porcentuales respecto del período anterior al inicio.",
        "Promedio por período: media geométrica; anualizada: (1 + acumulada)^(períodos por año / períodos) − 1.",
        ...(r.base100 ? [`Índice base 100: 100 · V(t) / V(${name(r.base100.d, r.frequency)}).`] : []),
        ...(r.missing.length ? [`Períodos sin dato publicado (no se completan): ${r.missing.join(", ")}.`] : []),
      ]
    : [];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde (inclusive)">
          <input type="month" className={`${inputCls} w-40`} min={firstYm} max={lastYm} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta (inclusive)">
          <input type="month" className={`${inputCls} w-40`} min={firstYm} max={lastYm} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
              className="h-8 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {p.label}
            </button>
          ))}
        </div>
        {r?.mode !== "rate" && r?.mode !== "compound" && (
          <Field label="Base 100 en (opcional)" hint="Cualquier mes, incluso fuera del período">
            <span className="flex items-center gap-1">
              <input
                type="month"
                className={`${inputCls} w-40`}
                min={firstYm}
                max={lastYm}
                value={base100}
                onChange={(e) => {
                  setBase100(e.target.value);
                  if (e.target.value) setView("index");
                }}
              />
              {base100 && (
                <button type="button" onClick={() => { setBase100(""); setView("cum"); }} className="text-muted-foreground hover:text-foreground" aria-label="Quitar base 100">
                  ×
                </button>
              )}
            </span>
          </Field>
        )}
      </div>
      {!res.ok && <ErrorBox message={res.e} />}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label={r.mode === "rate" ? "Cambio en el período" : "Variación acumulada"}
              value={pct(r.accumulated)}
              strong
              note={`${name(r.from, r.frequency)} → ${name(r.to, r.frequency)}`}
            />
            <Stat label="Períodos" value={String(r.periods)} note={r.base && r.mode === "level" ? `Base: ${name(r.base.d, r.frequency)} = ${fmt(r.base.v)}` : undefined} />
            <Stat label="Promedio por período" value={pct(r.averagePerPeriod)} note={r.mode === "rate" ? "No aplica a tasas" : "Media geométrica"} />
            <Stat label="Equivalente anual" value={pct(r.annualized)} />
          </div>
          {r.missing.length > 0 && <Notices warnings={[`Faltan datos publicados para: ${r.missing.map((d) => name(d, r.frequency)).join(", ")}. No se completan: el cálculo llega hasta el último dato disponible.`]} />}
          {r.base100 && (
            <div className="flex gap-1" role="group" aria-label="Vista del gráfico">
              {(["cum", "index"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`h-7 rounded border px-2 text-[11px] ${view === v ? "border-amber/60 text-foreground" : "border-border text-muted-foreground"}`}
                >
                  {v === "cum" ? "Variación acumulada (base 0)" : idxLabel}
                </button>
              ))}
            </div>
          )}
          <ChartBox
            title={showIndex ? idxLabel : "Trayectoria acumulada (base 0 al inicio)"}
            sheets={[
              {
                name: "Variación",
                header: ["Período", "Valor", r.mode === "rate" ? "Cambio (pp)" : "Variación del período (%)", r.mode === "rate" ? "Acumulado (pp)" : "Acumulada desde el inicio (%)", ...(r.base100 ? [idxLabel] : [])],
                rows: [
                  ...(r.base && r.mode === "level" ? [[`${name(r.base.d, r.frequency)} (base)`, r.base.v, null, 0, ...(r.base100 ? [(r.base.v / r.base100.v) * 100] : [])] as (string | number | null)[]] : []),
                  ...r.rows.map((x) => [name(x.d, r.frequency), x.value, x.change, x.cumulative, ...(r.base100 ? [x.index] : [])]),
                ],
              },
            ]}
            methodology={methodology}
          >
            <LinesChart data={chart} lines={lines} zero height={240} />
            <Legend lines={lines} />
          </ChartBox>
          <ResultTable
            title={`Variación ${seriesName}`}
            methodology={methodology}
            sheet={{
              name: "Por período",
              header: ["Período", "Valor", r.mode === "rate" ? "Cambio (pp)" : "Var. del período (%)", r.mode === "rate" ? "Acumulado (pp)" : "Acumulada (%)", ...(r.base100 ? [idxLabel] : [])],
              rows: r.rows.map((x) => [name(x.d, r.frequency), x.value, x.change, x.cumulative, ...(r.base100 ? [x.index] : [])]),
            }}
          />
          <Notices infos={methodology.slice(1)} />
        </>
      )}
    </div>
  );
}
