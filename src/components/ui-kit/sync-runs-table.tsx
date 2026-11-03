import Link from "next/link";
import type { SyncRun } from "@/lib/data/queries";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SyncRunsTable({ runs, showIndicator }: { runs: SyncRun[]; showIndicator?: boolean }) {
  if (runs.length === 0) return <p className="p-3 text-xs text-muted-foreground">Sin sincronizaciones.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-xs">
        <thead>
          <tr className="label-caps border-b border-border text-left text-[10px] text-muted-foreground">
            <th className="px-3 py-2 font-medium">Inicio</th>
            {showIndicator && <th className="px-3 py-2 font-medium">Indicador</th>}
            <th className="px-3 py-2 font-medium">Modo</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 text-right font-medium">Recibidos</th>
            <th className="px-3 py-2 text-right font-medium">Nuevos</th>
            <th className="px-3 py-2 text-right font-medium">Revisados</th>
            <th className="px-3 py-2 text-right font-medium">Rechazados</th>
            <th className="px-3 py-2 text-right font-medium">ms</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="num px-3 py-1.5 whitespace-nowrap text-muted-foreground">{formatDateTime(r.started_at)}</td>
              {showIndicator && (
                <td className="px-3 py-1.5">
                  {r.indicator_id ? (
                    <Link href={`/indicadores/${encodeURIComponent(r.indicator_id)}`} className="num hover:text-amber">{r.indicator_id}</Link>
                  ) : "—"}
                </td>
              )}
              <td className="px-3 py-1.5">{r.mode === "full" ? "completa" : "incremental"}</td>
              <td
                className={cn(
                  "px-3 py-1.5",
                  r.status === "success" && "text-positive",
                  r.status === "partial" && "text-warning",
                  r.status === "failed" && "text-negative",
                )}
              >
                {{ success: "✓ ok", partial: "~ parcial", failed: "✗ fallida", running: "… en curso" }[r.status]}
              </td>
              <td className="num px-3 py-1.5 text-right">{r.rows_fetched}</td>
              <td className="num px-3 py-1.5 text-right">{r.rows_inserted}</td>
              <td className="num px-3 py-1.5 text-right">{r.rows_updated}</td>
              <td className="num px-3 py-1.5 text-right">{r.rows_rejected}</td>
              <td className="num px-3 py-1.5 text-right text-muted-foreground">{r.duration_ms ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
