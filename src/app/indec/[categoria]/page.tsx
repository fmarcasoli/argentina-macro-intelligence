import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SourceCategory } from "@/components/source-panels";
import { findPanel, INDEC_PANELS } from "@/lib/catalog/panels";

export function generateStaticParams() {
  return INDEC_PANELS.map((p) => ({ categoria: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/indec/[categoria]">) {
  const p = findPanel("INDEC", (await params).categoria);
  return { title: p ? `INDEC · ${p.label}` : "INDEC" };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function IndecCategoryPage({ params, searchParams }: PageProps<"/indec/[categoria]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
      <Category params={params} searchParams={searchParams as SP} />
    </Suspense>
  );
}

async function Category({ params, searchParams }: { params: Promise<{ categoria: string }>; searchParams: SP }) {
  const panel = findPanel("INDEC", (await params).categoria);
  if (!panel) notFound();
  return <SourceCategory sourceId="INDEC" panel={panel} code={`02 · IND · ${panel.slug.toUpperCase()}`} searchParams={searchParams} />;
}
