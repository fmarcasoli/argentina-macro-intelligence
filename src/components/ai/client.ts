"use client";

import type { Pt, SeriesData } from "@/lib/analysis/types";
import type { CatalogHit, DataClient } from "@/lib/ai/types";
import { openAiCompatibleProvider, serverProvider, type LlmProvider } from "@/lib/ai/agent";

/**
 * Cliente de datos del navegador para MACRO AI: usa las mismas APIs validadas
 * que el resto de la app (/api/indicators, /api/series, /api/workspace). Nunca
 * acceso directo a la base. Las series se cachean durante la sesión.
 */
export function browserDataClient(): DataClient {
  const cache = new Map<string, { series: SeriesData; ipc?: Pt[] }>();
  let ipcCache: Pt[] | undefined;
  return {
    async search(q, opts) {
      const u = new URLSearchParams({ q, limit: String(opts?.limit ?? 8) });
      if (opts?.source) u.set("source", opts.source);
      const r = await fetch(`/api/indicators?${u}`);
      const j = (await r.json()) as { rows?: CatalogHit[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      return j.rows ?? [];
    },
    async series(ids) {
      const need = ids.filter((id) => !cache.has(id));
      const errors: Record<string, string> = {};
      let missing: string[] = [];
      if (need.length || !ipcCache) {
        for (let i = 0; i < Math.max(1, need.length); i += 8) {
          const chunk = need.slice(i, i + 8);
          const q = (chunk.length ? chunk : ["indec.ipc_nivel_general"]).join(",");
          const r = await fetch(`/api/series?ids=${encodeURIComponent(q)}&ipc=1`);
          const j = (await r.json()) as { series?: SeriesData[]; ipc?: Pt[]; missing?: string[]; errors?: Record<string, string>; error?: string };
          if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
          ipcCache = j.ipc ?? ipcCache;
          for (const s of j.series ?? []) cache.set(s.meta.id, { series: s });
          missing = [...missing, ...(j.missing ?? [])];
          Object.assign(errors, j.errors ?? {});
        }
      }
      return { series: ids.map((id) => cache.get(id)?.series).filter((s): s is SeriesData => Boolean(s)), ipc: ipcCache, missing: ids.filter((id) => missing.includes(id)), errors };
    },
    async savedAnalyses() {
      const r = await fetch("/api/workspace/analyses");
      const j = (await r.json()) as { analyses?: { id: string; title: string; kind: string; indicator_ids: string[]; updated_at: string }[] };
      return j.analyses ?? [];
    },
  };
}

export type AiMode = "rules" | "browser" | "server";

export interface AiSettings {
  /** rules: sin modelo · browser: Ollama local desde el navegador · server: vía el servidor de la app. */
  mode: AiMode;
  ollamaUrl: string;
  model: string;
  /** Guardar conversaciones en la memoria de investigación. */
  saveHistory: boolean;
}

export const DEFAULT_SETTINGS: AiSettings = { mode: "browser", ollamaUrl: "http://localhost:11434", model: "qwen2.5:7b", saveHistory: true };
const KEY = "ami.macroai.settings";

/** Configuración guardada; sin configuración previa, usa el modelo del servidor si la app tiene uno. */
export function loadSettings(serverConfigured = false): AiSettings {
  const base = serverConfigured ? { ...DEFAULT_SETTINGS, mode: "server" as const } : DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<AiSettings>) } : base;
  } catch {
    return base;
  }
}

export function saveSettings(s: AiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento no disponible: la configuración vale solo para esta sesión */
  }
}

/** Modelos instalados en un Ollama local (GET /api/tags). */
export async function ollamaModels(baseUrl: string): Promise<{ ok: true; models: { name: string; size: number }[] } | { ok: false; error: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, error: `Ollama respondió ${r.status}` };
    const j = (await r.json()) as { models?: { name: string; size: number }[] };
    return { ok: true, models: j.models ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "Sin respuesta (¿Ollama está corriendo?)" : (e as Error).message };
  }
}

export function makeProvider(s: AiSettings, server: { configured: boolean; model: string | null; label: string }): LlmProvider | null {
  if (s.mode === "browser") return openAiCompatibleProvider({ baseUrl: `${s.ollamaUrl.replace(/\/$/, "")}/v1`, model: s.model, label: "Ollama local" });
  if (s.mode === "server" && server.configured) return serverProvider(server.model ?? "", server.label);
  return null;
}
