import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";

type Sql = postgres.Sql<Record<string, never>>;

/**
 * Aplica en orden las migraciones SQL de supabase/migrations que todavía no
 * figuran en schema_migrations. Devuelve los nombres aplicados.
 */
export async function applyMigrations(
  sql: Sql,
  dir = path.resolve(process.cwd(), "supabase/migrations"),
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      hash text not null,
      applied_at timestamptz not null default now()
    )`;
  const applied = new Map(
    (await sql<{ name: string; hash: string }[]>`select name, hash from schema_migrations`).map((r) => [r.name, r.hash]),
  );

  const done: string[] = [];
  for (const file of files) {
    const content = await readFile(path.join(dir, file), "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    const prev = applied.get(file);
    if (prev) {
      if (prev !== hash) log(`⚠ ${file} cambió después de aplicada (no se re-ejecuta; crear una migración nueva).`);
      continue;
    }
    log(`aplicando ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations (name, hash) values (${file}, ${hash})`;
    });
    done.push(file);
  }
  return done;
}
