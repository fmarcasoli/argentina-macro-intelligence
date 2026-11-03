import Link from "next/link";
import { periodBreakdown, type Breakdown, type BreakdownRow } from "@/lib/analysis/breakdown";
import type { SeriesData } from "@/lib/analysis/types";
import type { Frequency } from "@/lib/connectors/types";
import { formatNumber, formatValue } from "@/lib/format";

/**
 * Datos período a período, como los informes del INDEC: cada mes (o
 * trimestre) en su fila, con su valor y sus variaciones, agrupado por año.
 */

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function periodName(iso: string, freq: Frequency): string {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7)) - 1;
  if (freq === "M") return `${MONTHS[m]} ${y}`;
  if (freq === "Q") return `${m / 3 + 1}º trimestre ${y}`;
  if (freq === "S") return `${m / 6 + 1}º semestre ${y}`;
  return y;
}

const PERIOD_WORD: Partial<Record<Frequency, string>> = { M: "mensual", Q: "trimestral", S: "semestral", A: "anual" };

function Change({ v, unit }: { v: number | null; unit: "%" | "pp" }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const s = `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumber(Math.abs(v), { decimals: unit === "%" ? 1 : 2 })}${unit === "%" ? " %" : " pp"}`;
  // Sin color: una suba no es "buena" o "mala" en sí (precios vs. actividad).
  return <span>{s}</span>;
}

function Rows({ rows, b, unit }: { rows: BreakdownRow[]; b: Breakdown; unit: string }) {
  const cu = b.kind === "rate" ? "pp" : "%";
  return (
    <>
      {rows.map((r) => (
        <tr key={r.d} className="border-b border-border/50">
          <td className="px-3 py-1.5">{periodName(r.d, b.frequency)}</td>
          <td className="num px-3 py-1.5 text-right">{r.value === null ? <span className="text-muted-foreground">s/d</span> : formatValue(r.value, unit)}</td>
          <td className="num px-3 py-1.5 text-right"><Change v={r.prev} unit={cu} /></td>
          {b.frequency !== "A" && <td className="num px-3 py-1.5 text-right"><Change v={r.yoy} unit={cu} /></td>}
          {b.kind === "level" && b.frequency !== "A" && <td className="num px-3 py-1.5 text-right"><Change v={r.ytd} unit="%" /></td>}
        </tr>
      ))}
    </>
  );
}

/** Tabla completa de una serie, agrupada por año (los dos últimos abiertos). */
export function PeriodTable({ points, frequency, unit, name }: { points: SeriesData["points"]; frequency: Frequency; unit: string; name: string }) {
  const b = periodBreakdown(points, frequency, unit, name);
  if (!b.rows.length) return <p className="p-3 text-xs text-muted-foreground">Sin datos.</p>;
  const word = PERIOD_WORD[b.frequency] ?? "";
  const head = (
    <tr className="label-caps border-b border-border text-left text-[10px] text-muted-foreground">
      <th className="px-3 py-2 font-medium">Período</th>
      <th className="px-3 py-2 text-right font-medium">Valor</th>
      <th className="px-3 py-2 text-right font-medium">{b.frequency === "A" ? "Var. anual" : `Var. ${word}`}</th>
      {b.frequency !== "A" && <th className="px-3 py-2 text-right font-medium">Var. interanual</th>}
      {b.kind === "level" && b.frequency !== "A" && <th className="px-3 py-2 text-right font-medium">Acum. en el año</th>}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>{head}</thead>
        {b.years.map((y, i) =>
          i < 2 ? (
            <tbody key={y.year}>
              <tr>
                <th colSpan={5} className="bg-muted/30 px-3 py-1 text-left text-[11px] font-medium">{y.year}</th>
              </tr>
              <Rows rows={y.rows} b={b} unit={unit} />
            </tbody>
          ) : null,
        )}
      </table>
      {b.years.length > 2 && (
        <div className="flex flex-col">
          {b.years.slice(2).map((y) => (
            <details key={y.year} className="border-t border-border/50">
              <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-medium hover:bg-accent">{y.year}</summary>
              <table className="w-full min-w-[520px] text-xs">
                <tbody>
                  <Rows rows={y.rows} b={b} unit={unit} />
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}
      <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {b.kind === "rate"
          ? "La serie ya es una tasa: las variaciones se expresan en puntos porcentuales (pp)."
          : `Variaciones porcentuales calculadas sobre los valores publicados${b.frequency !== "A" ? "; la acumulada en el año compara contra el último período del año anterior" : ""}.`}
        {b.aggregation && ` Serie ${b.aggregation === "avg" ? "diaria resumida con el promedio de cada mes" : b.aggregation === "last" ? "diaria resumida con el último dato de cada mes" : "diaria sumada por mes"}; el mes en curso se excluye hasta que esté completo.`}
        {" "}Si falta el período de comparación, la variación queda vacía (—).
      </p>
    </div>
  );
}

/**
 * Tabla mes a mes de varias series (filas = meses, columnas = series), como
 * el cuadro resumen del INDEC. Niveles: variación mensual; tasas: el valor.
 */
export function MultiPeriodTable({ series, months = 24 }: { series: SeriesData[]; months?: number }) {
  const cols = series
    .map((s) => ({ s, b: periodBreakdown(s.points, s.meta.frequency, s.meta.unit, s.meta.name) }))
    .filter((c) => c.b.frequency === "M" && c.b.rows.length > 0);
  if (!cols.length) return null;
  const dates = [...new Set(cols.flatMap((c) => c.b.rows.map((r) => r.d)))].sort().reverse().slice(0, months);
  const maps = cols.map((c) => new Map(c.b.rows.map((r) => [r.d, r])));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ minWidth: 160 + cols.length * 130 }}>
        <thead>
          <tr className="border-b border-border text-left align-bottom text-[10px] text-muted-foreground">
            <th className="label-caps px-3 py-2 font-medium">Mes</th>
            {cols.map(({ s, b }) => (
              <th key={s.meta.id} className="px-3 py-2 text-right font-medium">
                <Link href={`/indicadores/${encodeURIComponent(s.meta.id)}`} className="line-clamp-2 hover:text-amber">
                  {s.meta.name}
                </Link>
                <span className="block font-normal">{b.kind === "rate" ? s.meta.unit : "var. % mensual"}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => (
            <tr key={d} className="border-b border-border/50">
              <td className="px-3 py-1.5 whitespace-nowrap">{periodName(d, "M")}</td>
              {cols.map(({ s, b }, j) => {
                const r = maps[j].get(d);
                const v = !r ? null : b.kind === "rate" ? r.value : r.prev;
                return (
                  <td key={s.meta.id} className="num px-3 py-1.5 text-right">
                    {v === null ? <span className="text-muted-foreground">—</span> : b.kind === "rate" ? formatNumber(v, { decimals: 2 }) : `${formatNumber(v, { decimals: 1 })} %`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        Índices y niveles: variación % contra el mes anterior. Series que ya son tasas: su valor. Las series diarias se resumen por mes (promedio o cierre según el tipo). “—”: sin dato publicado para ese mes. Hacé clic en una serie para ver su detalle completo mes a mes.
      </p>
    </div>
  );
}
