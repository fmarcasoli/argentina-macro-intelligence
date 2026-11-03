"use client";

import { Bookmark, Download, FolderPlus, Loader2, MessageSquarePlus, Send, Settings2, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBox, Field, inputCls, Notices, selectCls } from "@/components/econ/ui";
import { answer, answerWithRules } from "@/lib/ai/agent";
import type { Block, ChatTurn, SourceRef } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { Blocks, ExportBar, Methodology, SourcesList } from "./blocks";
import { browserDataClient, DEFAULT_SETTINGS, loadSettings, makeProvider, ollamaModels, saveSettings, type AiSettings } from "./client";
import { Markdown } from "./markdown";

export const SUGGESTIONS = [
  "Analizá la evolución de las reservas internacionales durante los últimos 24 meses.",
  "Compará M2 con el IPC y calculá su variación real.",
  "¿Qué relación existe entre las tasas de interés y la inflación?",
  "Analizá la evolución del salario real desde 2020.",
  "Compará el EMAE con los préstamos al sector privado.",
  "Identificá los períodos de mayor expansión monetaria.",
  "Construí un gráfico con inflación, tipo de cambio y reservas.",
  "Realizá un análisis econométrico de la relación entre agregados monetarios e inflación.",
];

interface ServerStatus {
  configured: boolean;
  model: string | null;
  label: string;
}
interface ConvSummary { id: string; title: string; space_id: string | null; turn_count: number; updated_at: string }
interface Space { id: string; name: string; description: string | null; conversations: number; notes: number }
interface Note { id: string; title: string; body: string; blocks: Block[]; sources: SourceRef[]; space_id: string | null; conversation_id: string | null; created_at: string }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Para guardar: los gráficos con muchas filas se recortan (las tablas conservan los datos). */
function compactTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.map((t) => ({ ...t, blocks: t.blocks?.map((b) => (b.type === "chart" && b.rows.length > 400 ? { ...b, rows: b.rows.filter((_, i) => i % Math.ceil(b.rows.length / 400) === 0) } : b)) }));
}

