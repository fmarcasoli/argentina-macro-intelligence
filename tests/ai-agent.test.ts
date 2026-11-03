import { describe, expect, it } from "vitest";
import { answer, answerWithRules, openAiCompatibleProvider, parseOpenAiReply, type LlmMessage, type LlmProvider } from "@/lib/ai/agent";
import { aiConfig, validateChatBody } from "@/lib/ai/config";
import { plan } from "@/lib/ai/planner";
import { parseNumber, verifyNumbers } from "@/lib/ai/verify";
import { AI_SERIES, testClient } from "./helpers/ai-data";

const TODAY = "2026-10-31";
const ipc = new Map(AI_SERIES[0].points.map((p) => [p.d, p.v!]));

/** Modelo simulado: primero pide una herramienta, después responde con texto. */
function scripted(steps: ((msgs: LlmMessage[]) => { content: string; toolCalls?: { id: string; name: string; args: unknown }[] })[]): LlmProvider & { seen: LlmMessage[][] } {
  let i = 0;
  const seen: LlmMessage[][] = [];
  return {
    label: "Simulado",
    model: "test",
    seen,
    async chat(messages) {
      seen.push(JSON.parse(JSON.stringify(messages)));
      const s = steps[Math.min(i++, steps.length - 1)](messages);
      return { content: s.content, toolCalls: s.toolCalls ?? [] };
    },
  };
}

describe("planificador sin modelo: consultas de ejemplo", () => {
  const cases: [string, string, string[]][] = [
    ["Analizá la evolución de las reservas internacionales durante los últimos 24 meses.", "evolution", ["calcular", "grafico", "calcular", "anomalias"]],
    ["Compará M2 con el IPC y calculá su variación real.", "compare", ["comparar", "obtener_datos"]],
    ["¿Qué relación existe entre las tasas de interés y la inflación?", "relation", ["correlacion", "rezagos", "grafico"]],
    ["Analizá la evolución del salario real desde 2020.", "evolution", ["calcular", "grafico", "calcular", "anomalias"]],
    ["Compará el EMAE con los préstamos al sector privado.", "compare", ["comparar"]],
    ["Identificá los períodos de mayor expansión monetaria.", "ranking", ["calcular"]],
    ["Construí un gráfico con inflación, tipo de cambio y reservas.", "chart", ["grafico"]],
    ["Realizá un análisis econométrico de la relación entre agregados monetarios e inflación.", "econometric", ["analisis_econometrico"]],
    ["Generá el informe de inflación", "report", ["informe"]],
    ["Proyectá el tipo de cambio a 6 meses", "forecast", ["proyeccion"]],
  ];
  for (const [q, intent, tools] of cases) {
    it(q, () => {
      const p = plan(q, TODAY);
      expect(p.intent).toBe(intent);
      expect(p.calls.map((c) => c.name)).toEqual(tools);
    });
  }
  it("usa el período pedido", () => {
    const p = plan("Graficá reservas, base monetaria e inflación entre 2020 y 2025.", TODAY);
    expect(p.calls[0].args).toMatchObject({ ids: ["bcra.reservas", "bcra.base_monetaria", "indec.ipc_nivel_general"], desde: "2020-01", hasta: "2025-12" });
    expect(plan("Analizá la evolución de las reservas internacionales durante los últimos 24 meses.", TODAY).calls[0].args).toMatchObject({ desde: "2024-11" });
  });
  it("sin series reconocibles busca en el catálogo", () => {
    const p = plan("¿Qué pasó con la ocupación hotelera?", TODAY);
    expect(p.intent).toBe("search");
    expect(p.calls[0].name).toBe("buscar_series");
  });
});

