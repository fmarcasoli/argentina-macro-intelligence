import Link from "next/link";
import { Sparkline } from "@/components/charts/sparkline";
import type { IndicatorSnapshot } from "@/lib/data/queries";
import { computeChange, formatChange, formatValue, periodLabel, shortUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KindBadge, SourceBadge, StatusBadge } from "./badges";

export function KpiTile({ ind, label }: { ind: IndicatorSnapshot; label?: string }) {
  const change = computeChange(ind.last_value, ind.prev_value, ind.unit);
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
        <Sparkline data={ind.spark} className="h-10 w-24 shrink-0" />
      </div>
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