export function MacroAi({ server, initialQuestion }: { server: ServerStatus; initialQuestion?: string }) {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [conn, setConn] = useState<{ state: "checking" | "ok" | "down" | "rules"; detail: string; models: string[] }>({ state: "checking", detail: "", models: [] });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [input, setInput] = useState(initialQuestion ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [space, setSpace] = useState<string | null>(null);
  const [memError, setMemError] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<Note | null>(null);
  const client = useMemo(() => browserDataClient(), []);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Configuración guardada en el navegador.
  useEffect(() => {
    const s = loadSettings(server.configured);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee localStorage una sola vez al montar
    setSettings(s.mode === "server" && !server.configured ? { ...s, mode: "browser" } : s);
  }, [server.configured]);

  const checkConnection = useCallback(async (s: AiSettings) => {
    if (s.mode === "rules") return setConn({ state: "rules", detail: "Sin modelo de lenguaje: respuestas con reglas y cálculos.", models: [] });
    if (s.mode === "server") return setConn(server.configured ? { state: "ok", detail: `${server.label} · ${server.model}`, models: [] } : { state: "down", detail: "El servidor no tiene un modelo configurado.", models: [] });
    setConn((c) => ({ ...c, state: "checking" }));
    const r = await ollamaModels(s.ollamaUrl);
    if (!r.ok) return setConn({ state: "down", detail: `Ollama no responde en ${s.ollamaUrl}: ${r.error}`, models: [] });
    const names = r.models.map((m) => m.name);
    setConn({ state: names.length ? "ok" : "down", detail: names.length ? (names.includes(s.model) ? `Ollama local · ${s.model}` : `Ollama responde, pero el modelo ${s.model} no está instalado`) : "Ollama responde, pero no tiene modelos instalados", models: names });
  }, [server]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verificación de conexión al cambiar la configuración
    void checkConnection(settings);
  }, [settings, checkConnection]);

  const refreshMemory = useCallback(async () => {
    try {
      const [c, s, n] = await Promise.all([
        api<{ conversations: ConvSummary[] }>(`/api/ai/conversations${space ? `?space=${space}` : ""}`),
        api<{ spaces: Space[] }>("/api/ai/spaces"),
        api<{ notes: Note[] }>(`/api/ai/notes${space ? `?space=${space}` : ""}`),
      ]);
      setConvs(c.conversations);
      setSpaces(s.spaces);
      setNotes(n.notes);
      setMemError(null);
    } catch (e) {
      setMemError((e as Error).message);
    }
  }, [space]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de la memoria
    void refreshMemory();
  }, [refreshMemory]);

  // Llaves obligatorias: en Chrome reciente scrollIntoView devuelve una promesa y el efecto no debe devolverla.
  useEffect(() => {
    void endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  const updateSettings = (patch: Partial<AiSettings>) => {
    const s = { ...settings, ...patch };
    setSettings(s);
    saveSettings(s);
  };

  const persist = async (all: ChatTurn[], id: string | null) => {
    if (!settings.saveHistory) return id;
    try {
      const body = { title: all.find((t) => t.role === "user")?.content.slice(0, 150) || "Conversación", space_id: space, turns: compactTurns(all) };
      if (id) {
        await api(`/api/ai/conversations/${id}`, json("PUT", { turns: body.turns }));
        return id;
      }
      const r = await api<{ conversation: { id: string } }>("/api/ai/conversations", json("POST", body));
      return r.conversation.id;
    } catch (e) {
      setMemError(`No se pudo guardar la conversación: ${(e as Error).message}`);
      return id;
    }
  };

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const userTurn: ChatTurn = { role: "user", content: question, createdAt: new Date().toISOString() };
    const history = turns;
    setTurns([...history, userTurn]);
    setBusy("Preparando");
    abortRef.current = new AbortController();
    try {
      const today = new Date().toISOString().slice(0, 10);
      const provider = conn.state === "rules" ? null : makeProvider(settings, server);
      const opts = { client, provider, today, history, signal: abortRef.current.signal, onStep: (s: string) => setBusy(s) };
      const reply = provider ? await answer(question, opts) : await answerWithRules(question, opts);
      const all = [...history, userTurn, reply];
      setTurns(all);
      const id = await persist(all, convId);
      setConvId(id);
      void refreshMemory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  const openConversation = async (id: string) => {
    try {
      const r = await api<{ conversation: { id: string; turns: ChatTurn[]; space_id: string | null } }>(`/api/ai/conversations/${id}`);
      setTurns(r.conversation.turns);
      setConvId(r.conversation.id);
      setOpenNote(null);
    } catch (e) {
      setMemError((e as Error).message);
    }
  };

  const saveNote = async (t: ChatTurn) => {
    const title = window.prompt("Título de la conclusión", turns[turns.indexOf(t) - 1]?.content.slice(0, 120) ?? "Conclusión");
    if (!title) return;
    try {
      const charts = (t.blocks ?? []).filter((b) => b.type === "chart" || b.type === "stats").slice(0, 4);
      await api("/api/ai/notes", json("POST", { title, body: t.content, blocks: compactTurns([{ ...t, blocks: charts }])[0].blocks, sources: t.sources ?? [], space_id: space, conversation_id: convId }));
      void refreshMemory();
    } catch (e) {
      setMemError((e as Error).message);
    }
  };

  const newSpace = async () => {
    const name = window.prompt("Nombre del espacio de investigación (p. ej. “Dinero e inflación 2024-2026”)");
    if (!name) return;
    try {
      const r = await api<{ space: Space }>("/api/ai/spaces", json("POST", { name }));
      setSpace(r.space.id);
    } catch (e) {
      setMemError((e as Error).message);
    }
  };

  const wipe = async () => {
    if (!window.confirm("Se van a borrar de forma permanente todas tus conversaciones, conclusiones y espacios de investigación guardados en este navegador. No se puede deshacer. ¿Continuar?")) return;
    try {
      await api("/api/ai/memory", { method: "DELETE" });
      setTurns([]);
      setConvId(null);
      setSpace(null);
      void refreshMemory();
    } catch (e) {
      setMemError((e as Error).message);
    }
  };

  const statusCls = conn.state === "ok" ? "border-positive/40 text-positive" : conn.state === "down" ? "border-amber/50 text-amber" : "border-border text-muted-foreground";

  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Memoria de investigación */}
      <aside className="order-2 flex min-w-0 flex-col gap-3 text-xs lg:order-1">
        <button type="button" onClick={() => { setTurns([]); setConvId(null); setOpenNote(null); }} className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-amber/60 bg-amber/10 font-medium hover:bg-amber/20">
          <MessageSquarePlus className="size-3.5" aria-hidden /> Nueva investigación
        </button>
        <section className="rounded-md border border-border bg-card p-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="label-caps text-[10px] text-muted-foreground">Espacios</h2>
            <button type="button" onClick={() => void newSpace()} className="text-muted-foreground hover:text-foreground" aria-label="Nuevo espacio"><FolderPlus className="size-3.5" /></button>
          </div>
          <ul className="flex flex-col gap-0.5">
            <li><button type="button" onClick={() => setSpace(null)} className={cn("w-full rounded px-1.5 py-1 text-left hover:bg-accent", !space && "bg-accent")}>Todas</button></li>
            {spaces.map((s) => (
              <li key={s.id} className="group flex items-center">
                <button type="button" onClick={() => setSpace(s.id)} className={cn("min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left hover:bg-accent", space === s.id && "bg-accent")}>{s.name} <span className="num text-[10px] text-muted-foreground">{s.conversations + s.notes}</span></button>
                <button type="button" aria-label={`Borrar espacio ${s.name}`} className="hidden px-1 text-muted-foreground hover:text-negative group-hover:block" onClick={async () => { if (window.confirm(`¿Borrar el espacio “${s.name}”? Las conversaciones y conclusiones quedan, sin espacio.`)) { await api(`/api/ai/spaces/${s.id}`, { method: "DELETE" }); if (space === s.id) setSpace(null); void refreshMemory(); } }}><Trash2 className="size-3" /></button>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-md border border-border bg-card p-2">
          <h2 className="label-caps mb-1 text-[10px] text-muted-foreground">Conversaciones</h2>
          {!convs.length && <p className="text-[11px] text-muted-foreground">{settings.saveHistory ? "Todavía no hay conversaciones guardadas." : "Historial desactivado."}</p>}
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {convs.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button type="button" onClick={() => void openConversation(c.id)} className={cn("min-w-0 flex-1 rounded px-1.5 py-1 text-left hover:bg-accent", convId === c.id && "bg-accent")}>
                  <span className="line-clamp-2">{c.title}</span>
                  <span className="num block text-[10px] text-muted-foreground">{c.updated_at.slice(0, 10)} · {Math.ceil(c.turn_count / 2)} {Math.ceil(c.turn_count / 2) === 1 ? "pregunta" : "preguntas"}</span>
                </button>
                <button type="button" aria-label="Borrar conversación" className="hidden px-1 text-muted-foreground hover:text-negative group-hover:block" onClick={async () => { await api(`/api/ai/conversations/${c.id}`, { method: "DELETE" }); if (convId === c.id) { setTurns([]); setConvId(null); } void refreshMemory(); }}><Trash2 className="size-3" /></button>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-md border border-border bg-card p-2">
          <h2 className="label-caps mb-1 text-[10px] text-muted-foreground">Conclusiones guardadas</h2>
          {!notes.length && <p className="text-[11px] text-muted-foreground">Guardá una respuesta con “Guardar conclusión”.</p>}
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {notes.map((n) => (
              <li key={n.id} className="group flex items-center">
                <button type="button" onClick={() => setOpenNote(n)} className="min-w-0 flex-1 rounded px-1.5 py-1 text-left hover:bg-accent"><span className="line-clamp-2">{n.title}</span></button>
                <button type="button" aria-label="Borrar conclusión" className="hidden px-1 text-muted-foreground hover:text-negative group-hover:block" onClick={async () => { await api(`/api/ai/notes/${n.id}`, { method: "DELETE" }); void refreshMemory(); }}><Trash2 className="size-3" /></button>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-md border border-border bg-card p-2">
          <h2 className="label-caps mb-1 flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="size-3" aria-hidden /> Privacidad</h2>
          <label className="flex items-center gap-1.5 py-0.5">
            <input type="checkbox" checked={settings.saveHistory} onChange={(e) => updateSettings({ saveHistory: e.target.checked })} /> Guardar historial
          </label>
          <p className="text-[10px] leading-snug text-muted-foreground">La memoria pertenece a este navegador (cookie anónima) y se guarda en la base de la plataforma, no en el proveedor del modelo. Con Ollama local, las preguntas no salen de tu computadora.</p>
          <div className="mt-1.5 flex gap-1">
            <a href="/api/ai/memory" className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"><Download className="size-3" aria-hidden /> Exportar</a>
            <button type="button" onClick={() => void wipe()} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-negative"><Trash2 className="size-3" aria-hidden /> Borrar todo</button>
          </div>
        </section>
        {memError && <p className="text-[11px] text-negative">{memError}</p>}
      </aside>

      {/* Conversación (en celular, antes que la memoria) */}
      <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]", statusCls)} role="status">
            {conn.state === "checking" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" aria-hidden />}
            {conn.state === "checking" ? "Verificando el modelo…" : conn.detail}
          </span>
          {conn.state === "down" && <span className="text-[11px] text-muted-foreground">Mientras tanto, las respuestas se generan sin modelo (con datos y cálculos).</span>}
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="ml-auto inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"><Settings2 className="size-3" aria-hidden /> Modelo</button>
        </div>
        {showSettings && <SettingsPanel settings={settings} server={server} models={conn.models} onChange={updateSettings} onTest={() => void checkConnection(settings)} onClose={() => setShowSettings(false)} />}

        {openNote ? (
          <NoteView note={openNote} onClose={() => setOpenNote(null)} />
        ) : turns.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-sm">Preguntá sobre la economía argentina: MACRO AI busca las series oficiales, calcula, grafica y cita las fuentes.</p>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}><button type="button" onClick={() => void ask(s)} className="h-full w-full rounded border border-border/60 px-2.5 py-2 text-left text-xs hover:border-amber/50 hover:bg-accent">{s}</button></li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {turns.map((t, i) => (t.role === "user" ? (
              <li key={i} className="ml-auto max-w-[85%] rounded-md bg-secondary px-3 py-2 text-sm">{t.content}</li>
            ) : (
              <AssistantTurn key={i} turn={t} title={turns[i - 1]?.content ?? "Respuesta"} onSaveNote={() => void saveNote(t)} />
            )))}
          </ol>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {busy}…
            <button type="button" className="underline" onClick={() => abortRef.current?.abort()}>Cancelar</button>
          </p>
        )}
        {error && <ErrorBox message={error} />}
        <div ref={endRef} />
        <form className="sticky bottom-2 flex gap-2 rounded-md border border-border bg-card p-2 shadow-sm" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
          <label className="sr-only" htmlFor="macro-ai-q">Pregunta</label>
          <textarea
            id="macro-ai-q"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            rows={2}
            placeholder={turns.length ? "Seguí la investigación con otra pregunta…" : "Ej.: Analizá la evolución del salario real desde 2020"}
            className="min-h-[44px] flex-1 resize-y rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          <button type="submit" disabled={Boolean(busy) || !input.trim()} className="inline-flex items-center gap-1 self-end rounded border border-amber/60 bg-amber/10 px-3 py-2 text-xs font-medium hover:bg-amber/20 disabled:opacity-50" aria-label="Enviar">
            <Send className="size-3.5" aria-hidden /> Enviar
          </button>
        </form>
      </div>
    </div>
  );
}

function AssistantTurn({ turn, title, onSaveNote }: { turn: ChatTurn; title: string; onSaveNote: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="rounded border border-border px-1.5 py-0.5">{turn.mode === "model" ? `Modelo: ${turn.model}` : "Sin modelo (reglas y cálculos)"}</span>
        <span className="num">{turn.createdAt.slice(0, 16).replace("T", " ")}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" onClick={onSaveNote} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] hover:text-foreground"><Bookmark className="size-3" aria-hidden /> Guardar conclusión</button>
          <ExportBar title={title.slice(0, 80)} blocks={turn.blocks ?? []} sources={turn.sources ?? []} methodology={turn.methodology ?? []} node={ref} />
        </div>
      </div>
      <div ref={ref} className="flex min-w-0 flex-col gap-3 bg-background">
        <div className="rounded-md border border-border bg-card p-3"><Markdown text={turn.content} /></div>
        {turn.unverified && turn.unverified.length > 0 && (
          <Notices warnings={[`Cifras del texto del modelo que no aparecen en los datos consultados (verificalas en las tablas): ${turn.unverified.join(", ")}.`]} />
        )}
        <Blocks blocks={turn.blocks ?? []} methodology={turn.methodology} />
        <SourcesList sources={turn.sources ?? []} />
        <Methodology items={turn.methodology ?? []} tools={turn.tools} />
      </div>
    </li>
  );
}

function NoteView({ note, onClose }: { note: Note; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{note.title}</h2>
        <span className="num text-[10px] text-muted-foreground">{note.created_at.slice(0, 10)}</span>
        <div className="ml-auto flex gap-1">
          <ExportBar title={note.title} blocks={note.blocks} sources={note.sources} methodology={[]} node={ref} />
          <button type="button" onClick={onClose} className="inline-flex h-7 items-center rounded border border-border px-2 text-muted-foreground hover:text-foreground" aria-label="Cerrar"><X className="size-3.5" /></button>
        </div>
      </div>
      <div ref={ref} className="flex flex-col gap-3 bg-background">
        <div className="rounded-md border border-border bg-card p-3"><Markdown text={note.body} /></div>
        <Blocks blocks={note.blocks} />
        <SourcesList sources={note.sources} />
      </div>
    </div>
  );
}

function SettingsPanel({ settings, server, models, onChange, onTest, onClose }: { settings: AiSettings; server: ServerStatus; models: string[]; onChange: (p: Partial<AiSettings>) => void; onTest: () => void; onClose: () => void }) {
  return (
    <section className="rounded-md border border-border bg-card p-3 text-xs">
      <div className="mb-2 flex items-center">
        <h2 className="label-caps text-[10px] text-muted-foreground">Modelo de lenguaje</h2>
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Cerrar"><X className="size-3.5" /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Modo">
          <select className={selectCls} value={settings.mode} onChange={(e) => onChange({ mode: e.target.value as AiSettings["mode"] })}>
            <option value="browser">Ollama local (desde este navegador)</option>
            <option value="server" disabled={!server.configured}>Servidor de la app{server.configured ? ` (${server.label})` : " — no configurado"}</option>
            <option value="rules">Sin modelo (reglas y cálculos)</option>
          </select>
        </Field>
        {settings.mode === "browser" && (
          <>
            <Field label="URL de Ollama" hint="Por defecto http://localhost:11434">
              <input className={inputCls} value={settings.ollamaUrl} onChange={(e) => onChange({ ollamaUrl: e.target.value })} />
            </Field>
            <Field label="Modelo" hint={models.length ? `${models.length} instalados` : "Instalá uno con: ollama pull qwen2.5:7b"}>
              {models.length ? (
                <select className={selectCls} value={settings.model} onChange={(e) => onChange({ model: e.target.value })}>
                  {!models.includes(settings.model) && <option value={settings.model}>{settings.model} (no instalado)</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input className={inputCls} value={settings.model} onChange={(e) => onChange({ model: e.target.value })} />
              )}
            </Field>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onTest} className="h-7 rounded border border-border px-2 text-[11px] hover:text-foreground">Probar conexión</button>
        <span className="text-[10px] text-muted-foreground">
          Requisitos y configuración (incluido el permiso de origen <code className="num">OLLAMA_ORIGINS</code> para usarlo desde la versión publicada): ver docs/MACRO_AI.md.
        </span>
      </div>
    </section>
  );
}
