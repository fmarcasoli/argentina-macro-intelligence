/**
 * Test de integración del motor de ingesta contra un PostgreSQL real.
 * Se ejecuta solo si TEST_DATABASE_URL está definida (la base se BORRA y recrea).
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/ami_test npm test
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DiscoveredSeries, FetchResult, RawObservation, SourceConnector } from "@/lib/connectors/types";
import { applyMigrations } from "@/lib/db/migrate";
import type { ConnectorMap } from "@/lib/ingest/connectors";
import { registerDiscovered } from "@/lib/ingest/catalog";
import { syncAll } from "@/lib/ingest/sync";
import { ensureSeriesData } from "@/lib/ingest/on-demand";

const url = process.env.TEST_DATABASE_URL;
type Sql = postgres.Sql<Record<string, never>>;

/** Conector falso cuyo contenido se puede cambiar entre corridas. */
class FakeConnector implements SourceConnector {
  readonly sourceId = "BCRA" as const;
  data: Record<string, RawObservation[]> = {};
  failNext = false;
  lastRange: { from?: string } | undefined;
  async discover(): Promise<DiscoveredSeries[]> {
    return [];
  }
  async describe(): Promise<DiscoveredSeries> {
    throw new Error("no usado");
  }
  async fetchSeries(code: string, range?: { from?: string }): Promise<FetchResult> {
    this.lastRange = range;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("API caída (simulada)");
    }
    const obs = (this.data[code] ?? []).filter((o) => !range?.from || o.date >= range.from);
    return { sourceCode: code, endpoint: `fake://${code}`, observations: obs, reportedCount: obs.length, requests: 1 };
  }
}

