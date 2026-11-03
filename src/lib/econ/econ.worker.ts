/// <reference lib="webworker" />
import { runTask, type EconTask } from "./tasks";

/**
 * Web Worker del motor econométrico: los cálculos (ARIMA, VAR, simulaciones de
 * Monte Carlo, backtesting) corren fuera del hilo de la interfaz y fuera de
 * las funciones de Vercel.
 */
self.onmessage = (e: MessageEvent<{ id: number; task: EconTask }>) => {
  const { id, task } = e.data;
  const t0 = performance.now();
  try {
    const result = runTask(task);
    self.postMessage({ id, ok: true, result, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