describe("respuestas sin modelo (IA desactivada o sin conexión)", () => {
  it("responde con datos, fuentes y metodología, sin interpretación", async () => {
    const t = await answerWithRules("Analizá la evolución del salario real desde 2020.", { client: testClient(), today: TODAY });
    expect(t.mode).toBe("rules");
    expect(t.sources?.[0].id).toBe("calc.salarios_reales");
    expect(t.blocks?.some((b) => b.type === "chart")).toBe(true);
    expect(t.methodology?.length).toBeGreaterThan(0);
    expect(t.content).toMatch(/Modo sin modelo/);
  });
  it("si el modelo no responde, cae al modo por reglas y lo explica", async () => {
    const down: LlmProvider = { label: "Ollama", model: "qwen2.5:7b", chat: async () => { throw new Error("ECONNREFUSED"); } };
    const t = await answer("Construí un gráfico con inflación, tipo de cambio y reservas.", { client: testClient(), provider: down, today: TODAY });
    expect(t.mode).toBe("rules");
    expect(t.content).toMatch(/No se pudo usar el modelo: ECONNREFUSED/);
    expect(t.blocks?.some((b) => b.type === "chart")).toBe(true);
  });
  it("proveedor real compatible con OpenAI sin servidor: error claro", async () => {
    const p = openAiCompatibleProvider({ baseUrl: "http://127.0.0.1:9/v1", model: "x", timeoutMs: 2000 });
    await expect(p.chat([{ role: "user", content: "hola" }], [])).rejects.toThrow(/No se pudo conectar con el modelo/);
  });
});

describe("agente con modelo de lenguaje (simulado)", () => {
  it("ejecuta las herramientas que pide el modelo y verifica sus cifras", async () => {
    const expected = (ipc.get("2026-01-01")! / ipc.get("2024-08-01")! - 1) * 100;
    const good = expected.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const llm = scripted([
      () => ({ content: "", toolCalls: [{ id: "c1", name: "calcular", args: JSON.stringify({ id: "indec.ipc_nivel_general", operacion: "variacion_entre_fechas", desde: "2024-09", hasta: "2026-01" }) }] }),
      (msgs) => {
        const tool = msgs.find((m) => m.role === "tool");
        expect(tool?.content).toContain(good); // el modelo recibe la cifra real
        return { content: `**Resumen** La inflación acumulada fue ${good} % entre septiembre de 2024 y enero de 2026. Además el salario subió 77,77 %.` };
      },
    ]);
    const client = testClient();
    const t = await answer("¿Cuánta inflación hubo entre septiembre 2024 y enero 2026?", { client, provider: llm, today: TODAY });
    expect(t.mode).toBe("model");
    expect(t.tools?.map((x) => x.name)).toEqual(["calcular"]);
    expect(t.sources?.[0]).toMatchObject({ id: "indec.ipc_nivel_general", source: "INDEC" });
    expect(t.unverified).toEqual(["77,77"]); // la cifra inventada se marca
    expect(t.content).toContain(good);
    expect(llm.seen[0][0].content).toMatch(/Nunca inventes datos/);
  });
  it("si el modelo responde sin usar herramientas, se ejecuta el plan y se le pide basarse en él", async () => {
    const llm = scripted([() => ({ content: "Las reservas son 99.999 millones." }), () => ({ content: "**Resumen** Según los datos, ver gráfico." })]);
    const t = await answer("Analizá la evolución de las reservas internacionales durante los últimos 24 meses.", { client: testClient(), provider: llm, today: TODAY });
    expect(t.tools?.length).toBeGreaterThan(0);
    expect(llm.seen[1].some((m) => m.role === "tool")).toBe(true);
    expect(t.content).not.toContain("99.999");
  });
  it("herramienta inexistente o parámetros inválidos: el error vuelve al modelo, no se ejecuta nada fuera de la lista", async () => {
    const llm = scripted([
      () => ({ content: "", toolCalls: [{ id: "x", name: "ejecutar_sql", args: { q: "drop table observations" } }] }),
      (msgs) => ({ content: msgs.at(-1)!.content }),
    ]);
    const t = await answer("hola", { client: testClient(), provider: llm, today: TODAY });
    expect(t.tools?.[0]).toMatchObject({ name: "ejecutar_sql", ok: false });
    expect(t.content).toMatch(/Herramienta desconocida/);
  });
  it("parsea respuestas de Ollama/OpenAI con argumentos en texto u objeto", () => {
    const r = parseOpenAiReply({ choices: [{ message: { content: null, tool_calls: [{ id: "a", function: { name: "grafico", arguments: '{"ids":["bcra.reservas"]}' } }, { function: { name: "calcular", arguments: { id: "x" } } }] } }] });
    expect(r.toolCalls).toEqual([{ id: "a", name: "grafico", args: { ids: ["bcra.reservas"] } }, { id: "call_1", name: "calcular", args: { id: "x" } }]);
  });
});

