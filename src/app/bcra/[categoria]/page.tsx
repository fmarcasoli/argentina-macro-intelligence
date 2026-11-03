import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SourceCategory } from "@/components/source-panels";
import { findPanel, BCRA_PANELS } from "@/lib/catalog/panels";

export function generateStaticParams() {
  return BCRA_PANELS.map((p) => ({ categoria: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/bcra/[categoria]">) {
  const p = findPanel("BCRA", (await params).categoria);
  return { title: p ? `BCRA · ${p.label}` : "BCRA" };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function BcraCategoryPage({ params, searchParams }: PageProps<"/bcra/[categoria]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
      <Category params={params} searchParams={searchParams as SP} />
    </Suspense>
  );
}

async function Category({ params, searchParams }: { params: Promise<{ categoria: string }>; searchParams: SP }) {
  const panel = findPanel("BCRA", (await params).categoria);
  if (!panel) notFound();
  return <SourceCategory sourceId="BCRA" panel={panel} code={`03 · BCRA · ${panel.slug.toUpperCase()}`} searchParams={searchParams} />;
}
