import { plan } from "./planner";
import { AI_TOOL_SPECS, runAiTool } from "./registry";
import type { Block, ChatTurn, DataClient, SourceRef, ToolResult, ToolTrace } from "./types";
import { verifyNumbers } from "./verify";
import { CONCEPTS } from "./vocabulary";

/**
 * Agente de MACRO AI. Con un modelo de lenguaje, el modelo decide qué
 * herramientas usar y redacta la explicación; sin modelo (o si el modelo no
 * responde), un planificador por reglas ejecuta las herramientas. En ambos
 * casos los gráficos, tablas y cifras salen de las herramientas, y las
 * cifras que el modelo escriba se verifican contra esos resultados.
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface LlmReply {
  content: string;
  toolCalls: { id: string; name: string; args: unknown }[];
}

export interface LlmProvider {
  label: string;
  model: string;
  chat(messages: LlmMessage[], tools: typeof AI_TOOL_SPECS, signal?: AbortSignal): Promise<LlmReply>;
}

export class ProviderError extends Error {}

/** Parsea la respuesta de un endpoint compatible con OpenAI (Ollama /v1, Groq, OpenRouter, vLLM, LM Studio…). */
export function parseOpenAiReply(json: unknown): LlmReply {
  const msg = (json as { choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[] })?.choices?.[0]?.message;
  if (!msg) throw new ProviderError("Respuesta del modelo con formato inesperado");
  return {
    content: msg.content ?? "",
    toolCalls: (msg.tool_calls ?? []).map((c, i) => {
      let args: unknown = c.function?.arguments ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args || "{}");
        } catch {
          args = { _raw: args };
        }
      }
      return { id: c.id ?? `call_${i}`, name: c.function?.name ?? "", args };
    }),
  };
}

