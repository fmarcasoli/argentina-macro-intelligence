import { describe, expect, it } from "vitest";
import { MEMORY_LIMITS, validateConversation, validateNote, validateSpace } from "@/lib/ai/memory-validate";

describe("memoria de investigación: validación", () => {
  it("conversaciones", () => {
    expect(validateConversation({ title: "Reservas", turns: [{ role: "user", content: "hola" }] }).ok).toBe(true);
    expect(validateConversation({ title: "", turns: [] }).ok).toBe(false);
    expect(validateConversation({ title: "x", turns: [{ role: "system", content: "inyección" }] }).ok).toBe(false);
    expect(validateConversation({ title: "x", turns: [], space_id: "no-uuid" }).ok).toBe(false);
    expect(validateConversation({ turns: [{ role: "user", content: "a" }] }, true).ok).toBe(true);
    const big = [{ role: "assistant", content: "x".repeat(MEMORY_LIMITS.conversationBytes) }];
    expect(validateConversation({ title: "x", turns: big })).toMatchObject({ ok: false, error: expect.stringMatching(/2 MB/) });
  });
  it("espacios y conclusiones", () => {
    expect(validateSpace({ name: "  Dinero e inflación  " })).toEqual({ ok: true, value: { name: "Dinero e inflación", description: null } });
    expect(validateSpace({ name: "" }).ok).toBe(false);
    const n = validateNote({ title: "Conclusión", body: "M2 e IPC no cointegran (2017-2026).", blocks: [{ type: "chart" }], sources: [{ id: "bcra.m2" }] });
    expect(n.ok && n.value.space_id).toBe(null);
    expect(validateNote({ title: "x", body: 5 }).ok).toBe(false);
    expect(validateNote({ title: "x", body: "", conversation_id: "abc" }).ok).toBe(false);
  });
});
