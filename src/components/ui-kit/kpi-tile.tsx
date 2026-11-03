import Link from "next/link";
import { Sparkline } from "@/components/charts/sparkline";
import type { IndicatorSnapshot } from "@/lib/data/queries";
import { computeChange, formatChange, formatValue, periodLabel, shortUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KindBadge, SourceBadge, StatusBadge } from "./badges";

/**
 * Tendencia de la ventana del minigráfico: compara el último dato con el
 * primero de la ventana. Umbral: ±0,5 pp para tasas, ±1 % para el resto.
 */
export function trendOf(ind: Pick<IndicatorSnapshot, "spark" | "unit">): { dir: "up" | "down" | "flat"; label: string } | null {
  const pts = ind.spark.filter((p) => p.v !== null);
  if (pts.length < 3) return null;
  const first = pts[0].v as number;
  const last = pts[pts.length - 1].v as number;
  const ch = computeChange(last, first, ind.unit);
  if (!ch) return null;
  const threshold = ch.kind === "pp" ? 0.5 : 1;
  const dir = ch.value > threshold ? "up" : ch.value < -threshold ? "down" : "flat";
  return { dir, label: dir === "up" ? "En alza" : dir === "down" ? "En baja" : "Estable" };
}

const TREND_ICON = { up: "↗", down: "↘", flat: "→" } as const;

export function KpiTile({ ind, label, note }: { ind: IndicatorSnapshot; label?: string; note?: string | null }) {
  const change = computeChange(ind.last_value, ind.prev_value, ind.unit);
  const trend = trendOf(ind);
  const window = ind.spark.length
    ? `${periodLabel(ind.spark[0].d, ind.frequency)} – ${periodLabel(ind.spark[ind.spark.length - 1].d, ind.frequency)}`
    : "";
  const up = change && change.value > 0;
  const down = change && change.value < 0;
  return (
    <Link
      href={`/indicadores/${encodeURIComponent(ind.id)}`}
      className="group flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3 transition-colors hover:border-amber/50"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-muted-foreground group-hover:text-foreground">{label ?? ind.name}</div>
          <div className="num mt-0.5 text-[10px] text-muted-foreground/80">
            {periodLabel(ind.last_date, ind.frequency)} · {shortUnit(ind.unit)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SourceBadge source={ind.source_id} />
          {ind.value_kind !== "original" && <KindBadge kind={ind.value_kind} />}
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="num truncate text-2xl font-medium leading-none tracking-tight">
            {formatValue(ind.last_value, ind.unit, { compact: true })}
          </div>
          <div
            className={cn(
              "num mt-1.5 text-[11px]",
              up && "text-positive",
              down && "text-negative",
              !change && "text-muted-foreground",
            )}
            title={ind.prev_date ? `Comparado con ${periodLabel(ind.prev_date, ind.frequency)}` : undefined}
          >
            {up ? "▲ " : down ? "▼ " : ""}
            {formatChange(change)}
            <span className="ml-1 text-muted-foreground">
              {ind.frequency === "D" ? "vs. hace 1 mes" : "vs. período ant."}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Sparkline data={ind.spark} className="h-10 w-24" />
          {trend && (
            <span className="text-[10px] text-muted-foreground" title={`Tendencia en la ventana ${window} (${ind.spark.length} obs.)`}>
              <span aria-hidden>{TREND_ICON[trend.dir]}</span> {trend.label}
            </span>
          )}
        </div>
      </div>
      {note && <p className="text-[10px] leading-snug text-muted-foreground">{note}</p>}
      {ind.update_status !== "ok" && (
        <div>
          <StatusBadge status={ind.update_status} />
        </div>
      )}
    </Link>
  );
}

export function KpiTileSkeleton() {
  return <div className="h-[118px] animate-pulse rounded-md border border-border bg-card" />;
}
