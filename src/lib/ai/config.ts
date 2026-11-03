/**
 * Configuración de MACRO AI del lado del servidor (variables de entorno).
 *
 *   MACRO_AI_ENABLED=false     desactiva MACRO AI (el resto de la app sigue igual)
 *   AI_SERVER_BASE_URL         endpoint compatible con OpenAI para el modo "servidor"
 *                              (p. ej. http://localhost:11434/v1 con Ollama en la misma
 *                              máquina, un túnel a tu Ollama, o un proveedor externo)
 *   AI_SERVER_MODEL            modelo (p. ej. qwen2.5:7b)
 *   AI_SERVER_API_KEY          clave del proveedor externo (opcional; nunca llega al navegador)
 *   AI_SERVER_LABEL            nombre a mostrar (opcional)
 */
export interface AiServerConfig {
  enabled: boolean;
  server: { configured: boolean; baseUrl: string | null; model: string | null; label: string; hasKey: boolean };
}

export function aiConfig(env: Record<string, string | undefined> = process.env): AiServerConfig {
  const enabled = (env.MACRO_AI_ENABLED ?? "true").toLowerCase() !== "false";
  const baseUrl = env.AI_SERVER_BASE_URL?.trim() || null;
  const model = env.AI_SERVER_MODEL?.trim() || null;
  return {
    enabled,
    server: {
      // Un proveedor externo necesita su clave; un Ollama local o por túnel, no.
      configured: Boolean(baseUrl && model && (env.AI_SERVER_API_KEY || /localhost|127\.0\.0\.1/.test(baseUrl))),
      baseUrl,
      model,
      label:
        env.AI_SERVER_LABEL?.trim() ||
        (baseUrl && /localhost|127\.0\.0\.1/.test(baseUrl) ? "Ollama (servidor)" : baseUrl && /groq\.com/.test(baseUrl) ? "Groq" : baseUrl && /googleapis\.com/.test(baseUrl) ? "Google Gemini" : "Proveedor externo"),
      hasKey: Boolean(env.AI_SERVER_API_KEY),
    },
  };
}

/** Validación del cuerpo de /api/ai/chat. */
export function validateChatBody(body: unknown): { ok: true; messages: { role: string; content: string; tool_calls?: unknown; tool_call_id?: string }[] } | { ok: false; error: string } {
  const msgs = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(msgs) || !msgs.length) return { ok: false, error: "Falta messages" };
  if (msgs.length > 80) return { ok: false, error: "Demasiados mensajes" };
  if (JSON.stringify(msgs).length > 300_000) return { ok: false, error: "Conversación demasiado larga" };
  for (const m of msgs) {
    const r = (m as { role?: unknown }).role;
    if (!["system", "user", "assistant", "tool"].includes(r as string)) return { ok: false, error: "Rol de mensaje inválido" };
    if (typeof (m as { content?: unknown }).content !== "string") return { ok: false, error: "Contenido de mensaje inválido" };
  }
  return { ok: true, messages: msgs as { role: string; content: string }[] };
}
