/**
 * Registra (o actualiza) las series núcleo definidas en src/lib/catalog/registry.ts,
 * verificando cada una contra su API de origen.
 *
 *   npm run catalog:seed
 *   npm run catalog:seed -- bcra.reservas indec.emae     # solo algunas
 */
import "./env";
import { closeSql, getSql } from "../src/lib/db/client";
import { defaultConnectors } from "../src/lib/ingest/connectors";
import { seedCatalog } from "../src/lib/ingest/catalog";

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const report = await seedCatalog(getSql(), defaultConnectors(), { only: only.length ? only : undefined });
  console.log(`[catalog] ${report.registered.length} series registradas.`);
  for (const f of report.failed) console.error(`[catalog] ✗ ${f.id}: ${f.error}`);
  if (report.failed.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[catalog] Error:", err);
    process.exitCode = 1;
  })
  .finally(closeSql);
