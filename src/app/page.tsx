import Link from "next/link";
import { Suspense } from "react";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { StatusBadge } from "@/components/ui-kit/badges";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { KpiTile, KpiTileSkeleton } from "@/components/ui-kit/kpi-tile";
import { PageHeader, Panel } from "@/components/ui-kit/panel";
import { getIndicatorSnapshots, getObservations, getSourceSummaries } from "@/lib/data/queries";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata = { title: "Dashboard" };

const SECTIONS: { title: string; code: string; kpis: { id: string; label: string }[] }[] = [
  {
    title: "Precios",
    code: "PRC",
    kpis: [
      { id: "calc.ipc_var_mensual", label: "Inflación mensual" },
      { id: "calc.ipc_var_interanual", label: "Inflación interanual" },
      { id: "calc.ipc_var_acumulada", label: "Inflación acumulada en el año" },
      { id: "bcra.cer", label: "CER" },
      { id: "bcra.uva", label: "UVA" },
    ],
  },
  {
    title: "Actividad",
    code: "ACT",
    kpis: [
      { id: "indec.emae_desest", label: "EMAE desestacionalizado" },
      { id: "calc.emae_var_interanual", label: "EMAE — var. interanual" },
      { id: "indec.pib_real", label: "PIB real (precios de 2004)" },
      { id: "calc.pib_real_var_interanual", label: "PIB real — var. interanual" },
    ],
  },
  {
    title: "Sector externo y tipo de cambio",
    code: "EXT",
    kpis: [
      { id: "bcra.reservas", label: "Reservas internacionales" },
      { id: "bcra.tc_mayorista", label: "Tipo de cambio mayorista" },
      { id: "indec.exportaciones", label: "Exportaciones" },
      { id: "indec.importaciones", label: "Importaciones" },
    ],
  },
  {
    title: "Dinero",
    code: "MON",
    kpis: [
      { id: "bcra.base_monetaria", label: "Base monetaria" },
      { id: "bcra.m1", label: "M1" },
      { id: "bcra.m2", label: "M2" },
      { id: "bcra.m3", label: "M3" },
    ],
  },
  {
    title: "Tasas de interés",
    code: "TAS",
    kpis: [
      { id: "bcra.tamar", label: "Tasa TAMAR" },
      { id: "bcra.badlar", label: "Tasa BADLAR" },
      { id: "bcra.plazo_fijo_30d", label: "Plazo fijo 30 días" },
      { id: "bcra.adelantos", label: "Adelantos en cuenta corriente" },
    ],
  },
  {
    title: "Salarios",
    code: "SAL",
    kpis: [
      { id: "calc.salarios_reales", label: "Salario real (dic-2016=100)" },
      { id: "calc.salarios_reales_var_interanual", label: "Salario real — var. interanual" },
      { id: "calc.salarios_var_interanual", label: "Salario nominal — var. interanual" },
      { id: "indec.salarios", label: "Índice de salarios" },
    ],
  },
];
const KPI_IDS = SECTIONS.flatMap((s) => s.kpis.map((k) => k.id));

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        code="01 · OVW"
        title="Dashboard ejecutivo"
        description="Indicadores clave de la economía argentina con datos oficiales del INDEC y el BCRA. Cada tarjeta muestra el último valor, su variación, la fecha del dato, la fuente y la tendencia, y enlaza a su ficha."
      />
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {KPI_IDS.slice(0, 8).map((id) => (
              <KpiTileSkeleton key={id} />
            ))}
          </div>
        }
      >
        <KpiSections />
      </Suspense>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Suspense fallback={<ChartSkeleton title="Inflación mensual (IPC Nacional)" />}>
          <ChartBlock
            title="Inflación mensual (IPC Nacional)"
            code="CALC"
            series={[{ id: "calc.ipc_var_mensual", label: "Var. mensual IPC" }]}
            frequency="M"
            unit="%"
            kind="bar"
            years={4}
            defaultRange="3A"
            footnote="Calculada desde el índice IPC Nivel General (INDEC). Coincide con la variación publicada por INDEC."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Tipo de cambio y bandas" />}>
          <ChartBlock
            title="Tipo de cambio mayorista y bandas cambiarias"
            code="BCRA"
            series={[
              { id: "bcra.tc_mayorista", label: "Mayorista (A 3500)" },
              { id: "bcra.banda_superior", label: "Banda superior", dashed: true },
              { id: "bcra.banda_inferior", label: "Banda inferior", dashed: true },
            ]}
            frequency="D"
            unit="$/USD"
            years={3}
            defaultRange="1A"
            footnote="Pesos por dólar. Las bandas rigen desde el 14/04/2025."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Reservas internacionales" />}>
          <ChartBlock
            title="Reservas internacionales"
            code="BCRA"
            series={[{ id: "bcra.reservas", label: "Reservas" }]}
            frequency="D"
            unit="Millones de USD"
            years={12}
            defaultRange="5A"
            footnote="Millones de USD, saldo diario."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Actividad económica" />}>
          <ChartBlock
            title="Actividad: EMAE"
            code="INDEC"
            series={[
              { id: "indec.emae_desest", label: "Desestacionalizado" },
              { id: "indec.emae", label: "Serie original" },
            ]}
            frequency="M"
            unit="Índice 2004=100"
            years={12}
            defaultRange="5A"
            footnote="Índice 2004=100."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Tasas de interés" />}>
          <ChartBlock
            title="Tasas de interés de referencia"
            code="BCRA"
            series={[
              { id: "bcra.tamar", label: "TAMAR" },
              { id: "bcra.badlar", label: "BADLAR" },
              { id: "bcra.plazo_fijo_30d", label: "Plazo fijo 30 días" },
            ]}
            frequency="D"
            unit="% TNA"
            years={3}
            defaultRange="1A"
            footnote="Porcentaje nominal anual, bancos privados."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Salario real" />}>
          <ChartBlock
            title="Salario real (índice de salarios / IPC)"
            code="CALC"
            series={[{ id: "calc.salarios_reales", label: "Salario real" }]}
            frequency="M"
            unit="Índice dic-2016=100"
            years={10}
            defaultRange="MAX"
            footnote="Índice de salarios total (INDEC) deflactado por el IPC Nivel General Nacional. Base diciembre 2016 = 100."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Exportaciones e importaciones" />}>
          <ChartBlock
            title="Exportaciones e importaciones"
            code="INDEC"
            series={[
              { id: "indec.exportaciones", label: "Exportaciones" },
              { id: "indec.importaciones", label: "Importaciones" },
            ]}
            frequency="M"
            unit="Millones de USD"
            years={8}
            defaultRange="5A"
            footnote="Millones de USD, valores mensuales (INDEC, intercambio comercial argentino)."
          />
        </Suspense>
        <Suspense fallback={<ChartSkeleton title="Comercio exterior" />}>
          <ChartBlock
            title="Saldo comercial"
            code="INDEC"
            series={[{ id: "indec.saldo_comercial", label: "Saldo comercial" }]}
            frequency="M"
            unit="Millones de USD"
            kind="bar"
            years={6}
            defaultRange="3A"
            zeroLine
            footnote="Millones de USD. Exportaciones menos importaciones."
          />
        </Suspense>
      </div>

      <div className="mt-4">
        <Suspense fallback={<ChartSkeleton title="Estado de las fuentes" />}>
          <SourcesStatus />
        </Suspense>
      </div>
    </>
  );
}

