// Small key-value state the admin server keeps besides the content itself: open changesets, fetched
// pages and their receipts, API keys and the audit log. D1 in production (d1-state.ts), a JSON file on
// this machine for the local server (file-state.ts), memory in tests. Workers KV only backs caches:
// it is eventually consistent, so a value written there may not be read back for a minute.

export type ListOptions = { limit?: number; cursor?: string };

export interface StateStore {
  get<T>(key: string): Promise<T | null>;
  /** `ttlSeconds` lets a value expire (fetched pages after 14 days); without it the value stays. */
  put(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys with a prefix in ascending order, `limit` at a time; pass the returned cursor for the next page. */
  list(prefix: string, options?: ListOptions): Promise<{ keys: string[]; cursor?: string }>;
  /** Keys with a prefix and their values, ascending (descending with `reverse`); the cursor is the last key returned. */
  entries<T>(prefix: string, options?: ListOptions & { reverse?: boolean }): Promise<{ entries: [string, T][]; cursor?: string }>;
  /**
   * Reads the key, passes its value (null when absent) to `fn` and writes what `fn` returns, or
   * deletes the key when it returns null, as one atomic step: when another write lands in between,
   * `fn` runs again on the new value (up to 8 times, then it throws). `fn` may throw to change
   * nothing; its error comes out unchanged. Like put, the value written lives `ttlSeconds`, or for
   * good without it. Returns what was written.
   */
  update<T>(key: string, fn: (current: T | null) => T | null, options?: { ttlSeconds?: number }): Promise<T | null>;
}

export const UPDATE_TRIES = 8;

export class ContentionError extends Error {
  constructor(key: string) {
    super(`state key ${key} kept changing while being updated (${UPDATE_TRIES} tries); try again`);
    this.name = "ContentionError";
  }
}

type Entry = { value: unknown; expires?: number };

const DEFAULT_LIMIT = 1000;

/** In-memory state for tests, and the base of the local file-backed store. */
export class MemoryState implements StateStore {
  protected data = new Map<string, Entry>();
  constructor(protected now: () => number = Date.now) {}

  async get<T>(key: string) {
    return this.read<T>(key);
  }
  async put(key: string, value: unknown, options?: { ttlSeconds?: number }) {
    this.write(key, value, options?.ttlSeconds);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list(prefix: string, options?: ListOptions) {
    const { entries, cursor } = this.page(prefix, options);
    return { keys: entries.map(([k]) => k), ...(cursor ? { cursor } : {}) };
  }
  async entries<T>(prefix: string, options?: ListOptions & { reverse?: boolean }) {
    const { entries, cursor } = this.page(prefix, options);
    return { entries: entries.map(([k, e]) => [k, structuredClone(e.value) as T] as [string, T]), ...(cursor ? { cursor } : {}) };
  }
  async update<T>(key: string, fn: (current: T | null) => T | null, options?: { ttlSeconds?: number }) {
    return this.change(key, fn, options?.ttlSeconds);
  }

  protected read<T>(key: string): T | null {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.expires !== undefined && e.expires <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return structuredClone(e.value) as T;
  }

  protected write(key: string, value: unknown, ttlSeconds?: number) {
    this.data.set(key, { value: structuredClone(value), ...(ttlSeconds ? { expires: this.now() + ttlSeconds * 1000 } : {}) });
  }

  /** Synchronous from read to write, so nothing else runs in between: atomic in one process. */
  protected change<T>(key: string, fn: (current: T | null) => T | null, ttlSeconds?: number): T | null {
    const next = fn(this.read<T>(key));
    if (next === null) this.data.delete(key);
    else this.write(key, next, ttlSeconds);
    return next;
  }

  private page(prefix: string, options: ListOptions & { reverse?: boolean } = {}) {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const now = this.now();
    const after = options.cursor;
    let live = [...this.data.entries()].filter(([k, e]) => k.startsWith(prefix) && (e.expires === undefined || e.expires > now));
    live.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (options.reverse) live.reverse();
    if (after !== undefined) live = live.filter(([k]) => (options.reverse ? k < after : k > after));
    const entries = live.slice(0, limit);
    return { entries, cursor: live.length > limit ? entries.at(-1)?.[0] : undefined };
  }
}

/**
 * Workers KV behind the same interface, for caches of values that never change (a commit's files).
 * Best effort: KV is eventually consistent, so update() is a plain read then write, not atomic, and
 * entries() costs a read per key. Keep anything that must be read back at once out of it.
 */
export class KvState implements StateStore {
  constructor(private kv: KVNamespace) {}
  async get<T>(key: string) {
    return (await this.kv.get(key, "json")) as T | null;
  }
  async put(key: string, value: unknown, options?: { ttlSeconds?: number }) {
    // KV's shortest expiry is 60 seconds.
    await this.kv.put(key, JSON.stringify(value), options?.ttlSeconds ? { expirationTtl: Math.max(60, options.ttlSeconds) } : undefined);
  }
  async delete(key: string) {
    await this.kv.delete(key);
  }
  async list(prefix: string, options?: ListOptions) {
    const r = await this.kv.list({ prefix, limit: options?.limit ?? DEFAULT_LIMIT, cursor: options?.cursor });
    return { keys: r.keys.map((k) => k.name), ...(r.list_complete ? {} : { cursor: r.cursor }) };
  }
  async entries<T>(prefix: string, options: ListOptions & { reverse?: boolean } = {}) {
    const limit = options.limit ?? DEFAULT_LIMIT;
    let keys: string[];
    let cursor: string | undefined;
    if (options.reverse) {
      // KV lists ascending only: read every key under the prefix, then page backwards by key.
      const all: string[] = [];
      let c: string | undefined;
      do {
        const r = await this.list(prefix, { cursor: c });
        all.push(...r.keys);
        c = r.cursor;
      } while (c);
      const before = all.reverse().filter((k) => options.cursor === undefined || k < options.cursor);
      keys = before.slice(0, limit);
      cursor = before.length > limit ? keys.at(-1) : undefined;
    } else {
      // KV's own cursor is opaque; ours is the last key, so list from the start and skip past it.
      const all: string[] = [];
      let c: string | undefined;
      do {
        const r = await this.list(prefix, { cursor: c });
        all.push(...r.keys.filter((k) => options.cursor === undefined || k > options.cursor));
        c = r.cursor;
      } while (c && all.length <= limit);
      keys = all.slice(0, limit);
      cursor = all.length > limit ? keys.at(-1) : undefined;
    }
    const values = await Promise.all(keys.map((k) => this.get<T>(k)));
    const entries = keys.flatMap((k, i) => (values[i] === null ? [] : [[k, values[i]] as [string, T]]));
    return { entries, ...(cursor ? { cursor } : {}) };
  }
  async update<T>(key: string, fn: (current: T | null) => T | null, options?: { ttlSeconds?: number }) {
    const next = fn(await this.get<T>(key));
    if (next === null) await this.delete(key);
    else await this.put(key, next, options);
    return next;
  }
}