describe.skipIf(!url)("motor de sincronización (Postgres real)", () => {
  let sql: Sql;
  const fake = new FakeConnector();
  const connectors = { BCRA: fake, INDEC: fake } as unknown as ConnectorMap;
  const today = "2026-11-02";

  beforeAll(async () => {
    sql = postgres(url!, { onnotice: () => {}, types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x }, numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } } }) as unknown as Sql;
    await sql.unsafe("drop schema public cascade; create schema public;");
    await applyMigrations(sql);
    await sql`
      insert into indicators (id, source_id, source_code, name, category, unit, frequency, is_tracked)
      values ('t.diaria', 'BCRA', 'T1', 'Serie diaria de prueba', 'Test', 'ARS', 'D', true),
             ('t.mensual', 'BCRA', 'T2', 'Serie mensual de prueba', 'Test', 'Índice', 'M', true)`;
    await sql`
      insert into indicators (id, source_id, name, category, unit, frequency, value_kind, derivation, is_tracked)
      values ('t.var', 'BCRA', 'Var. mensual', 'Test', '%', 'M', 'calculated',
              ${sql.json({ op: "pct_change", base: "t.mensual", lag: 1 })}, true)`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("carga inicial: inserta, alinea períodos, conserva nulls y marca programados", async () => {
    fake.data.T1 = [
      { date: "2026-10-30", value: 100 },
      { date: "2026-10-31", value: null },
      { date: "2026-11-02", value: 102 },
      { date: "2026-11-05", value: 105 }, // programado
    ];
    fake.data.T2 = [
      { date: "2026-07-31", value: 200 },
      { date: "2026-08-31", value: 204 },
    ];
    const out = await syncAll(sql, connectors, { mode: "full", today });
    expect(out.map((o) => [o.indicatorId, o.status, o.inserted])).toEqual([
      ["t.diaria", "success", 4],
      ["t.mensual", "success", 2],
      ["t.var", "success", 1],
    ]);

    const rows = await sql<{ ref_date: string; value: number | null; is_scheduled: boolean; publication_date: string | null }[]>`
      select ref_date, value, is_scheduled, publication_date from observations where indicator_id = 't.diaria' order by ref_date`;
    expect(rows.find((r) => r.ref_date === "2026-10-31")?.value).toBeNull();
    expect(rows.find((r) => r.ref_date === "2026-11-05")?.is_scheduled).toBe(true);
    // carga histórica: fecha de publicación desconocida
    expect(rows.every((r) => r.publication_date === null)).toBe(true);

    const [m] = await sql<{ ref_date: string; source_ref_date: string }[]>`
      select ref_date, source_ref_date from observations where indicator_id = 't.mensual' order by ref_date limit 1`;
    expect(m).toEqual({ ref_date: "2026-07-01", source_ref_date: "2026-07-31" });

    const [v] = await sql<{ value: number }[]>`select value from observations where indicator_id = 't.var'`;
    expect(v.value).toBeCloseTo(2, 10);

    const [ind] = await sql<{ last_date: string; last_value: number; update_status: string; observation_count: number }[]>`
      select last_date, last_value, update_status, observation_count from indicators where id = 't.diaria'`;
    // el último dato observado excluye el programado
    expect(ind).toMatchObject({ last_date: "2026-11-02", last_value: 102, update_status: "ok", observation_count: 4 });
  });

  it("incremental: no duplica, guarda revisiones y fecha de primera aparición", async () => {
    fake.data.T2 = [
      { date: "2026-07-31", value: 200 },
      { date: "2026-08-31", value: 205 }, // revisión de 204 -> 205
      { date: "2026-09-30", value: 210 }, // dato nuevo
    ];
    const out = await syncAll(sql, connectors, { mode: "incremental", today, ids: ["t.mensual"] });
    expect(out[0]).toMatchObject({ inserted: 1, updated: 1, unchanged: 1, status: "success" });
    expect(fake.lastRange?.from).toBe("2024-08-01"); // 730 días antes del último dato

    const revs = await sql<{ ref_date: string; old_value: number; new_value: number }[]>`
      select ref_date, old_value, new_value from observation_revisions where indicator_id = 't.mensual'`;
    expect(revs).toEqual([{ ref_date: "2026-08-01", old_value: 204, new_value: 205 }]);

    const [n] = await sql<{ publication_date: string; publication_origin: string; revision_count: number }[]>`
      select publication_date, publication_origin, revision_count from observations
      where indicator_id = 't.mensual' and ref_date = '2026-09-01'`;
    expect(n).toEqual({ publication_date: today, publication_origin: "first_seen", revision_count: 0 });

    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from observations where indicator_id = 't.mensual'`;
    expect(count).toBe(3);
  });

  it("registra el error y marca el indicador sin perder datos previos", async () => {
    fake.failNext = true;
    const [o] = await syncAll(sql, connectors, { mode: "incremental", today, ids: ["t.diaria"] });
    expect(o.status).toBe("failed");
    const [ind] = await sql<{ update_status: string; last_error: string; observation_count: number }[]>`
      select update_status, last_error, observation_count from indicators where id = 't.diaria'`;
    expect(ind).toMatchObject({ update_status: "error", last_error: "API caída (simulada)", observation_count: 4 });
    const errs = await sql<{ stage: string }[]>`select stage from sync_errors where indicator_id = 't.diaria'`;
    expect(errs.map((e) => e.stage)).toContain("fetch");
    const [run] = await sql<{ status: string }[]>`select status from sync_runs where indicator_id = 't.diaria' order by id desc limit 1`;
    expect(run.status).toBe("failed");
  });

  it("el dato programado pasa a observado cuando llega su fecha", async () => {
    fake.data.T1 = [...fake.data.T1];
    await syncAll(sql, connectors, { mode: "incremental", today: "2026-11-06", ids: ["t.diaria"] });
    const [r] = await sql<{ is_scheduled: boolean }[]>`
      select is_scheduled from observations where indicator_id = 't.diaria' and ref_date = '2026-11-05'`;
    expect(r.is_scheduled).toBe(false);
  });

  it("el descubrimiento no duplica series ya curadas ni pisa sus nombres", async () => {
    await registerDiscovered(sql, "BCRA", [
      { sourceId: "BCRA", sourceCode: "T2", name: "Nombre genérico de la fuente", category: "X", unit: "u", frequency: "M", endpoint: "e", raw: {} },
      { sourceId: "BCRA", sourceCode: "T9", name: "Serie nueva", category: "X", unit: "u", frequency: "D", endpoint: "e", raw: {} },
    ]);
    const rows = await sql<{ id: string; name: string; is_tracked: boolean }[]>`
      select id, name, is_tracked from indicators where source_code in ('T2', 'T9') order by id`;
    expect(rows).toEqual([
      { id: "bcra-T9", name: "Serie nueva", is_tracked: false },
      { id: "t.mensual", name: "Serie mensual de prueba", is_tracked: true },
    ]);
  });

  it("descarga a pedido una serie descubierta y la suma a la actualización diaria", async () => {
    fake.data.T9 = [
      { date: "2026-10-28", value: 5 },
      { date: "2026-10-29", value: 6 },
    ];
    const r = await ensureSeriesData(sql, connectors, "bcra-T9");
    expect(r.status).toBe("synced");
    const [ind] = await sql<{ is_tracked: boolean; observation_count: number; on_demand: boolean; panel: string | null }[]>`
      select is_tracked, observation_count, tracked_on_demand_at is not null as on_demand, panel
      from indicators where id = 'bcra-T9'`;
    expect(ind).toMatchObject({ is_tracked: true, observation_count: 2, on_demand: true });
    expect(ind.panel).toBeTruthy(); // clasificada al descubrirla
    const [run] = await sql<{ triggered_by: string; mode: string }[]>`
      select triggered_by, mode from sync_runs where indicator_id = 'bcra-T9'`;
    expect(run).toEqual({ triggered_by: "on_demand", mode: "full" });
    // segunda consulta: ya tiene datos, no vuelve a descargar
    expect((await ensureSeriesData(sql, connectors, "bcra-T9")).status).toBe("ready");
    expect((await ensureSeriesData(sql, connectors, "no-existe")).status).toBe("not_found");
  });

  it("series derivadas nuevas: acumulada en el año y deflactada, en orden de dependencias", async () => {
    await sql`
      insert into indicators (id, source_id, source_code, name, category, unit, frequency, is_tracked)
      values ('t.ipc', 'INDEC', 'P1', 'IPC prueba', 'Test', 'Índice', 'M', true),
             ('t.sal', 'INDEC', 'W1', 'Salario prueba', 'Test', 'Índice', 'M', true)`;
    await sql`
      insert into indicators (id, source_id, name, category, unit, frequency, value_kind, derivation, is_tracked)
      values ('t.z_real_yoy', 'INDEC', 'Real i.a.', 'Test', '%', 'M', 'calculated', ${sql.json({ op: "pct_change", base: "t.a_real", lag: 12 })}, true),
             ('t.a_real', 'INDEC', 'Real', 'Test', 'Índice', 'M', 'calculated', ${sql.json({ op: "deflate", nominal: "t.sal", deflator: "t.ipc", base: "2024-12-01" })}, true),
             ('t.ytd', 'INDEC', 'Acumulada', 'Test', '%', 'M', 'calculated', ${sql.json({ op: "ytd_change", base: "t.ipc" })}, true)`;
    const months = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 11 + i, 1));
      return d.toISOString().slice(0, 10);
    });
    fake.data.P1 = months.map((d, i) => ({ date: d, value: 100 * Math.pow(1.02, i) }));
    fake.data.W1 = months.map((d, i) => ({ date: d, value: 100 * Math.pow(1.03, i) }));
    const out = await syncAll(sql, connectors, { mode: "full", today, sourceId: "INDEC" });
    const order = out.map((o) => o.indicatorId);
    expect(order.indexOf("t.a_real")).toBeLessThan(order.indexOf("t.z_real_yoy"));
    expect(out.every((o) => o.status === "success")).toBe(true);

    const [ytd] = await sql<{ value: number }[]>`select value from observations where indicator_id = 't.ytd' and ref_date = '2025-03-01'`;
    expect(ytd.value).toBeCloseTo((Math.pow(1.02, 3) - 1) * 100, 8);
    const [real] = await sql<{ value: number }[]>`select value from observations where indicator_id = 't.a_real' and ref_date = '2025-12-01'`;
    expect(real.value).toBeCloseTo(Math.pow(1.03 / 1.02, 12) * 100, 6);
    const [yoy] = await sql<{ value: number }[]>`select value from observations where indicator_id = 't.z_real_yoy' and ref_date = '2025-12-01'`;
    expect(yoy.value).toBeCloseTo((Math.pow(1.03 / 1.02, 12) - 1) * 100, 6);
  });

  it("con tiempo agotado no descarga más series de origen pero recalcula las derivadas", async () => {
    const out = await syncAll(sql, connectors, { mode: "incremental", today, sourceId: "INDEC", deadline: Date.now() - 1 });
    expect(out.every((o) => o.indicatorId.startsWith("t.") && ["t.ytd", "t.a_real", "t.z_real_yoy"].includes(o.indicatorId))).toBe(true);
  });

  it("espacios de trabajo: análisis guardados y favoritos aislados por espacio", async () => {
    const [w1] = await sql<{ id: string }[]>`insert into workspaces (token_hash) values ('h1') returning id`;
    const [w2] = await sql<{ id: string }[]>`insert into workspaces (token_hash) values ('h2') returning id`;
    await sql`insert into saved_analyses (workspace_id, title, kind, definition, indicator_ids)
              values (${w1.id}, 'A', 'analysis', ${sql.json({ ids: ["t.ipc"] })}, ${["t.ipc"]})`;
    await sql`insert into workspace_favorites (workspace_id, indicator_id) values (${w1.id}, 't.ipc')`;
    await expect(sql`insert into workspace_favorites (workspace_id, indicator_id) values (${w1.id}, 't.ipc')`).rejects.toThrow(/duplicate key/);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from saved_analyses where workspace_id = ${w2.id}`;
    expect(n).toBe(0);
    // un análisis sin dueño no se puede guardar
    await expect(
      sql`insert into saved_analyses (title, kind, definition) values ('x', 'analysis', ${sql.json({})})`,
    ).rejects.toThrow(/saved_analyses_owner/);
    // borrar el espacio borra sus datos
    await sql`delete from workspaces where id = ${w1.id}`;
    const [{ m }] = await sql<{ m: number }[]>`select count(*)::int as m from workspace_favorites where workspace_id = ${w1.id}`;
    expect(m).toBe(0);
  });

  it("la base impide duplicados y valores calculados sin definición", async () => {
    await expect(
      sql`insert into observations (indicator_id, ref_date, value, value_kind) values ('t.diaria', '2026-10-30', 1, 'original')`,
    ).rejects.toThrow(/duplicate key/);
    await expect(
      sql`insert into indicators (id, source_id, name, category, unit, frequency, value_kind) values ('bad', 'BCRA', 'x', 'x', 'x', 'M', 'calculated')`,
    ).rejects.toThrow(/indicators_derivation_required/);
  });
});
