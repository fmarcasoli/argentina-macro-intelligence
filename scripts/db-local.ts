/**
 * Postgres local para desarrollo, sin Docker.
 *
 * Levanta un servidor PostgreSQL real (paquete open source `embedded-postgres`)
 * con datos persistentes en ./.data/postgres. Queda corriendo hasta Ctrl+C.
 *
 *   npm run db:start
 *
 * La URL de conexión resultante es la de .env.example:
 *   postgres://postgres:postgres@127.0.0.1:54329/ami
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const DB_NAME = "ami";
const dataDir = path.resolve(process.cwd(), ".data/postgres");

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
  });

  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) {
    console.log(`[db] Inicializando cluster en ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();
  if (fresh) await pg.createDatabase(DB_NAME);

  console.log(`[db] Postgres local listo en postgres://postgres:postgres@127.0.0.1:${PORT}/${DB_NAME}`);
  console.log("[db] Ctrl+C para detenerlo.");

  const stop = async () => {
    console.log("\n[db] Deteniendo Postgres…");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[db] Error al iniciar Postgres local:", err);
  process.exit(1);
});
