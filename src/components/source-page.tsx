import Link from "next/link";
import { Suspense } from "react";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { IndicatorTable } from "@/components/ui-kit/indicator-table";
import { KpiTile, KpiTileSkeleton } from "@/components/ui-kit/kpi-tile";
import { PageHeader, Panel } from "@/components/ui-kit/panel";
import type { SourceId } from "@/lib/connectors/types";
import { getIndicatorSnapshots, getSourceSummaries } from "@/lib/data/queries";
import { formatDateTime, formatNumber } from "@/lib/format";

export function SourcePage({
  sourceId,
  code,
  title,
  description,
  headline,
}: {
  sourceId: SourceId;
  code: string;
  title: string;
  description: string;
  headline: string[];
}) {
  return (
    <>
      <PageHeader code={code} title={title} description={description}>
        <Link
          href={`/catalogo?source=${sourceId}`}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-amber/50 hover:text-foreground"
        >
          Catálogo completo de {sourceId} →
        </Link>
      </PageHeader>

      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {headline.map((id) => (
              <KpiTileSkeleton key={id} />
            ))}
          </div>
        }
      >
        <Headline ids={headline} />
      </Suspense>

      <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_340px]">
        <Panel title="Series sincronizadas" code={sourceId} bodyClassName="p-0">
          <Suspense fallback={<div className="h-96 animate-pulse bg-muted/30" />}>
            <TrackedTable sourceId={sourceId} />
          </Suspense>
        </Panel>
        <Suspense fallback={<Panel title="Fuente"><div className="h-60 animate-pulse bg-muted/30" /></Panel>}>
          <SourceInfo sourceId={sourceId} />
        </Suspense>
      </div>
    </>
  );
}

async function Headline({ ids }: { ids: string[] }) {
  const res = await safeLoad(() => getIndicatorSnapshots({ ids, sparkPoints: 40 }));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const byId = new Map(res.data.map((r) => [r.id, r]));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ids.map((id) => {
        const ind = byId.get(id);
        return ind ? <KpiTile key={id} ind={ind} /> : null;
      })}
    </div>
  );
}

async function TrackedTable({ sourceId }: { sourceId: SourceId }) {
  const res = await safeLoad(() => getIndicatorSnapshots({ sourceId, tracked: true, sparkPoints: 36 }));
  if (!res.ok) return <div className="p-3"><DataUnavailable error={res.error} /></div>;
  if (res.data.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No hay series registradas. Ejecutá <code className="num">npm run catalog:seed</code>.
      </p>
    );
  }
  return <IndicatorTable rows={res.data} />;
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
    ["Notas", s.notes],
    ["Series en catálogo", <span key="c" className="num">{formatNumber(s.catalog_count, { decimals: 0 })}</span>],
    ["Sincronizadas", <span key="t" className="num">{s.tracked_count}</span>],
    ["Observaciones", <span key="o" className="num">{formatNumber(s.observation_count, { decimals: 0 })}</span>],
    ["Última sincronización", <span key="l" className="num">{formatDateTime(s.last_synced_at)}</span>],
  ];
  return (
    <Panel title="Fuente oficial" code="SRC">
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
