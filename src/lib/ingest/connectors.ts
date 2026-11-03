import { BCRAConnector } from "../connectors/bcra";
import { INDECConnector } from "../connectors/indec";
import type { SourceConnector, SourceId } from "../connectors/types";

export type ConnectorMap = Record<SourceId, SourceConnector>;

/** Registro de conectores por fuente. Sumar una fuente nueva = sumar una entrada. */
export function defaultConnectors(): ConnectorMap {
  return {
    BCRA: new BCRAConnector(),
    INDEC: new INDECConnector(),
  };
}
