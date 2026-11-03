import { Suspense } from "react";
import { MacroAi } from "@/components/ai/macro-ai";
import { PageHeader } from "@/components/ui-kit/panel";
import { aiConfig } from "@/lib/ai/config";
import { connection } from "next/server";

export const metadata = { title: "MACRO AI" };

export default function MacroAiPage({ searchParams }: PageProps<"/macro-ai">) {
  return (
    <>
      <PageHeader
        code="09 · AI"
        title="MACRO AI"
        description="Asistente de investigación macroeconómica: busca series oficiales del INDEC y el BCRA, calcula, grafica, ejecuta modelos y cita las fuentes. Funciona con un modelo local gratuito (Ollama) y, sin modelo, responde con reglas y cálculos. Ninguna cifra sale del modelo: todas provienen de los datos."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-muted/30" />}>
        <AiContent searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>} />
      </Suspense>
    </>
  );
}

async function AiContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const c = aiConfig();
  if (!c.enabled) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <p className="font-medium">MACRO AI está desactivado en esta instalación.</p>
        <p className="mt-1 text-muted-foreground">El resto de la plataforma funciona normalmente (paneles, análisis, econometría, simulador e informes). Para activarlo, quitá <code className="num">MACRO_AI_ENABLED=false</code> de las variables de entorno.</p>
      </div>
    );
  }
  const q = (await searchParams).q;
  return <MacroAi server={{ configured: c.server.configured, model: c.server.model, label: c.server.label }} initialQuestion={typeof q === "string" ? q.slice(0, 500) : undefined} />;
}
