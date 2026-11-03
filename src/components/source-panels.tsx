import { Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { IndicatorChart } from "@/components/charts/indicator-chart";
import { SourceBadge, StatusBadge } from "@/components/ui-kit/badges";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { KpiTile, KpiTileSkeleton } from "@/components/ui-kit/kpi-tile";
import { MultiPeriodTable } from "@/components/period-table";
import { PageHeader, Panel } from "@/components/ui-kit/panel";
import { isNominalPesos } from "@/lib/analysis/units";
import { panelsFor, type PanelDef } from "@/lib/catalog/panels";
import type { SourceId } from "@/lib/connectors/types";
import { getIndicatorSnapshots, getSourceSummaries, searchCatalog } from "@/lib/data/queries";
import { getIpcMonthly, getPanelCounts, getPoints, getSeriesMetas } from "@/lib/data/series";
import { FREQUENCY_LABEL, formatDateTime, formatNumber, shortUnit } from "@/lib/format";
import { cn } from "@/lib/utils";

const base = (s: SourceId) => (s === "INDEC" ? "/indec" : "/bcra");
const PAGE = 40;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Portada de un panel de fuente: buscador, categorías y destacados. */
export function SourceHome({
  sourceId,
  code,
  title,
  description,
  headline,
  searchParams,
}: {
  sourceId: SourceId;
  code: string;
  title: string;
  description: string;
  headline: string[];
  searchParams: Promise<SP>;
}) {
  return (
    <>
      <PageHeader code={code} title={title} description={description}>
        <SearchBox sourceId={sourceId} action={base(sourceId)} />
      </PageHeader>
      <Suspense fallback={null}>
        <HomeSearchResults sourceId={sourceId} searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<KpiRowSkeleton n={headline.length} />}>
        <KpiRow ids={headline} />
      </Suspense>
      <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_340px]">
        <Panel title="Categorías" code="CAT">
          <Suspense fallback={<div className="h-80 animate-pulse bg-muted/30" />}>
            <CategoryGrid sourceId={sourceId} />
          </Suspense>
        </Panel>
        <Suspense fallback={<Panel title="Fuente"><div className="h-60 animate-pulse bg-muted/30" /></Panel>}>
          <SourceInfo sourceId={sourceId} />
        </Suspense>
      </div>
    </>
  );
}

