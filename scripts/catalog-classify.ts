/**
 * Recalcula la categoría de panel (indicators.panel) de todo el catálogo según
 * src/lib/catalog/panels.ts. Se ejecuta solo al registrar o descubrir series;
 * este script sirve para aplicar cambios en las reglas.
 *
 *   npm run catalog:classify
 */
import "./env";
import { closeSql, getSql } from "../src/lib/db/client";
import { refreshPanels } from "../src/lib/ingest/catalog";

refreshPanels(getSql())
  .then((n) => console.log(`[classify] ${n} series reclasificadas.`))
  .catch((err) => {
    console.error("[classify] Error:", err);
    process.exitCode = 1;
  })
  .finally(closeSql);
