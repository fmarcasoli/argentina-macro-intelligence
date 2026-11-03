import type { NextRequest } from "next/server";
import { openAiCompatibleProvider, ProviderError, type LlmMessage } from "@/lib/ai/agent";
import { aiConfig, validateChatBody } from "@/lib/ai/config";
import { AI_TOOL_SPECS } from "@/lib/ai/registry";

/**
 * Modo "servidor" de MACRO AI: reenvía la conversación al endpoint compatible
 * con OpenAI configurado (Ollama local, túnel o proveedor externo). Las
 * herramientas se ejecutan en el navegador con las APIs de la app; acá solo
 * se consulta al modelo, con la lista de herramientas fijada en el servidor.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const c = aiConfig();
  if (!c.enabled) return Response.json({ error: "MACRO AI está desactivado en este servidor" }, { status: 503 });
  if (!c.server.configured) return Response.json({ error: "No hay un modelo configurado en el servidor (AI_SERVER_BASE_URL y AI_SERVER_MODEL)" }, { status: 503 });
  const v = validateChatBody(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const p = openAiCompatibleProvider({ baseUrl: c.server.baseUrl!, model: c.server.model!, apiKey: process.env.AI_SERVER_API_KEY, label: c.server.label, timeoutMs: 110_000 });
    const reply = await p.chat(v.messages as LlmMessage[], AI_TOOL_SPECS, req.signal);
    return Response.json(reply);
  } catch (e) {
    return Response.json({ error: e instanceof ProviderError ? e.message : "Error del modelo" }, { status: 502 });
  }
}
