/**
 * Descubre TODAS las series publicadas por cada fuente y las registra en el
 * catálogo como no sincronizadas (is_tracked = false). Para empezar a
 * sincronizar una, basta con marcarla:  update indicators set is_tracked = true where id = '…';
 *
 *   npm run catalog:discover            # BCRA + INDEC
 *   npm run catalog:discover -- BCRA    # una sola fuente
 */
import "./env";
import type { SourceId } from "../src/lib/connectors/types";
import { closeSql, getSql } from "../src/lib/db/client";
import { registerDiscovered } from "../src/lib/ingest/catalog";
import { defaultConnectors } from "../src/lib/ingest/connectors";

async function main() {
  const sql = getSql();
  const connectors = defaultConnectors();
  const arg = process.argv[2]?.toUpperCase() as SourceId | undefined;
  const sources: SourceId[] = arg ? [arg] : ["BCRA", "INDEC"];

  for (const sourceId of sources) {
    const connector = connectors[sourceId];
    if (!connector) throw new Error(`Fuente desconocida: ${sourceId}`);
    console.log(`[discover] ${sourceId}: consultando catálogo de la fuente…`);
    try {
      const series = await connector.discover();
      const n = await registerDiscovered(sql, sourceId, series);
      console.log(`[discover] ${sourceId}: ${series.length} series encontradas, ${n} registradas/actualizadas.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[discover] ${sourceId}: ✗ ${message}`);
      await sql`insert into sync_errors (stage, message, details)
                values ('catalog', ${`Descubrimiento ${sourceId}: ${message}`}, null)`;
      process.exitCode = 1;
    }
  }
}

main()
  .catch((err) => {
    console.error("[discover] Error:", err);
    process.exitCode = 1;
  })
  .finally(closeSql);
