import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { IndicatorChart } from "@/components/charts/indicator-chart";
import { FavoriteButton } from "@/components/workspace/favorite-button";
import { KindBadge, SourceBadge, StatusBadge } from "@/components/ui-kit/badges";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { PageHeader, Panel } from "@/components/ui-kit/panel";
import { SyncRunsTable } from "@/components/ui-kit/sync-runs-table";
import { findPanel } from "@/lib/catalog/panels";
import { isNominalPesos } from "@/lib/analysis/units";
import { ensureIndicator, getIpcMonthly, getPoints, getSeriesMetas } from "@/lib/data/series";
import {
  getIndicator,
  getRecentObservations,
  getRevisions,
  getSyncErrors,
  getSyncRuns,
  type Indicator,
} from "@/lib/data/queries";
import {
  FREQUENCY_LABEL,
  formatDateTime,
  formatNumber,
  formatValue,
  periodLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/indicadores/[id]">) {
  const id = decodeURIComponent((await params).id);
  const res = await safeLoad(() => getIndicator(id));
  return { title: res.ok && res.data ? res.data.name : id };
}

export default function IndicatorPage({ params }: PageProps<"/indicadores/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
      <IndicatorDetail params={params} />
    </Suspense>
  );
}

async function IndicatorDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const first = await safeLoad(() => getIndicator(id));
  if (!first.ok) return <DataUnavailable error={first.error} />;
  if (!first.data) notFound();

  // Serie del catálogo sin datos: se descarga ahora desde la API oficial.
  let onDemand: { status: string; error?: string } | null = null;
  let ind = first.data;
  if (ind.observation_count === 0 && ind.value_kind !== "calculated") {
    const r = await safeLoad(() => ensureIndicator(id));
    onDemand = r.ok ? { status: r.data.status, error: r.data.status === "failed" ? r.data.error : undefined } : { status: "failed", error: r.error instanceof Error ? r.error.message : String(r.error) };
    const again = await safeLoad(() => getIndicator(id));
    if (again.ok && again.data) ind = again.data;
  }
  const panel = ind.panel ? findPanel(ind.source_id, ind.panel) : undefined;

  return (
    <>
      <PageHeader
        code={`${ind.source_id} · ${ind.source_code ?? "CALC"}`}
        title={ind.name}
        description={ind.description && ind.description !== ind.name ? ind.description : undefined}
      >
        <SourceBadge source={ind.source_id} />
        <KindBadge kind={ind.value_kind} />
        <StatusBadge status={ind.update_status} />
        <FavoriteButton indicatorId={ind.id} />
        <a
          href={`/api/indicators/${encodeURIComponent(ind.id)}/observations?format=csv`}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          CSV con trazabilidad
        </a>
      </PageHeader>

      {panel && (
        <nav className="-mt-2 mb-4 text-[11px] text-muted-foreground" aria-label="Ubicación">
          <Link href={ind.source_id === "INDEC" ? "/indec" : "/bcra"} className="hover:text-amber">
            {ind.source_id === "INDEC" ? "Panel INDEC" : "Panel Banco Central"}
          </Link>{" "}
          /{" "}
          <Link href={`/${ind.source_id === "INDEC" ? "indec" : "bcra"}/${panel.slug}`} className="hover:text-amber">
            {panel.label}
          </Link>
        </nav>
      )}
      {onDemand?.status === "synced" && (
        <div className="mb-4 rounded-md border border-positive/30 bg-positive/5 p-3 text-xs text-foreground/90">
          Esta serie se descargó recién desde la API oficial del {ind.source_id} ({formatNumber(ind.observation_count, { decimals: 0 })}{" "}
          observaciones) y desde ahora se actualiza todos los días.
        </div>
      )}
      {onDemand?.status === "failed" && (
        <div className="mb-4 rounded-md border border-negative/30 bg-negative/5 p-3 text-xs text-foreground/90">
          No se pudo descargar la serie desde la fuente: {onDemand.error}. El error quedó registrado; no se muestran datos estimados.
        </div>
      )}
      {ind.notes && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-foreground/90">{ind.notes}</div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="Serie histórica" code="HIST">
          <LatestValue ind={ind} />
          <Suspense fallback={<div className="h-[320px] animate-pulse rounded bg-muted/30" />}>
            <HistoryChart ind={ind} />
          </Suspense>
        </Panel>
        <MetadataPanel ind={ind} panel={panel} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="Últimas observaciones" code="OBS" bodyClassName="p-0">
          <Suspense fallback={<div className="h-64 animate-pulse bg-muted/30" />}>
            <ObservationsTable ind={ind} />
          </Suspense>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Metodología" code="MET">
            <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
              {ind.methodology ?? "La fuente no publica una ficha metodológica para esta serie."}
            </p>
            {ind.methodology_url && (
              <a href={ind.methodology_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-amber hover:underline">
                Ficha en la API ↗
              </a>
            )}
          </Panel>
          <Suspense fallback={null}>
            <RevisionsPanel id={ind.id} />
          </Suspense>
        </div>
      </div>

      <div className="mt-4">
        <Suspense fallback={null}>
          <SyncHistory id={ind.id} />
        </Suspense>
      </div>
    </>
  );
}

function LatestValue({ ind }: { ind: Indicator }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-1">
      <div>
        <div className="label-caps text-[10px] text-muted-foreground">Último dato</div>
        <div className="num text-3xl font-medium">{formatValue(ind.last_value, ind.unit)}</div>
      </div>
      <div className="num pb-1 text-xs text-muted-foreground">
        {periodLabel(ind.last_date, ind.frequency)} · {ind.unit}
      </div>
    </div>
  );
}

