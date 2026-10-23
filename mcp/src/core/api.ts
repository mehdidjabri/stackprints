// The site's own JSON API (/api/*.json, /search.json, built by lib/agent.ts) is what the read tools
// return, so an agent sees exactly what the site shows. Embedded in the public Worker, fetched from
// the live site by the admin Worker, read from out/ by the local servers.

export interface ApiSource {
  /** A site path such as "/api/stacks.json" or "/search.json"; null when it doesn't exist. */
  json<T>(path: string): Promise<T | null>;
}

/** Paths to parsed JSON, from the bundle scripts/bundle.mjs writes at deploy time. */
export class MapApi implements ApiSource {
  constructor(private map: Record<string, unknown>) {}
  async json<T>(path: string) {
    return (this.map[path] as T | undefined) ?? null;
  }
}

/** Fetched from a running site, cached for five minutes per isolate. */
export class FetchApi implements ApiSource {
  private cache = new Map<string, { at: number; value: unknown }>();
  constructor(
    private base: string,
    private doFetch: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  async json<T>(path: string) {
    const hit = this.cache.get(path);
    if (hit && this.now() - hit.at < 300_000) return hit.value as T | null;
    const r = await this.doFetch(new URL(path, this.base).toString(), { headers: { accept: "application/json" } });
    const value = r.ok ? ((await r.json()) as T) : null;
    if (r.ok || r.status === 404) this.cache.set(path, { at: this.now(), value });
    return value;
  }
}
