import { z } from "zod";
import { buildReport, REPORT_LABEL, type ReportKind } from "./reports";
import { runTool, TOOLS } from "./tools";
import type { DataClient, ToolResult } from "./types";

/**
 * Registro completo de herramientas de MACRO AI: las de datos y cálculo
 * (tools.ts) más la de informes (que a su vez usa las primeras).
 */

const KINDS = Object.keys(REPORT_LABEL) as [ReportKind, ...ReportKind[]];
const reportSchema = z.object({
  tipo: z.enum(KINDS),
  ids: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()) : v), z.array(z.string().regex(/^[\w.\-]{1,120}$/)).max(6)).optional(),
});

export const REPORT_TOOL = {
  name: "informe",
  description: `Genera un informe automático con gráficos, tablas e indicadores. Tipos: ${KINDS.map((k) => `${k} (${REPORT_LABEL[k].title})`).join("; ")}. El personalizado requiere ids.`,
  parameters: {
    type: "object",
    properties: { tipo: { type: "string", enum: KINDS, description: "Tipo de informe" }, ids: { type: "array", items: { type: "string" }, description: "Series (solo personalizado)" } },
    required: ["tipo"],
  },
};

export const AI_TOOL_SPECS = [
  ...TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
  { type: "function" as const, function: REPORT_TOOL },
];

export const AI_TOOL_NAMES = AI_TOOL_SPECS.map((t) => t.function.name);

export async function runAiTool(name: string, args: unknown, client: DataClient): Promise<ToolResult> {
  if (name !== "informe") return runTool(name, args, client);
  const p = reportSchema.safeParse(args ?? {});
  if (!p.success) return { ok: false, summary: `Parámetros inválidos para informe: ${p.error.issues.map((i) => i.message).join("; ")}`, blocks: [], sources: [], methodology: [], error: "invalid" };
  try {
    const r = await buildReport(p.data.tipo, client, { ids: p.data.ids });
    const text = r.sections.flatMap((s) => s.text);
    return {
      ok: true,
      summary: `${r.title}. ${r.coverage.join(" ")}\n${text.join("\n")}`,
      blocks: [
        { type: "notes", level: "info", items: r.coverage },
        ...r.sections.flatMap((s) => [...(s.text.length ? [{ type: "text" as const, text: `**${s.title}**\n\n${s.text.join("\n\n")}`, origin: "tool" as const }] : [{ type: "text" as const, text: `**${s.title}**`, origin: "tool" as const }]), ...s.blocks]),
        ...(r.warnings.length ? [{ type: "notes" as const, level: "warning" as const, items: r.warnings }] : []),
      ],
      sources: r.sources,
      methodology: r.methodology,
    };
  } catch (e) {
    return { ok: false, summary: `Error en informe: ${(e as Error).message}`, blocks: [], sources: [], methodology: [], error: (e as Error).message };
  }
}
