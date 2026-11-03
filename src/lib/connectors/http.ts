import { ConnectorError, type SourceId } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  sourceId: SourceId;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  /** Pausa mínima entre llamadas consecutivas, para no saturar APIs públicas. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Solo ASCII: el WAF del BCRA responde 502 si el User-Agent tiene acentos (verificado 2026-11-02).
const USER_AGENT = "ArgentinaMacroIntelligence/0.1 (open data client)";

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente HTTP mínimo con timeout, reintentos con backoff exponencial
 * (solo ante errores de red, 429 y 5xx) y espaciado entre llamadas.
 */
export class HttpClient {
  private lastCall = 0;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async getJson<T>(url: string): Promise<T> {
    const retries = this.opts.retries ?? 3;
    let lastError: ConnectorError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await this.sleep(500 * 2 ** (attempt - 1));
      try {
        return await this.attempt<T>(url);
      } catch (err) {
        if (!(err instanceof ConnectorError)) throw err;
        if (!isRetryable(err)) throw err;
        lastError = err;
      }
    }
    throw lastError!;
  }

  private async attempt<T>(url: string): Promise<T> {
    await this.throttle();
    const sourceId = this.opts.sourceId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      throw new ConnectorError(
        `Error de red en ${url}: ${err instanceof Error ? err.message : String(err)}`,
        { sourceId, url, stage: "fetch" },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = extractApiError(text);
      throw new ConnectorError(`HTTP ${res.status} en ${url}${detail ? `: ${detail}` : ""}`, {
        sourceId, url, httpStatus: res.status, body: text.slice(0, 2000), stage: "fetch",
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ConnectorError(`Respuesta no JSON en ${url}`, {
        sourceId, url, httpStatus: res.status, body: text.slice(0, 2000), stage: "parse",
      });
    }
  }

  private async throttle() {
    const min = this.opts.minIntervalMs ?? 0;
    if (!min) return;
    const wait = this.lastCall + min - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCall = Date.now();
  }
}

/** Extrae el mensaje de error de las respuestas del BCRA ({errorMessages}) o de datos.gob.ar ({errors}). */
export function extractApiError(body: string): string | null {
  try {
    const j = JSON.parse(body) as { errorMessages?: string[]; errors?: { error?: string }[] };
    const msgs = [...(j.errorMessages ?? []), ...(j.errors ?? []).map((e) => e.error ?? "")].filter(Boolean);
    return msgs.length ? msgs.join("; ") : null;
  } catch {
    return null;
  }
}

/** Se reintenta ante errores de red, 429 y 5xx. Un 4xx o un JSON inválido no se reintentan. */
function isRetryable(err: ConnectorError): boolean {
  if (err.details.stage === "parse") return false;
  const status = err.details.httpStatus;
  return status === undefined || status === 429 || status >= 500;
}

export function buildUrl(base: string, params: Record<string, string | number | undefined | null>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}
