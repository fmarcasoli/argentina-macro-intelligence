"use client";

import { ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { specFromSearchParams, specToSearchParams, DEFAULT_SPEC, type AnalysisSpec } from "@/lib/analysis/pipeline";
import { TRANSFORM_LABEL } from "@/lib/analysis/types";
import { formatDateTime, formatValue, periodLabel } from "@/lib/format";
import type { Frequency } from "@/lib/connectors/types";

interface Favorite {
  id: string;
  name: string;
  source_id: string;
  unit: string;
  frequency: Frequency;
  last_date: string | null;
  last_value: number | null;
  update_status: string;
  created_at: string;
}
interface Saved {
  id: string;
  title: string;
  kind: string;
  definition: Partial<AnalysisSpec>;
  indicator_ids: string[];
  updated_at: string;
}

const KIND: Record<string, string> = { analysis: "Análisis", chart: "Gráfico", calculator: "Calculadora" };

/** Favoritos y análisis guardados del espacio de trabajo (leídos de la base de datos). */
export function FavoritesView() {
  const [favs, setFavs] = useState<Favorite[] | null>(null);
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetch("/api/workspace/favorites").then((r) => r.json()), fetch("/api/workspace/analyses").then((r) => r.json())])
      .then(([f, a]) => {
        if (!alive) return;
        if (f.error || a.error) setError(f.error ?? a.error);
        setFavs(f.favorites ?? []);
        setSaved(a.analyses ?? []);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const removeFav = async (id: string) => {
    await fetch(`/api/workspace/favorites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setFavs((f) => f?.filter((x) => x.id !== id) ?? null);
  };
  const removeSaved = async (id: string) => {
    if (!confirm("¿Eliminar este análisis guardado?")) return;
    const r = await fetch(`/api/workspace/analyses/${id}`, { method: "DELETE" });
    if (r.ok) setSaved((s) => s?.filter((x) => x.id !== id) ?? null);
  };
  const openHref = (a: Saved) => {
    const spec = specFromSearchParams(specToSearchParams({ ...DEFAULT_SPEC, ...a.definition, ids: a.definition.ids ?? a.indicator_ids }));
    return `/analisis?${specToSearchParams(spec).toString()}&a=${a.id}`;
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {error && <p className="rounded border border-negative/30 bg-negative/5 p-2 text-xs xl:col-span-2">{error}</p>}
      <section className="min-w-0 rounded-md border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="label-caps text-[10px] text-muted-foreground">Análisis guardados</h2>
          <span className="num ml-auto text-[10px] text-muted-foreground">{saved?.length ?? "…"}</span>
        </header>
        {saved === null ? (
          <div className="h-40 animate-pulse bg-muted/30" />
        ) : saved.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            Todavía no guardaste análisis. Armá uno en <Link href="/analisis" className="text-amber hover:underline">Análisis integrado</Link> o
            desde la ficha de cualquier indicador y tocá “Guardar análisis”.
          </p>
        ) : (
          <ul>
            {saved.map((a) => (
              <li key={a.id} className="flex items-start gap-2 border-b border-border/50 px-3 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <Link href={openHref(a)} className="line-clamp-2 text-sm hover:text-amber">
                    {a.title}
                  </Link>
                  <div className="num text-[10px] text-muted-foreground">
                    {KIND[a.kind] ?? a.kind} · {(a.definition.ids ?? a.indicator_ids).length} serie(s) ·{" "}
                    {TRANSFORM_LABEL[(a.definition.transform ?? "level") as keyof typeof TRANSFORM_LABEL]}
                    {a.definition.from ? ` · desde ${a.definition.from}` : ""}
                    {a.definition.to ? ` · hasta ${a.definition.to}` : ""} · {formatDateTime(a.updated_at)}
                  </div>
                </div>
                <Link href={openHref(a)} aria-label={`Abrir ${a.title}`} className="text-muted-foreground hover:text-amber">
                  <ExternalLink className="size-3.5" />
                </Link>
                <button type="button" onClick={() => removeSaved(a.id)} aria-label={`Eliminar ${a.title}`} className="text-muted-foreground hover:text-negative">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-md border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="label-caps text-[10px] text-muted-foreground">Series favoritas</h2>
          <span className="num ml-auto text-[10px] text-muted-foreground">{favs?.length ?? "…"}</span>
        </header>
        {favs === null ? (
          <div className="h-40 animate-pulse bg-muted/30" />
        ) : favs.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            Marcá series con la estrella “Agregar a favoritos” en su ficha. Explorá el <Link href="/indec" className="text-amber hover:underline">panel INDEC</Link> o el{" "}
            <Link href="/bcra" className="text-amber hover:underline">panel BCRA</Link>.
          </p>
        ) : (
          <>
            <ul>
              {favs.map((f) => (
                <li key={f.id} className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <Link href={`/indicadores/${encodeURIComponent(f.id)}`} className="line-clamp-1 text-sm hover:text-amber">
                      {f.name}
                    </Link>
                    <div className="num text-[10px] text-muted-foreground">
                      {f.source_id} · {periodLabel(f.last_date, f.frequency)}
                    </div>
                  </div>
                  <span className="num shrink-0 text-sm">{formatValue(f.last_value, f.unit, { compact: true })}</span>
                  <button type="button" onClick={() => removeFav(f.id)} aria-label={`Quitar ${f.name}`} className="text-muted-foreground hover:text-negative">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {favs.length > 1 && (
              <div className="border-t border-border px-3 py-2">
                <Link
                  href={`/analisis?s=${favs.slice(0, 8).map((f) => encodeURIComponent(f.id)).join(",")}`}
                  className="text-xs text-amber hover:underline"
                >
                  Comparar favoritas en Análisis integrado →
                </Link>
              </div>
            )}
          </>
        )}
      </section>
      <p className="text-[11px] text-muted-foreground xl:col-span-2">
        Los favoritos y análisis se guardan en la base de datos, asociados a este navegador mediante una cookie segura
        (sin datos personales). Cuando se habilite el inicio de sesión se podrán vincular a tu usuario.
      </p>
    </div>
  );
}