async function HistoryChart({ ind }: { ind: Indicator }) {
  const nominal = isNominalPesos(ind.unit, ind.name);
  const res = await safeLoad(() =>
    Promise.all([getSeriesMetas([ind.id]), getPoints(ind.id), nominal ? getIpcMonthly() : Promise.resolve(undefined)]),
  );
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const [[meta], points, ipc] = res.data;
  if (!meta) return null;
  return <IndicatorChart series={{ meta, points }} ipc={ipc} />;
}

function MetadataPanel({ ind, panel }: { ind: Indicator; panel?: { label: string } }) {
  const rows: [string, React.ReactNode][] = [
    ["ID interno", <code key="id" className="num">{ind.id}</code>],
    ["Institución de origen", ind.source_id],
    ["Código de origen", ind.source_code ? <code key="sc" className="num">{ind.source_code}</code> : "— (serie calculada)"],
    ["Categoría (fuente)", ind.category],
    ["Subcategoría / dataset", ind.subcategory],
    ["Panel", panel?.label],
    ["Unidad", ind.unit],
    ["Frecuencia", FREQUENCY_LABEL[ind.frequency]],
    ["Moneda", ind.currency],
    ["Tipo de dato", ind.value_kind === "normalized" ? `Normalizado (×${ind.scale})` : ind.value_kind],
    ["Fecha inicial", <span key="s" className="num">{ind.start_date ?? "—"}</span>],
    ["Fecha del último dato", <span key="l" className="num">{ind.last_date ?? "—"}</span>],
    ["Rango según la fuente", <span key="r" className="num">{ind.source_start_date ?? "?"} → {ind.source_last_date ?? "?"}</span>],
    ["Observaciones", <span key="n" className="num">{formatNumber(ind.observation_count, { decimals: 0 })}</span>],
    ["Estado", <StatusBadge key="st" status={ind.update_status} />],
    ["Última actualización", <span key="ls" className="num">{formatDateTime(ind.last_synced_at)}</span>],
    ["Descarga", ind.tracked_on_demand_at ? "A pedido (al consultarla) y luego diaria" : ind.is_tracked ? "Serie núcleo, actualización diaria" : "Sin sincronizar"],
    ["Último error", ind.last_error],
    [
      "Endpoint",
      ind.endpoint ? (
        <a key="e" href={ind.endpoint} target="_blank" rel="noreferrer" className="num break-all text-[11px] text-amber hover:underline">
          {ind.endpoint}
        </a>
      ) : (
        "—"
      ),
    ],
  ];
  if (ind.derivation) {
    rows.push(["Definición de cálculo", <code key="d" className="num text-[11px] break-all">{JSON.stringify(ind.derivation)}</code>]);
  }
  return (
    <Panel title="Ficha del indicador" code="META">
      <dl className="grid grid-cols-1 gap-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[130px_1fr] gap-2 border-b border-border/50 pb-1.5 last:border-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

async function ObservationsTable({ ind }: { ind: Indicator }) {
  const res = await safeLoad(() => getRecentObservations(ind.id, 30));
  if (!res.ok) return <div className="p-3"><DataUnavailable error={res.error} /></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-xs">
        <thead>
          <tr className="label-caps border-b border-border text-left text-[10px] text-muted-foreground">
            <th className="px-3 py-2 font-medium">Período de referencia</th>
            <th className="px-3 py-2 font-medium">Fecha en la fuente</th>
            <th className="px-3 py-2 text-right font-medium">Valor</th>
            <th className="px-3 py-2 text-right font-medium">Valor crudo</th>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Publicación</th>
            <th className="px-3 py-2 text-right font-medium">Rev.</th>
          </tr>
        </thead>
        <tbody>
          {res.data.map((o) => (
            <tr key={o.ref_date} className={cn("border-b border-border/50", o.is_scheduled && "text-muted-foreground")}>
              <td className="num px-3 py-1.5">
                {periodLabel(o.ref_date, ind.frequency)}
                {o.is_scheduled && (
                  <span className="ml-2 rounded-sm border border-border px-1 text-[9px]" title="Valor publicado por adelantado por la fuente">
                    PROGRAMADO
                  </span>
                )}
              </td>
              <td className="num px-3 py-1.5 text-muted-foreground">{o.source_ref_date ?? "—"}</td>
              <td className="num px-3 py-1.5 text-right">{o.value === null ? <span className="text-muted-foreground">s/d</span> : formatNumber(o.value)}</td>
              <td className="num max-w-36 truncate px-3 py-1.5 text-right text-muted-foreground" title={o.raw_value ?? ""}>
                {o.raw_value ?? "—"}
              </td>
              <td className="px-3 py-1.5"><KindBadge kind={o.value_kind} /></td>
              <td className="num px-3 py-1.5 text-muted-foreground" title={o.publication_origin === "first_seen" ? "Fecha en que la plataforma vio el dato por primera vez (la fuente no informa fecha de publicación)" : "Informada por la fuente"}>
                {o.publication_date ? `${o.publication_date}${o.publication_origin === "first_seen" ? "*" : ""}` : "—"}
              </td>
              <td className="num px-3 py-1.5 text-right">{o.revision_count || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        Período de referencia = inicio del período al que corresponde el dato (no la fecha de publicación). “s/d”: dato
        faltante en la fuente (nunca se reemplaza por 0). Publicación “—”: dato histórico de la carga inicial, sin fecha de
        publicación conocida; “*”: primera vez que la plataforma vio el dato.
      </p>
    </div>
  );
}

async function RevisionsPanel({ id }: { id: string }) {
  const res = await safeLoad(() => getRevisions(id));
  if (!res.ok) return null;
  return (
    <Panel title="Revisiones de la fuente" code="REV">
      {res.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin revisiones registradas. Si la fuente modifica un valor ya publicado, el valor anterior se conserva acá.
        </p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {res.data.map((r, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="num py-1">{r.ref_date}</td>
                <td className="num py-1 text-right text-muted-foreground">{formatNumber(r.old_value)}</td>
                <td className="py-1 text-center text-muted-foreground">→</td>
                <td className="num py-1">{formatNumber(r.new_value)}</td>
                <td className="num py-1 text-right text-muted-foreground">{formatDateTime(r.revised_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

async function SyncHistory({ id }: { id: string }) {
  const res = await safeLoad(() => Promise.all([getSyncRuns({ indicatorId: id, limit: 10 }), getSyncErrors({ indicatorId: id, limit: 10 })]));
  if (!res.ok) return null;
  const [runs, errors] = res.data;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Historial de sincronización" code="SYNC" bodyClassName="p-0">
        <SyncRunsTable runs={runs} />
      </Panel>
      <Panel title="Errores" code="ERR">
        {errors.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin errores registrados.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {errors.map((e) => (
              <li key={e.id} className="border-b border-border/50 pb-2">
                <span className="num text-muted-foreground">{formatDateTime(e.occurred_at)}</span>{" "}
                <span className="num text-negative uppercase">{e.stage}</span> {e.message}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
