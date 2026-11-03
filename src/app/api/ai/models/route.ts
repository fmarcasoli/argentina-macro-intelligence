import { connection } from "next/server";
import { aiConfig } from "@/lib/ai/config";

/**
 * Modelos disponibles en el proveedor configurado en el servidor (GET {base}/models).
 * La clave se usa solo del lado del servidor; se devuelven únicamente los IDs.
 */
export async function GET() {
  await connection();
  const c = aiConfig();
  if (!c.enabled) return Response.json({ error: "MACRO AI está desactivado" }, { status: 503 });
  if (!c.server.configured) return Response.json({ error: "No hay un proveedor configurado en el servidor" }, { status: 503 });
  try {
    const r = await fetch(`${c.server.baseUrl!.replace(/\/$/, "")}/models`, {
      headers: process.env.AI_SERVER_API_KEY ? { Authorization: `Bearer ${process.env.AI_SERVER_API_KEY}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return Response.json({ error: `El proveedor respondió ${r.status}` }, { status: 502 });
    const j = (await r.json()) as { data?: { id: string; active?: boolean; context_window?: number }[] };
    const models = (j.data ?? []).filter((m) => m.active !== false).map((m) => ({ id: m.id, context: m.context_window ?? null })).sort((a, b) => a.id.localeCompare(b.id));
    return Response.json({ current: c.server.model, models });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
