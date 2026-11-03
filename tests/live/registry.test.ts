/**
 * Verifica contra las APIs reales que cada serie del registro existe, tiene la
 * frecuencia declarada y devuelve datos. Útil para detectar cambios de las fuentes.
 *
 *   npm run test:live
 */
import { describe, expect, it } from "vitest";
import { BCRAConnector } from "@/lib/connectors/bcra";
import { INDECConnector } from "@/lib/connectors/indec";
import { SOURCE_SERIES } from "@/lib/catalog/registry";
import { addDays } from "@/lib/normalize/dates";
import { todayAR } from "@/lib/utils/time";

const live = process.env.LIVE_API_TESTS === "1";
const connectors = { BCRA: new BCRAConnector(), INDEC: new INDECConnector() };

describe.skipIf(!live)("series del registro contra las APIs oficiales", () => {
  for (const def of SOURCE_SERIES) {
    it(`${def.id} (${def.sourceId} ${def.sourceCode})`, async () => {
      const c = connectors[def.sourceId];
      const meta = await c.describe(def.sourceCode);
      expect(meta.frequency).toBe(def.frequency);
      const from = addDays(todayAR(), -800);
      const r = await c.fetchSeries(def.sourceCode, { from });
      // La tasa de política monetaria está discontinuada: puede no tener datos recientes.
      if (def.id !== "bcra.tasa_politica") expect(r.observations.length).toBeGreaterThan(0);
    }, 60_000);
  }
});
