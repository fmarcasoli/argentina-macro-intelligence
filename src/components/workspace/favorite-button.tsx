"use client";

import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Marca o desmarca un indicador como favorito del espacio de trabajo (guardado en la base). */
export function FavoriteButton({ indicatorId, className }: { indicatorId: string; className?: string }) {
  const [fav, setFav] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/workspace/favorites")
      .then((r) => r.json())
      .then((j: { favorites?: { id: string }[] }) => alive && setFav(Boolean(j.favorites?.some((f) => f.id === indicatorId))))
      .catch(() => alive && setFav(false));
    return () => {
      alive = false;
    };
  }, [indicatorId]);

  const toggle = async () => {
    setError(null);
    const next = !fav;
    setFav(next);
    const res = next
      ? await fetch("/api/workspace/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ indicatorId }),
        })
      : await fetch(`/api/workspace/favorites?id=${encodeURIComponent(indicatorId)}`, { method: "DELETE" });
    if (!res.ok) {
      setFav(!next);
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={fav === null}
      aria-pressed={Boolean(fav)}
      title={error ?? (fav ? "Quitar de favoritos" : "Agregar a favoritos")}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-amber/50 hover:text-foreground disabled:opacity-50",
        fav && "border-amber/50 text-amber",
        className,
      )}
    >
      <Star className={cn("size-3.5", fav && "fill-current")} aria-hidden />
      {fav ? "Favorito" : "Agregar a favoritos"}
    </button>
  );
}