describe("verificación de cifras", () => {
  it("formatos numéricos argentinos y redondeo", () => {
    expect(parseNumber("1.234,56")).toEqual({ value: 1234.56, decimals: 2 });
    expect(parseNumber("33,5")).toEqual({ value: 33.5, decimals: 1 });
    const res = [{ ok: true, summary: "valor 51,2831 % y 40.123,4", blocks: [], sources: [], methodology: [] }];
    expect(verifyNumbers("Subió 51,28 % (51,3 %) y llegó a 40.123 millones en 2024, con 12 meses.", res)).toEqual([]);
    expect(verifyNumbers("Subió 60,1 %.", res)).toEqual(["60,1"]);
  });
});

describe("configuración del servidor", () => {
  it("se puede desactivar y no expone claves", () => {
    expect(aiConfig({}).enabled).toBe(true);
    expect(aiConfig({ MACRO_AI_ENABLED: "false" }).enabled).toBe(false);
    const c = aiConfig({ AI_SERVER_BASE_URL: "http://localhost:11434/v1", AI_SERVER_MODEL: "qwen2.5:7b", AI_SERVER_API_KEY: "secreto" });
    expect(c.server).toMatchObject({ configured: true, label: "Ollama (servidor)", hasKey: true });
    expect(JSON.stringify(c)).not.toContain("secreto");
    expect(validateChatBody({ messages: [{ role: "hacker", content: "x" }] }).ok).toBe(false);
    expect(validateChatBody({ messages: [{ role: "user", content: "x" }] }).ok).toBe(true);
  });
});

describe("proveedores en la nube (Groq): límites del plan gratuito", () => {
  it("ante un 429 espera lo indicado y reintenta", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      if (calls === 1) return new Response('{"error":{"message":"Rate limit reached. Please try again in 0.05s."}}', { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as typeof fetch;
    const p = openAiCompatibleProvider({ baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", apiKey: "k", fetchImpl: fakeFetch });
    expect((await p.chat([{ role: "user", content: "hola" }], [])).content).toBe("ok");
    expect(calls).toBe(2);
  });
  it("si la espera es larga, informa el límite en lugar de colgarse", async () => {
    const fakeFetch = (async () => new Response("", { status: 429, headers: { "retry-after": "120" } })) as typeof fetch;
    const p = openAiCompatibleProvider({ baseUrl: "https://api.groq.com/openai/v1", model: "m", fetchImpl: fakeFetch });
    await expect(p.chat([{ role: "user", content: "x" }], [])).rejects.toThrow(/límite del plan gratuito/);
  });
  it("lee la espera de Groq y el encabezado Retry-After", async () => {
    const { retryAfterMs } = await import("@/lib/ai/agent");
    expect(retryAfterMs(null, "Please try again in 7.5s")).toBe(7750);
    expect(retryAfterMs(null, "try again in 1m2s")).toBe(62250);
    expect(retryAfterMs("3", "")).toBe(3250);
  });
  it("la lista compacta de herramientas entra en el límite por minuto", async () => {
    const { AI_TOOL_SPECS } = await import("@/lib/ai/registry");
    const { systemPrompt } = await import("@/lib/ai/agent");
    expect(JSON.stringify(AI_TOOL_SPECS).length + systemPrompt("2026-11-03").length).toBeLessThan(11_000); // ≈ 3.000 tokens
    expect(aiConfig({ AI_SERVER_BASE_URL: "https://api.groq.com/openai/v1", AI_SERVER_MODEL: "llama-3.3-70b-versatile", AI_SERVER_API_KEY: "x" }).server.label).toBe("Groq");
    expect(aiConfig({ AI_SERVER_BASE_URL: "https://api.groq.com/openai/v1", AI_SERVER_MODEL: "llama-3.3-70b-versatile" }).server.configured).toBe(false); // falta la clave
  });
});