async function HomeSearchResults({ sourceId, searchParams }: { sourceId: SourceId; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  if (!q) return null;
  return (
    <Panel title={`Resultados para “${q}”`} code="BUS" className="mb-4" bodyClassName="p-0">
      <SeriesList sourceId={sourceId} q={q} page={Math.max(1, Number(one(sp.page)) || 1)} disc={one(sp.disc) === "1"} hrefBase={base(sourceId)} />
    </Panel>
  );
}

async function CategoryGrid({ sourceId }: { sourceId: SourceId }) {
  const res = await safeLoad(() => getPanelCounts(sourceId));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const counts = new Map(res.data.map((c) => [c.panel, c]));
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {panelsFor(sourceId).map((p) => {
        const c = counts.get(p.slug);
        return (
          <li key={p.slug}>
            <Link
              href={`${base(sourceId)}/${p.slug}`}
              className="flex h-full flex-col gap-1 rounded-md border border-border p-3 transition-colors hover:border-amber/50"
            >
              <span className="text-sm font-medium">{p.label}</span>
              <span className="line-clamp-2 text-[11px] text-muted-foreground">{p.description}</span>
              <span className="num mt-auto pt-1 text-[10px] text-muted-foreground">
                {formatNumber(c?.active ?? 0, { decimals: 0 })} series vigentes · {formatNumber(c?.with_data ?? 0, { decimals: 0 })} con datos
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Página de una categoría: navegación, destacados, gráfico y listado de series del catálogo. */
export function SourceCategory({
  sourceId,
  panel,
  code,
  searchParams,
}: {
  sourceId: SourceId;
  panel: PanelDef;
  code: string;
  searchParams: Promise<SP>;
}) {
  return (
    <>
      <PageHeader code={code} title={panel.label} description={panel.description}>
        <SearchBox sourceId={sourceId} action={`${base(sourceId)}/${panel.slug}`} placeholder={`Buscar en ${panel.label}`} />
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <CategoryNav sourceId={sourceId} active={panel.slug} />
        <div className="flex min-w-0 flex-col gap-4">
          {panel.note && (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{panel.note}</p>
          )}
          {panel.headline.length > 0 && (
            <Suspense fallback={<KpiRowSkeleton n={Math.min(4, panel.headline.length)} />}>
              <KpiRow ids={panel.headline} />
            </Suspense>
          )}
          {panel.headline.length > 0 && (
            <Suspense fallback={<Panel title="Serie destacada"><div className="h-80 animate-pulse bg-muted/30" /></Panel>}>
              <FeaturedChart ids={panel.headline} />
            </Suspense>
          )}
          {panel.headline.length > 0 && (
            <Suspense fallback={<Panel title="Mes a mes"><div className="h-64 animate-pulse bg-muted/30" /></Panel>}>
              <MonthlySummary ids={panel.headline} />
            </Suspense>
          )}
          <Panel title="Series de la categoría" code={sourceId} bodyClassName="p-0">
            <Suspense fallback={<div className="h-96 animate-pulse bg-muted/30" />}>
              <CategorySeries sourceId={sourceId} panel={panel.slug} searchParams={searchParams} />
            </Suspense>
          </Panel>
        </div>
      </div>
    </>
  );
}

function CategoryNav({ sourceId, active }: { sourceId: SourceId; active: string }) {
  return (
    <nav aria-label="Categorías" className="min-w-0">
      <div className="label-caps mb-2 hidden text-[10px] text-muted-foreground lg:block">Categorías</div>
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {panelsFor(sourceId).map((p) => (
          <li key={p.slug} className="shrink-0">
            <Link
              href={`${base(sourceId)}/${p.slug}`}
              aria-current={p.slug === active ? "page" : undefined}
              className={cn(
                "block rounded px-2 py-1.5 text-xs whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground",
                p.slug === active && "bg-secondary text-amber",
              )}
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function FeaturedChart({ ids }: { ids: string[] }) {
  const res = await safeLoad(async () => {
    const metas = (await getSeriesMetas(ids)).filter((m) => m.last_date);
    const meta = metas[0];
    if (!meta) return null;
    const nominal = isNominalPesos(meta.unit, meta.name);
    const [points, ipc] = await Promise.all([getPoints(meta.id), nominal ? getIpcMonthly() : Promise.resolve(undefined)]);
    return { meta, points, ipc };
  });
  if (!res.ok) return <DataUnavailable error={res.error} />;
  if (!res.data) return null;
  return (
    <Panel
      title={res.data.meta.name}
      code="GRAF"
      actions={
        <Link href={`/indicadores/${encodeURIComponent(res.data.meta.id)}`} className="text-[11px] text-muted-foreground hover:text-amber">
          Ficha completa →
        </Link>
      }
    >
      <IndicatorChart series={{ meta: res.data.meta, points: res.data.points }} ipc={res.data.ipc} />
    </Panel>
  );
}

/** Cuadro mes a mes de las series destacadas de la categoría (como el resumen del INDEC). */
async function MonthlySummary({ ids }: { ids: string[] }) {
  const res = await safeLoad(async () => {
    const metas = (await getSeriesMetas(ids)).filter((m) => m.last_date && ["D", "W", "M"].includes(m.frequency));
    return Promise.all(metas.map(async (meta) => ({ meta, points: await getPoints(meta.id) })));
  });
  if (!res.ok) return <DataUnavailable error={res.error} />;
  if (!res.data.length) return null;
  return (
    <Panel title="Mes a mes — últimos 24 meses" code="MES" bodyClassName="p-0">
      <MultiPeriodTable series={res.data} />
    </Panel>
  );
}

async function CategorySeries({ sourceId, panel, searchParams }: { sourceId: SourceId; panel: string; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return (
    <SeriesList
      sourceId={sourceId}
      panel={panel}
      q={one(sp.q)}
      page={Math.max(1, Number(one(sp.page)) || 1)}
      disc={one(sp.disc) === "1"}
      hrefBase={`${base(sourceId)}/${panel}`}
    />
  );
}

async function SeriesList({
  sourceId,
  panel,
  q,
  page,
  disc,
  hrefBase,
}: {
  sourceId: SourceId;
  panel?: string;
  q: string;
  page: number;
  disc: boolean;
  hrefBase: string;
}) {
  const res = await safeLoad(() =>
    searchCatalog({ sourceId, panel, q, includeDiscontinued: disc, limit: PAGE, offset: (page - 1) * PAGE }),
  );
  if (!res.ok) return <div className="p-3"><DataUnavailable error={res.error} /></div>;
  const { rows, total } = res.data;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number, d = disc) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (d) u.set("disc", "1");
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `${hrefBase}?${s}` : hrefBase;
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="num">{formatNumber(total, { decimals: 0 })} series{q ? ` para “${q}”` : ""}</span>
        <Link href={href(1, !disc)} className="hover:text-amber">
          {disc ? "Ocultar discontinuadas" : "Incluir discontinuadas"}
        </Link>
        <span className="ml-auto">Las series sin datos se descargan de la API oficial al abrirlas.</span>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No hay series que coincidan.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="label-caps border-b border-border text-left text-[10px] text-muted-foreground">
                <th className="px-3 py-2 font-medium">Serie</th>
                <th className="px-3 py-2 font-medium">Unidad</th>
                <th className="px-3 py-2 font-medium">Frec.</th>
                <th className="px-3 py-2 font-medium">Último dato (fuente)</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/60">
                  <td className="max-w-[420px] px-3 py-1.5">
                    <Link href={`/indicadores/${encodeURIComponent(r.id)}`} className="line-clamp-2 hover:text-amber">
                      {r.name}
                    </Link>
                    <div className="num truncate text-[10px] text-muted-foreground" title={r.subcategory ?? ""}>
                      {r.source_code ?? r.id}
                      {r.subcategory ? ` · ${r.subcategory}` : ""}
                    </div>
                  </td>
                  <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground" title={r.unit}>
                    {shortUnit(r.unit)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{FREQUENCY_LABEL[r.frequency]}</td>
                  <td className="num px-3 py-1.5 text-muted-foreground">{r.last_date ?? r.source_last_date ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {r.is_tracked ? (
                      <StatusBadge status={r.update_status} />
                    ) : r.update_status === "discontinued" ? (
                      <StatusBadge status="discontinued" />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Se descarga al abrir</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {page > 1 && <Link href={href(page - 1)} className="hover:text-amber">← Anterior</Link>}
          <span className="num">
            Página {page} de {pages}
          </span>
          {page < pages && <Link href={href(page + 1)} className="hover:text-amber">Siguiente →</Link>}
        </div>
      )}
    </div>
  );
}

function SearchBox({ sourceId, action, placeholder }: { sourceId: SourceId; action: string; placeholder?: string }) {
  return (
    <form action={action} role="search" className="flex w-full items-center gap-1 sm:w-auto">
      <label className="relative flex-1 sm:w-72">
        <span className="sr-only">Buscar series</span>
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          name="q"
          placeholder={placeholder ?? `Buscar series del ${sourceId} (ej. desempleo, plazo fijo)`}
          className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-7 text-xs"
        />
      </label>
      <button type="submit" className="h-8 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:border-amber/50 hover:text-foreground">
        Buscar
      </button>
    </form>
  );
}

async function KpiRow({ ids }: { ids: string[] }) {
  const res = await safeLoad(() => getIndicatorSnapshots({ ids, sparkPoints: 40 }));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const byId = new Map(res.data.map((r) => [r.id, r]));
  const tiles = ids.map((id) => byId.get(id)).filter((x) => x && x.last_date);
  if (!tiles.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((ind) => (
        <KpiTile key={ind!.id} ind={ind!} />
      ))}
    </div>
  );
}

function KpiRowSkeleton({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: Math.min(4, n) }, (_, i) => (
        <KpiTileSkeleton key={i} />
      ))}
    </div>
  );
}

async function SourceInfo({ sourceId }: { sourceId: SourceId }) {
  const res = await safeLoad(() => getSourceSummaries());
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const s = res.data.find((x) => x.id === sourceId);
  if (!s) return null;
  const rows: [string, React.ReactNode][] = [
    ["Institución", s.name],
    ["API", s.api_name],
    ["Base URL", <code key="u" className="num break-all text-[11px]">{s.base_url}</code>],
    ["Autenticación", "No requiere"],
    ["Límites", s.rate_limit_note],
    ["Series en catálogo", <span key="c" className="num">{formatNumber(s.catalog_count, { decimals: 0 })}</span>],
    ["Con datos descargados", <span key="t" className="num">{s.tracked_count}</span>],
    ["Observaciones", <span key="o" className="num">{formatNumber(s.observation_count, { decimals: 0 })}</span>],
    ["Última actualización", <span key="l" className="num">{formatDateTime(s.last_synced_at)}</span>],
  ];
  return (
    <Panel title="Fuente oficial" code="SRC" actions={<SourceBadge source={sourceId} />}>
      <dl className="flex flex-col gap-2.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="label-caps text-[10px] text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 text-foreground/90">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {s.docs_url && (
        <a href={s.docs_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-amber hover:underline">
          Documentación oficial ↗
        </a>
      )}
    </Panel>
  );
}
