import { Construction } from "lucide-react";
import type { NavSection } from "@/lib/nav";
import { NAV_SECTIONS } from "@/lib/nav";
import { PageHeader, Panel } from "./panel";

export function UnderConstruction({ section }: { section: NavSection }) {
  const idx = NAV_SECTIONS.indexOf(section) + 1;
  return (
    <>
      <PageHeader code={`${String(idx).padStart(2, "0")} · ${section.short}`} title={section.label} description={section.description}>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
          <Construction className="size-3.5" aria-hidden />
          En construcción · fase posterior
        </span>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Estado del módulo" code="WIP">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full border border-dashed border-warning/50">
              <Construction className="size-5 text-warning" aria-hidden />
            </div>
            <div className="text-sm font-medium">Esta sección todavía no está desarrollada</div>
            <p className="max-w-md text-sm text-muted-foreground">
              La Fase 1 construye la infraestructura de datos (fuentes, catálogo, ingesta y calidad). Este módulo se
              implementará sobre esa base en una fase posterior.
            </p>
          </div>
        </Panel>
        {section.planned && (
          <Panel title="Alcance previsto" code="PLAN">
            <ul className="flex flex-col gap-2 text-sm">
              {section.planned.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-amber">›</span>
                  <span className="text-muted-foreground">{p}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
