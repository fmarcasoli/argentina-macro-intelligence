/** Carga .env.local y .env para los scripts de línea de comandos (Next.js lo hace solo). */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
