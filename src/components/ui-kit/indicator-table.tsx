import Link from "next/link";
import { Sparkline } from "@/components/charts/sparkline";
import type { IndicatorSnapshot } from "@/lib/data/queries";
import { computeChange, FREQUENCY_LABEL, formatChange, formatValue, periodLabel, shortUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KindBadge, StatusBadge } from "./badges";

/** Tabla financiera de indicadores, agrupada por categoría. */
export function IndicatorTable({ rows }: { rows: IndicatorSnapshot[] }) {
  const groups = new Map<string, IndicatorSnapshot[]>();
  for (const r of rows) {
    const arr = groups.get(r.category) ?? [];
    arr.push(r);
    groups.set(r.category, arr);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr className="label-caps border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-3 pl-3 font-medium">Indicador</th>
            <th className="px-3 py-2 text-right font-medium">Último</th>
            <th className="px-3 py-2 text-right font-medium">Var.</th>
            <th className="px-3 py-2 font-medium">Período</th>
            <th className="px-3 py-2 font-medium">Unidad</th>
            <th className="px-3 py-2 font-medium">Frec.</th>
            <th className="px-3 py-2 font-medium">Tendencia</th>
            <th className="py-2 pr-3 pl-3 font-medium">Estado</th>
          </tr>
        </thead>
        {[...groups.entries()].map(([category, items]) => (
          <tbody key={category}>
            <tr>
              <th colSpan={8} scope="colgroup" className="bg-secondary/50 px-3 py-1 text-left text-[11px] font-semibold tracking-wider text-amber uppercase">
                {category}
              </th>
            </tr>
            {items.map((r) => {
              const ch = computeChange(r.last_value, r.prev_value, r.unit);
              return (
                <tr key={r.id} className="border-b border-border/60 hover:bg-accent/60">
                  <td className="py-1.5 pr-3 pl-3">
                    <Link href={`/indicadores/${encodeURIComponent(r.id)}`} className="flex items-center gap-1.5 hover:text-amber">
                      <span className="truncate">{r.name}</span>
                      {r.value_kind !== "original" && <KindBadge kind={r.value_kind} />}
                    </Link>
                    <div className="num text-[10px] text-muted-foreground">
                      {r.source_code ?? r.id}
                    </div>
                  </td>
                  <td className="num px-3 py-1.5 text-right">{formatValue(r.last_value, r.unit, { compact: true })}</td>
                  <td
                    className={cn(
                      "num px-3 py-1.5 text-right",
                      ch && ch.value > 0 && "text-positive",
                      ch && ch.value < 0 && "text-negative",
                    )}
                  >
                    {formatChange(ch)}
                  </td>
                  <td className="num px-3 py-1.5 whitespace-nowrap text-muted-foreground">{periodLabel(r.last_date, r.frequency)}</td>
                  <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground" title={r.unit}>{shortUnit(r.unit)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{FREQUENCY_LABEL[r.frequency]}</td>
                  <td className="px-3 py-1.5">
                    <Sparkline data={r.spark} className="h-6 w-24" />
                  </td>
                  <td className="py-1.5 pr-3 pl-3">
                    <StatusBadge status={r.update_status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
