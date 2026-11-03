import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSql } from "./db/client";

/**
 * Espacio de trabajo sin login: una cookie httpOnly con un token aleatorio
 * identifica al navegador. En la base solo se guarda el hash SHA-256 del token.
 * Los análisis y favoritos quedan en la base de datos (no en el navegador),
 * asociados a ese espacio. Cuando se implemente Supabase Auth, se podrán
 * migrar al usuario (saved_analyses.user_id).
 */
export const WS_COOKIE = "ami_ws";
const MAX_AGE = 60 * 60 * 24 * 400; // ~13 meses (máximo que aceptan los navegadores)

export { LIMITS } from "./workspace-limits";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Devuelve el ID del espacio de trabajo de la cookie, o null si no hay. */
export async function currentWorkspaceId(): Promise<string | null> {
  const token = (await cookies()).get(WS_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    update workspaces set last_seen_at = now() where token_hash = ${hash(token)} returning id`;
  return rows[0]?.id ?? null;
}

/** Devuelve el espacio de trabajo actual o crea uno nuevo (solo en Route Handlers). */
export async function ensureWorkspaceId(): Promise<string> {
  const existing = await currentWorkspaceId();
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  const sql = getSql();
  const [row] = await sql<{ id: string }[]>`insert into workspaces (token_hash) values (${hash(token)}) returning id`;
  (await cookies()).set(WS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return row.id;
}

export interface SavedAnalysis {
  id: string;
  title: string;
  kind: string;
  definition: Record<string, unknown>;
  indicator_ids: string[];
  created_at: Date;
  updated_at: Date;
}
