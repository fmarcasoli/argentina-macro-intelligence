import { DatabaseZap } from "lucide-react";
import { DatabaseNotConfiguredError } from "@/lib/data/queries";

/** Mensaje claro cuando la base no está configurada o no responde. */
export function DataUnavailable({ error }: { error: unknown }) {
  const notConfigured = error instanceof DatabaseNotConfiguredError;
  return (
    <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
      <DatabaseZap className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div>
        <div className="font-medium">{notConfigured ? "Base de datos no configurada" : "No se pudo leer la base de datos"}</div>
        <p className="mt-1 text-muted-foreground">
          {notConfigured ? (
            <>
              Definí <code className="num">DATABASE_URL</code> en <code className="num">.env.local</code> y ejecutá{" "}
              <code className="num">npm run setup</code>. Ver README.
            </>
          ) : (
            <>
              {error instanceof Error ? error.message : String(error)}. Verificá que Postgres esté corriendo (
              <code className="num">npm run db:start</code>) y que las migraciones estén aplicadas.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Ejecuta una lectura y devuelve el error en lugar de lanzarlo, para mostrar un estado amable. */
export async function safeLoad<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