async function KpiSections() {
  const res = await safeLoad(() => getIndicatorSnapshots({ ids: KPI_IDS, sparkPoints: 40 }));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const byId = new Map(res.data.map((r) => [r.id, r]));
  return (
    <div className="flex flex-col gap-5">
      {SECTIONS.map((sec) => (
        <section key={sec.code} aria-labelledby={`sec-${sec.code}`}>
          <h2 id={`sec-${sec.code}`} className="label-caps mb-2 flex items-center gap-2 text-muted-foreground">
            <span className="num text-[10px] text-amber">{sec.code}</span>
            {sec.title}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {sec.kpis.map((k) => {
              const ind = byId.get(k.id);
              return ind ? (
                <KpiTile key={k.id} ind={ind} label={k.label} />
              ) : (
                <div key={k.id} className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  {k.label}: serie no registrada. Ejecutá <code className="num">npm run catalog:seed</code>.
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

async function ChartBlock({
  title,
  code,
  series,
  frequency,
  unit,
  kind,
  years,
  defaultRange,
  zeroLine,
  footnote,
}: {
  title: string;
  code: string;
  series: { id: string; label: string; dashed?: boolean }[];
  frequency: "D" | "M" | "Q";
  unit: string;
  kind?: "line" | "bar";
  years: number;
  defaultRange: "1A" | "3A" | "5A" | "10A" | "MAX";
  zeroLine?: boolean;
  footnote?: string;
}) {
  const res = await safeLoad(() => Promise.all(series.map((s) => getObservations(s.id, { lastYears: years }))));
  return (
    <Panel
      title={title}
      code={code}
      actions={
        <Link href={`/indicadores/${encodeURIComponent(series[0].id)}`} className="text-[11px] text-muted-foreground hover:text-amber">
          Ver ficha →
        </Link>
      }
    >
      {!res.ok ? (
        <DataUnavailable error={res.error} />
      ) : (
        <TimeSeriesChart
          series={series.map((s, i) => ({ key: s.id.replace(/\./g, "_"), label: s.label, points: res.data[i], dashed: s.dashed }))}
          frequency={frequency}
          unit={unit}
          kind={kind}
          defaultRange={defaultRange}
          zeroLine={zeroLine}
          height={240}
        />
      )}
      {footnote && <p className="mt-2 text-[11px] text-muted-foreground">{footnote}</p>}
    </Panel>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <div className="h-[270px] animate-pulse rounded bg-muted/40" />
    </Panel>
  );
}

async function SourcesStatus() {
  const res = await safeLoad(() => getSourceSummaries());
  if (!res.ok) return <DataUnavailable error={res.error} />;
  return (
    <Panel title="Estado de las fuentes" code="SYS" actions={<Link href="/configuracion" className="text-[11px] text-muted-foreground hover:text-amber">Detalle →</Link>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {res.data.map((s) => (
          <div key={s.id} className="min-w-0 rounded border border-border/70 p-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="num text-sm font-semibold text-amber">{s.id}</span>
              <span className="truncate text-xs text-muted-foreground">{s.api_name}</span>
            </div>
            <dl className="num mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Catálogo</dt>
                <dd>{formatNumber(s.catalog_count, { decimals: 0 })}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sincronizadas</dt>
                <dd>{s.tracked_count}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Observaciones</dt>
                <dd>{formatNumber(s.observation_count, { decimals: 0 })}</dd>
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge status="ok" /> <span className="num">{s.ok_count}</span>
              <StatusBadge status="stale" /> <span className="num">{s.stale_count}</span>
              <StatusBadge status="error" /> <span className="num">{s.error_count}</span>
              <span className="ml-auto text-muted-foreground">Última sync: {formatDateTime(s.last_synced_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
