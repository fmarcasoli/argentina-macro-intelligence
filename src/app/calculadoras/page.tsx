import { Suspense } from "react";
import { Calculators } from "@/components/calculators/calculators";
import { DataUnavailable, safeLoad } from "@/components/ui-kit/data-state";
import { PageHeader } from "@/components/ui-kit/panel";
import { getSeriesBundle, IPC_ID } from "@/lib/data/series";

export const metadata = { title: "Calculadoras económicas" };

const FX = ["bcra.tc_mayorista", "bcra.tc_minorista"];
const WAGES = ["indec.salarios", "indec.salarios_registrado", "indec.salarios_privado_reg", "indec.salarios_publico"];
const AGGREGATES = ["bcra.base_monetaria", "bcra.m1", "bcra.m2", "bcra.m3"];
const RATES = ["bcra.plazo_fijo_30d", "bcra.badlar", "bcra.tamar"];

export default function CalculatorsPage({ searchParams }: PageProps<"/calculadoras">) {
  return (
    <>
      <PageHeader
        code="08 · CAL"
        title="Calculadoras económicas"
        description="Inflación, tasas reales (Fisher), devaluación, salarios reales y agregados monetarios reales, calculados con los índices oficiales almacenados en la base. Si falta un dato, la calculadora lo indica: nunca se estima."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
        <CalculatorsData searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>} />
      </Suspense>
    </>
  );
}

async function CalculatorsData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = (await searchParams).c;
  const res = await safeLoad(() => getSeriesBundle([IPC_ID, ...FX, ...WAGES, ...AGGREGATES, ...RATES]));
  if (!res.ok) return <DataUnavailable error={res.error} />;
  const by = new Map(res.data.series.map((s) => [s.meta.id, s]));
  const pick = (ids: string[]) => ids.map((id) => by.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s && s.points.length));
  const ipc = by.get(IPC_ID);
  if (!ipc || ipc.points.length < 13) {
    return <p className="text-sm text-muted-foreground">No hay datos de IPC en la base. Ejecutá la sincronización (npm run setup).</p>;
  }
  return (
    <Calculators
      initialTab={typeof tab === "string" ? tab : undefined}
      data={{ ipc, fx: pick(FX), wages: pick(WAGES), aggregates: pick(AGGREGATES), rates: pick(RATES).map((s) => ({ ...s, points: s.points.slice(-10) })) }}
    />
  );
}