/** Proveedor compatible con OpenAI llamado directamente (p. ej. Ollama local desde el navegador). */
export function openAiCompatibleProvider(opts: { baseUrl: string; model: string; apiKey?: string; label?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): LlmProvider {
  const f = opts.fetchImpl ?? fetch;
  return {
    label: opts.label ?? "Compatible con OpenAI",
    model: opts.model,
    async chat(messages, tools, signal) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
      signal?.addEventListener("abort", () => ctrl.abort());
      try {
        const res = await f(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}) },
          body: JSON.stringify({ model: opts.model, messages, tools, tool_choice: "auto", temperature: 0.1, stream: false }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new ProviderError(`El modelo respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return parseOpenAiReply(await res.json());
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(`No se pudo conectar con el modelo (${opts.baseUrl}): ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Proveedor vía el servidor de la aplicación (/api/ai/chat), que reenvía al endpoint configurado. */
export function serverProvider(model: string, label: string, fetchImpl: typeof fetch = fetch): LlmProvider {
  return {
    label,
    model,
    async chat(messages, _tools, signal) {
      let res: Response;
      try {
        res = await fetchImpl("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }), signal });
      } catch (e) {
        throw new ProviderError(`No se pudo conectar con el servidor: ${(e as Error).message}`);
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new ProviderError((j as { error?: string }).error ?? `Error ${res.status}`);
      return j as LlmReply;
    },
  };
}

export function systemPrompt(today: string): string {
  return [
    `Sos MACRO AI, asistente de investigación macroeconómica de Argentina dentro de la plataforma Argentina Macro Intelligence. Fecha: ${today}. Respondé en español rioplatense, con precisión profesional.`,
    "REGLAS OBLIGATORIAS:",
    "1. Toda cifra debe salir de una herramienta. Nunca inventes datos, fuentes, fechas ni series. Si no hay datos, decilo.",
    "2. Usá las herramientas antes de responder cualquier pregunta cuantitativa. Si no conocés el ID de una serie, usá buscar_series.",
    "3. Identificá siempre las series usadas (nombre, fuente INDEC o BCRA), las unidades, el período y las transformaciones.",
    "4. No confundas correlación con causalidad. Distinguí hechos (datos) de hipótesis (interpretación) y marcá las hipótesis como tales.",
    "5. Señalá períodos incompletos, diferencias de frecuencia, datos faltantes e incertidumbre. Las proyecciones no son certezas.",
    "6. No afirmes que hay datos diarios de series mensuales o trimestrales.",
    "FORMATO de la respuesta final (breve): **Resumen** (2-4 oraciones con las cifras clave), **Datos y metodología** (series, período, transformaciones), **Interpretación** (hipótesis, marcadas como tales), **Limitaciones**. Los gráficos y tablas de las herramientas se muestran solos: no los repitas.",
    `Series frecuentes: ${CONCEPTS.map((c) => `${c.label}=${c.id}`).join("; ")}. Para inflación usá indec.ipc_nivel_general con transformación variacion_mensual o variacion_interanual.`,
  ].join("\n");
}

export interface AgentOptions {
  client: DataClient;
  provider?: LlmProvider | null;
  today: string;
  history?: ChatTurn[];
  maxSteps?: number;
  signal?: AbortSignal;
  onStep?: (s: string) => void;
}

function collect(results: ToolResult[]) {
  const blocks: Block[] = results.flatMap((r) => r.blocks);
  const seen = new Set<string>();
  const sources: SourceRef[] = results.flatMap((r) => r.sources).filter((s) => (seen.has(`${s.id}|${s.transform}`) ? false : (seen.add(`${s.id}|${s.transform}`), true)));
  const methodology = [...new Set(results.flatMap((r) => r.methodology))];
  return { blocks, sources, methodology };
}

const STEP_LABEL: Record<string, string> = {
  buscar_series: "Buscando series en el catálogo",
  metadatos_serie: "Consultando metadatos",
  obtener_datos: "Obteniendo datos",
  calcular: "Calculando",
  comparar: "Comparando series",
  correlacion: "Calculando correlaciones",
  regresion: "Estimando la regresión",
  rezagos: "Analizando rezagos",
  analisis_econometrico: "Ejecutando el análisis econométrico",
  proyeccion: "Proyectando",
  grafico: "Construyendo el gráfico",
  anomalias: "Buscando anomalías",
  analisis_guardados: "Leyendo análisis guardados",
  informe: "Generando el informe",
};

async function execute(calls: { name: string; args: unknown }[], client: DataClient, onStep?: (s: string) => void) {
  const traces: ToolTrace[] = [];
  const results: ToolResult[] = [];
  for (const c of calls) {
    onStep?.(STEP_LABEL[c.name] ?? c.name);
    const t0 = Date.now();
    const r = await runAiTool(c.name, c.args, client);
    results.push(r);
    traces.push({ name: c.name, args: (c.args ?? {}) as Record<string, unknown>, ok: r.ok, summary: r.summary.slice(0, 400), ms: Date.now() - t0 });
  }
  return { traces, results };
}

/** Respuesta sin modelo de lenguaje (planificador por reglas). */
export async function answerWithRules(question: string, opts: AgentOptions, reason?: string): Promise<ChatTurn> {
  const p = plan(question, opts.today);
  const { traces, results } = await execute(p.calls, opts.client, opts.onStep);
  const { blocks, sources, methodology } = collect(results);
  // Primeras líneas de cada resultado (cifras con fuente, período y unidad).
  const facts = results
    .map((r) => {
      const lines = r.summary.split("\n").filter(Boolean);
      return lines.slice(0, 3).join(" ");
    })
    .filter(Boolean);
  const content = [
    p.understanding,
    ...(facts.length ? ["", ...facts.map((f) => `- ${f}`)] : []),
    "",
    reason
      ? `_${reason} La respuesta se generó con reglas y cálculos sobre los datos oficiales, sin interpretación en lenguaje natural._`
      : "_Modo sin modelo: respuesta generada con reglas y cálculos sobre los datos oficiales, sin interpretación en lenguaje natural. Para análisis conversacional, configurá un modelo local (Ollama)._",
  ].join("\n");
  return { role: "assistant", content, blocks, sources, methodology, tools: traces, mode: "rules", createdAt: new Date().toISOString() };
}

const MAX_TOOL_CHARS = 3500;

/** Respuesta con modelo de lenguaje y herramientas; cae al modo por reglas si el modelo no responde. */
export async function answer(question: string, opts: AgentOptions): Promise<ChatTurn> {
  if (!opts.provider) return answerWithRules(question, opts);
  const provider = opts.provider;
  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt(opts.today) }];
  for (const h of (opts.history ?? []).slice(-8)) {
    messages.push({ role: h.role, content: h.role === "assistant" ? `${h.content}\n[Series usadas: ${(h.sources ?? []).map((s) => s.id).join(", ") || "ninguna"}]` : h.content });
  }
  messages.push({ role: "user", content: question });
  const traces: ToolTrace[] = [];
  const results: ToolResult[] = [];
  let content = "";
  const maxSteps = opts.maxSteps ?? 6;
  for (let step = 0; step <= maxSteps; step++) {
    let reply: LlmReply;
    try {
      opts.onStep?.(step === 0 ? "Consultando al modelo" : "El modelo analiza los resultados");
      reply = await provider.chat(messages, AI_TOOL_SPECS, opts.signal);
    } catch (e) {
      if (step === 0) return answerWithRules(question, opts, `No se pudo usar el modelo: ${(e as Error).message}.`);
      content = "_El modelo dejó de responder durante el análisis. Se muestran los resultados de las herramientas ya ejecutadas._";
      break;
    }
    // Algunos modelos devuelven los argumentos como texto JSON: se normalizan a objeto.
    let calls = reply.toolCalls
      .filter((c) => c.name)
      .map((c) => {
        if (typeof c.args !== "string") return c;
        try {
          return { ...c, args: JSON.parse(c.args || "{}") as unknown };
        } catch {
          return { ...c, args: {} };
        }
      });
    // Si el modelo no usó herramientas en una pregunta con series identificables, se ejecuta el plan por reglas.
    if (!calls.length && step === 0) {
      const p = plan(question, opts.today);
      if (p.intent !== "search" || /\d/.test(reply.content)) {
        calls = p.calls.map((c, i) => ({ id: `plan_${i}`, name: c.name, args: c.args }));
      }
    }
    if (!calls.length || step === maxSteps) {
      content = reply.content.trim();
      break;
    }
    messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) });
    const ex = await execute(calls, opts.client, opts.onStep);
    traces.push(...ex.traces);
    results.push(...ex.results);
    ex.results.forEach((r, i) => {
      messages.push({ role: "tool", tool_call_id: calls[i].id, content: r.summary.slice(0, MAX_TOOL_CHARS) });
    });
  }
  const { blocks, sources, methodology } = collect(results);
  const unverified = content ? verifyNumbers(content, results) : [];
  return {
    role: "assistant",
    content: content || "_El modelo no produjo una respuesta de texto._",
    blocks,
    sources,
    methodology,
    tools: traces,
    mode: "model",
    model: `${provider.label} · ${provider.model}`,
    unverified,
    createdAt: new Date().toISOString(),
  };
}
