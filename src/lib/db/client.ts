import postgres from "postgres";

/**
 * Cliente PostgreSQL único para la app y los scripts.
 *
 * DATABASE_URL apunta a:
 *   - local: el Postgres embebido (npm run db:start)
 *   - producción: Supabase. En Vercel usar el pooler en modo transacción
 *     (puerto 6543); por eso se desactivan los prepared statements.
 */
type Sql = postgres.Sql<Record<string, never>>;

const globalForDb = globalThis as unknown as { __amiSql?: Sql };

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

export function getSql(): Sql {
  if (globalForDb.__amiSql) return globalForDb.__amiSql;
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL no está configurada. Copiá .env.example a .env.local (ver README).",
    );
  }
  const isPooler = /pooler\.supabase\.com|:6543\b/.test(url);
  // El pooler en modo transacción (6543) no soporta consultas encadenadas
  // (pipelining) en una misma conexión: las respuestas quedan colgadas.
  const isTransactionPooler = /:6543\b/.test(url);
  const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const sql = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? (isPooler ? 3 : 5)),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: !isPooler,
    ...(isTransactionPooler ? { max_pipeline: 1, fetch_types: false } : {}),
    ssl: isLocal ? false : "require",
    onnotice: () => {},
    types: {
      // numeric -> number de JS. Los valores macro entran holgados en float64
      // (15+ dígitos significativos); el texto original queda en raw_value.
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
      // date -> string YYYY-MM-DD (sin conversión a zona horaria)
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
  });
  globalForDb.__amiSql = sql as unknown as Sql;
  return globalForDb.__amiSql;
}

export async function closeSql() {
  if (globalForDb.__amiSql) {
    await globalForDb.__amiSql.end({ timeout: 5 });
    globalForDb.__amiSql = undefined;
  }
}
