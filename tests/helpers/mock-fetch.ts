import { readFileSync } from "node:fs";
import path from "node:path";
import type { FetchLike } from "@/lib/connectors/http";

export function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
}

export interface Route {
  /** Coincide si la URL contiene este texto (o cumple el regex). */
  match: string | RegExp | ((url: URL) => boolean);
  status?: number;
  body: string | ((url: URL) => string);
}

/** fetch falso que responde según rutas y registra cada llamada. */
export function mockFetch(routes: Route[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: input, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find((r) =>
      typeof r.match === "string" ? input.includes(r.match) : r.match instanceof RegExp ? r.match.test(input) : r.match(url),
    );
    if (!route) return new Response("not found", { status: 404 });
    const body = typeof route.body === "function" ? route.body(url) : route.body;
    return new Response(body, { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

export const noSleep = async () => {};
