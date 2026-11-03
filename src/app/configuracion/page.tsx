import Link from "next/link";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { PageHeader, Panel } from "@/components/ui-kit/panel";
import { SyncRunsTable } from "@/components/ui-kit/sync-runs-table";
import { getDatabaseHealth, getSourceSummaries, getSyncErrors, getSyncRuns } from "@/lib/data/queries";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata = { title: "Configuración" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        code="12 · CFG"
        title="Configuración"
        description="Estado de la base de datos, fuentes oficiales, sincronizaciones y errores. Preferencias de visualización."
      >
        <Link
          href="/catalogo"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-amber/50 hover:text-foreground"
        >
          Catálogo de indicadores →
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Suspense fallback={<Panel title="Base de datos"><div className="h-40 animate-pulse bg-muted/30" /></Panel>}>
          <DbPanel />
        </Suspense>
        <Suspense fallback={<Panel title="Fuentes"><div className="h-40 animate-pulse bg-muted/30" /></Panel>}>
          <SourcesPanel />
        </Suspense>
        <Panel title="Preferencias" code="UI">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tema claro / oscuro</span>
            <ThemeToggle />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Las preferencias por usuario (tabla <code className="num">user_settings</code>) se habilitarán junto con la
            autenticación de Supabase.
          </p>
          <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            <div className="label-caps mb-1 text-[10px]">Actualización automática</div>
            Vercel Cron llama a <code className="num">/api/sync</code> una vez por día por fuente (modo incremental). Para
            forzarla localmente: <code className="num">npm run sync</code>.
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel title="Últimas sincronizaciones" code="SYNC" bodyClassName="p-0">
          <Suspense fallback={<div className="h-64 animate-pulse bg-muted/30" />}>
            <RunsPanel />
          </Suspense>
        </Panel>
        <Panel title="Últimos errores" code="ERR">
          <Suspense fallback={<div className="h-64 animate-pulse bg-muted/30" />}>
            <ErrorsPanel />
          </Suspense>
        </Panel>
      </div>
    </>
  );
}

async function DbPanel() {
  const res = await safeLoad(() => getDatabaseHealth());
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const h = res.data;
  const rows: [string, string][] = [
    ["Indicadores en catálogo", formatNumber(h.indicators, { decimals: 0 })],
    ["Sincronizados", formatNumber(h.tracked, { decimals: 0 })],
    ["Observaciones", formatNumber(h.observations, { decimals: 0 })],
    ["Revisiones registradas", formatNumber(h.revisions, { decimals: 0 })],
    ["Ejecuciones de sync", formatNumber(h.runs, { decimals: 0 })],
    ["Errores registrados", formatNumber(h.errors, { decimals: 0 })],
  ];
  return (
    <Panel title="Base de datos" code="DB">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="num text-base">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="num mt-3 truncate text-[10px] text-muted-foreground" title={h.version}>{h.version}</p>
    </Panel>
  );
}

async function SourcesPanel() {
  const res = await safeLoad(() => getSourceSummaries());
  if (!res.ok) return <DataUnavailable error={res.error} />;
  return (
    <Panel title="Fuentes oficiales" code="SRC">
      <ul className="flex flex-col gap-3 text-xs">
        {res.data.map((s) => (
          <li key={s.id} className="border-b border-border/50 pb-2 last:border-0">
            <div className="flex items-baseline gap-2">
              <span className="num font-semibold text-amber">{s.id}</span>
              <span className="text-muted-foreground">{s.api_name}</span>
            </div>
            <div className="num mt-1 text-muted-foreground">
              {s.tracked_count} sincronizadas · {s.ok_count} al día · {s.stale_count} desactualizadas · {s.error_count} con error
            </div>
            <div className="num text-muted-foreground">Última: {formatDateTime(s.last_synced_at)}</div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function RunsPanel() {
  const res = await safeLoad(() => getSyncRuns({ limit: 40 }));
  if (!res.ok) return <div className="p-3"><DataUnavailable error={res.error} /></div>;
  return <SyncRunsTable runs={res.data} showIndicator />;
}

async function ErrorsPanel() {
  const res = await safeLoad(() => getSyncErrors({ limit: 30 }));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  if (res.data.length === 0) return <p className="text-xs text-muted-foreground">Sin errores registrados.</p>;
  return (
    <ul className="flex flex-col gap-2 text-xs">
      {res.data.map((e) => (
        <li key={e.id} className="border-b border-border/50 pb-2">
          <div className="flex gap-2">
            <span className="num text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
            <span className="num text-negative uppercase">{e.stage}</span>
            {e.http_status && <span className="num text-muted-foreground">HTTP {e.http_status}</span>}
          </div>
          <div className="mt-0.5 break-words">
            {e.indicator_id && (
              <Link href={`/indicadores/${encodeURIComponent(e.indicator_id)}`} className="num mr-1 text-amber hover:underline">
                {e.indicator_id}
              </Link>
            )}
            {e.message}
          </div>
        </li>
      ))}
    </ul>
  );
}
