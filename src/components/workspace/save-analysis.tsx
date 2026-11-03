"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { AnalysisSpec } from "@/lib/analysis/pipeline";

/** Guarda la selección actual (series, período, frecuencia, transformación) como análisis del espacio de trabajo. */
export function SaveAnalysisButton({
  spec,
  defaultTitle,
  kind = "analysis",
  extra,
}: {
  spec: AnalysisSpec;
  defaultTitle: string;
  kind?: "analysis" | "chart" | "calculator";
  extra?: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/workspace/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind, definition: { ...spec, ...extra } }),
    });
    if (res.ok) {
      setState("saved");
      setOpen(false);
    } else {
      setState("error");
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    }
  };

  if (!spec.ids.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {open ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            required
            aria-label="Nombre del análisis"
            className="h-7 w-64 max-w-full rounded border border-border bg-background px-2 text-xs"
          />
          <button type="submit" disabled={state === "saving"} className="h-7 rounded border border-amber/50 px-2 text-xs text-amber">
            {state === "saving" ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="h-7 px-1 text-xs text-muted-foreground">
            Cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setState("idle");
          }}
          className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs text-muted-foreground hover:border-amber/50 hover:text-foreground"
        >
          <Save className="size-3.5" aria-hidden /> Guardar análisis
        </button>
      )}
      {state === "saved" && (
        <span className="text-xs text-positive">
          ✓ Guardado. <Link href="/favoritos" className="underline">Ver en Favoritos</Link>
        </span>
      )}
      {state === "error" && <span className="text-xs text-negative">{error}</span>}
    </div>
  );
}
