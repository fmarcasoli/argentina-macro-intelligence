/**
 * Sincroniza las series seguidas (is_tracked = true).
 *
 *   npm run sync                       # incremental, todas las fuentes
 *   npm run sync -- --full             # recarga completa del histórico
 *   npm run sync -- --source=BCRA      # una fuente
 *   npm run sync -- bcra.reservas      # indicadores puntuales
 */
import "./env";
import type { SourceId } from "../src/lib/connectors/types";
import { closeSql, getSql } from "../src/lib/db/client";
import { defaultConnectors } from "../src/lib/ingest/connectors";
import { syncAll } from "../src/lib/ingest/sync";

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--full") ? "full" : "incremental";
  const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1]?.toUpperCase() as SourceId | undefined;
  const ids = args.filter((a) => !a.startsWith("--"));
  const t0 = Date.now();

  console.log(`[sync] modo ${mode}${sourceArg ? `, fuente ${sourceArg}` : ""}${ids.length ? `, ${ids.join(", ")}` : ""}`);
  const outcomes = await syncAll(getSql(), defaultConnectors(), {
    mode,
    sourceId: sourceArg,
    ids: ids.length ? ids : undefined,
    triggeredBy: "cli",
    onProgress: (o) => {
      const icon = o.status === "success" ? "✓" : o.status === "partial" ? "~" : "✗";
      console.log(
        `  ${icon} ${o.indicatorId.padEnd(32)} recibidos ${String(o.fetched).padStart(6)}  nuevos ${String(o.inserted).padStart(6)}  ` +
          `revisados ${String(o.updated).padStart(4)}  rechazados ${o.rejected}${o.error ? `  — ${o.error}` : ""}`,
      );
    },
  });
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const total = outcomes.reduce((a, o) => a + o.inserted, 0);
  console.log(`[sync] ${outcomes.length} series, ${total} observaciones nuevas, ${failed} con error, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[sync] Error:", err);
    process.exitCode = 1;
  })
  .finally(closeSql);
