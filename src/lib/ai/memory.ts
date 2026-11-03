import "server-only";
import { getSql } from "../db/client";
import { currentWorkspaceId, ensureWorkspaceId } from "../workspace";
import { aiConfig } from "./config";

/**
 * Acceso a la memoria de investigación: siempre filtrado por el espacio de
 * trabajo de la cookie (cada navegador ve solo lo suyo). Si MACRO AI está
 * desactivado, la memoria tampoco está disponible.
 */
export const sql = () => getSql();

export async function guard(create = false): Promise<{ ws: string | null } | Response> {
  if (!aiConfig().enabled) return Response.json({ error: "MACRO AI está desactivado" }, { status: 503 });
  try {
    return { ws: create ? await ensureWorkspaceId() : await currentWorkspaceId() };
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const fail = (e: unknown) => Response.json({ error: (e as Error).message }, { status: 500 });
