"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Pt, SeriesData } from "@/lib/analysis/types";
import type { EconTask } from "@/lib/econ/tasks";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * Ejecuta tareas del motor econométrico en un Web Worker. Si el navegador no
 * soporta workers, cae al cálculo en el hilo principal (mismo código).
 */
export function useEconWorker() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const seq = useRef(0);

  useEffect(() => {
    const map = pending.current;
    return () => {
      worker.current?.terminate();
      worker.current = null;
      for (const p of map.values()) p.reject(new Error("Cálculo cancelado"));
      map.clear();
    };
  }, []);

  return useCallback(async <T,>(task: EconTask): Promise<T & { ms?: number }> => {
    if (typeof Worker === "undefined") {
      const { runTask } = await import("@/lib/econ/tasks");
      return runTask(task) as T & { ms?: number };
    }
    if (!worker.current) {
      worker.current = new Worker(new URL("../../lib/econ/econ.worker.ts", import.meta.url), { type: "module" });
      worker.current.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string; ms?: number }>) => {
        const p = pending.current.get(e.data.id);
        if (!p) return;
        pending.current.delete(e.data.id);
        if (e.data.ok) p.resolve({ ...(e.data.result as object), ms: e.data.ms });
        else p.reject(new Error(e.data.error));
      };
      worker.current.onerror = (e) => {
        for (const p of pending.current.values()) p.reject(new Error(e.message || "Error en el cálculo"));
        pending.current.clear();
        worker.current?.terminate();
        worker.current = null;
      };
    }
    const id = ++seq.current;
    return new Promise((resolve, reject) => {
      pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.current!.postMessage({ id, task });
    });
  }, []);
}

export interface LoadedSeries {
  key: string;
  series: SeriesData[];
  ipc?: Pt[];
  errors: Record<string, string>;
  missing: string[];
}

/** Descarga series reales de /api/series (con IPC para deflactar). */
export function useSeries(ids: string[]) {
  const key = ids.join(",");
  const [state, setState] = useState<{ data: LoadedSeries | null; error: { key: string; message: string } | null }>({ data: null, error: null });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch(`/api/series?ids=${encodeURIComponent(key)}&ipc=1`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        return j as Omit<LoadedSeries, "key">;
      })
      .then((j) => alive && setState({ data: { ...j, key }, error: null }))
      .catch((e: Error) => alive && setState((s) => ({ data: s.data, error: { key, message: e.message } })));
    return () => {
      alive = false;
    };
  }, [key]);
  const data = state.data?.key === key ? state.data : null;
  const error = state.error?.key === key ? state.error.message : null;
  return { data, error, loading: Boolean(key) && !data && !error };
}

/** Estado de una ejecución en el worker. */
export function useRun<T>() {
  const run = useEconWorker();
  const [state, setState] = useState<{ busy: boolean; result: (T & { ms?: number }) | null; error: string | null }>({ busy: false, result: null, error: null });
  const exec = useCallback(
    async (task: EconTask) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        const result = await run<T>(task);
        setState({ busy: false, result, error: null });
      } catch (e) {
        setState({ busy: false, result: null, error: (e as Error).message });
      }
    },
    [run],
  );
  return { ...state, exec };
}
