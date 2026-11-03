import { connection } from "next/server";
import { aiConfig } from "@/lib/ai/config";

/** Estado de MACRO AI: si está habilitado y si hay un modelo configurado en el servidor (sin exponer claves ni URLs privadas). */
export async function GET() {
  await connection(); // se evalúa en cada pedido (la configuración puede cambiar sin recompilar)
  const c = aiConfig();
  return Response.json({ enabled: c.enabled, server: { configured: c.server.configured, model: c.server.model, label: c.server.label } });
}
