/**
 * Aplica las migraciones SQL de supabase/migrations en orden.
 *
 *   npm run db:migrate
 *
 * Registra lo aplicado en la tabla schema_migrations (con hash) para no
 * repetirlas. Sirve tanto para el Postgres local como para Supabase.
 * (En Supabase también se puede usar `supabase db push`.)
 */
import "./env";
import { closeSql, getSql } from "../src/lib/db/client";
import { applyMigrations } from "../src/lib/db/migrate";

async function main() {
  const done = await applyMigrations(getSql(), undefined, (m) => console.log(`[migrate] ${m}`));
  console.log(done.length ? `[migrate] ${done.length} migración(es) aplicada(s).` : "[migrate] La base ya está al día.");
}

main()
  .catch((err) => {
    console.error("[migrate] Error:", err);
    process.exitCode = 1;
  })
  .finally(closeSql);
