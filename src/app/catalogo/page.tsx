import Link from "next/link";
import { Suspense } from "react";
import { KindBadge, SourceBadge, StatusBadge } from "@/components/ui-kit/badges";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { PageHeader, Panel } from "@/components/ui-kit/panel";
import type { Frequency, SourceId } from "@/lib/connectors/types";
import { searchCatalog } from "@/lib/data/queries";
import { FREQUENCY_LABEL, formatNumber } from "@/lib/format";

export const metadata = { title: "Catálogo de indicadores" };

const PAGE_SIZE = 50;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function CatalogPage({ searchParams }: PageProps<"/catalogo">) {
  return (
    <>
      <PageHeader
        code="CAT"
        title="Catálogo de indicadores"
        description="Todas las series descubiertas en las APIs oficiales. Las marcadas como sincronizadas se descargan y actualizan automáticamente; el resto puede activarse sin modificar la estructura de la aplicación."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
        <CatalogResults searchParams={searchParams as Promise<SP>} />
      </Suspense>
    </>
  );
}

async function CatalogResults({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const source = one(sp.source).toUpperCase();
  const tracked = one(sp.tracked);
  const freq = one(sp.freq).toUpperCase();
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const res = await safeLoad(() =>
    searchCatalog({
      q,
      sourceId: source === "BCRA" || source === "INDEC" ? (source as SourceId) : undefined,
      tracked: tracked === "1" ? true : tracked === "0" ? false : undefined,
      frequency: ["D", "W", "M", "Q", "S", "A"].includes(freq) ? (freq as Frequency) : undefined,
      includeDiscontinued: one(sp.disc) === "1",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  );
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const { rows, total } = res.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (source) u.set("source", source);
    if (tracked) u.set("tracked", tracked);
    if (freq) u.set("freq", freq);
    if (one(sp.disc)) u.set("disc", one(sp.disc));
    u.set("page", String(p));
    return `/catalogo?${u.toString()}`;
  };

  const selectCls = "h-8 rounded-md border border-input bg-background px-2 text-xs";
  return (
    <Panel
      title={`${formatNumber(total, { decimals: 0 })} series`}
      code="IDX"
      bodyClassName="p-0"
      actions={<span className="num text-[11px] text-muted-foreground">pág. {page}/{pages}</span>}
    >
      <form className="flex flex-wrap items-center gap-2 border-b border-border p-3" action="/catalogo">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, categoría o código…"
          className="h-8 min-w-60 flex-1 rounded-md border border-input bg-background px-2.5 text-xs placeholder:text-muted-foreground"
        />
        <select name="source" defaultValue={source} className={selectCls} aria-label="Fuente">
          <option value="">Todas las fuentes</option>
          <option value="INDEC">INDEC</option>
          <option value="BCRA">BCRA</option>
        </select>
        <select name="tracked" defaultValue={tracked} className={selectCls} aria-label="Sincronización">
          <option value="">Todas</option>
          <option value="1">Sincronizadas</option>
          <option value="0">No sincronizadas</option>
        </select>
        <select name="freq" defaultValue={freq} className={selectCls} aria-label="Frecuencia">
          <option value="">Toda frecuencia</option>
          {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" name="disc" value="1" defaultChecked={one(sp.disc) === "1"} /> Incluir discontinuadas
        </label>
        <button type="submit" className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          Filtrar
        </button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="label-caps border-b border-border text-left text-[10px] text-muted-foreground">
              <th className="px-3 py-2 font-medium">Serie</th>
              <th className="px-3 py-2 font-medium">Fuente</th>
              <th className="px-3 py-2 font-medium">Categoría</th>
              <th className="px-3 py-2 font-medium">Unidad</th>
              <th className="px-3 py-2 font-medium">Frec.</th>
              <th className="px-3 py-2 font-medium">Último dato (fuente)</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-accent/60">
                <td className="max-w-md px-3 py-1.5">
                  <Link href={`/indicadores/${encodeURIComponent(r.id)}`} className="line-clamp-2 hover:text-amber">
                    {r.name}
                  </Link>
                  <div className="num mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {r.source_code}
                    {r.is_tracked && <span className="rounded-sm bg-amber/15 px-1 text-amber">SYNC</span>}
                    {r.value_kind !== "original" && <KindBadge kind={r.value_kind} />}
                  </div>
                </td>
                <td className="px-3 py-1.5"><SourceBadge source={r.source_id} /></td>
                <td className="max-w-56 px-3 py-1.5 text-muted-foreground">
                  <div className="truncate">{r.category}</div>
                  <div className="truncate text-[10px]">{r.subcategory}</div>
                </td>
                <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground" title={r.unit}>{r.unit}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{FREQUENCY_LABEL[r.frequency]}</td>
                <td className="num px-3 py-1.5 text-muted-foreground">{r.source_last_date ?? "—"}</td>
                <td className="px-3 py-1.5"><StatusBadge status={r.update_status} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">Sin resultados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border p-3 text-xs">
        {page > 1 ? <Link href={href(page - 1)} className="text-amber hover:underline">← Anterior</Link> : <span />}
        {page < pages ? <Link href={href(page + 1)} className="text-amber hover:underline">Siguiente →</Link> : <span />}
      </div>
    </Panel>
  );
}
