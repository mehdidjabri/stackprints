// The admin Worker's state in D1: one table of JSON values by key (migrations/0001_state.sql). Unlike
// KV, a write is read back at once from anywhere, and update() is a compare-and-swap on the row's
// version, so concurrent agents never lose each other's changes.
import { ContentionError, type ListOptions, type StateStore, UPDATE_TRIES } from "./state";

type Row = { v: string; ver: number; expires: number | null };

// Every key that starts with the prefix sorts from the prefix to just before prefix || char(0x10FFFF).
const RANGE = "k >= ?1 AND k < (?1 || char(1114111)) AND (expires IS NULL OR expires > ?2)";
const SWEEP_EVERY = 64;
const SWEEP_ROWS = 100;

/**
 * A fresh random version for every write rather than a counter: a row deleted and written again
 * must never match a version read before the delete.
 */
const nextVersion = () => crypto.getRandomValues(new Uint32Array(1))[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class D1State implements StateStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string) {
    const row = await this.db.prepare("SELECT v, expires FROM state WHERE k = ?1").bind(key).first<Row>();
    if (!row) return null;
    if (row.expires !== null && row.expires <= this.now()) {
      // Expired rows are invisible; the one in hand goes now, the rest with the next sweep.
      await this.db.prepare("DELETE FROM state WHERE k = ?1 AND expires <= ?2").bind(key, this.now()).run();
      return null;
    }
    return JSON.parse(row.v) as T;
  }

  async put(key: string, value: unknown, options?: { ttlSeconds?: number }) {
    const upsert = this.db
      .prepare("INSERT INTO state (k, v, ver, expires) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET v = excluded.v, ver = excluded.ver, expires = excluded.expires")
      .bind(key, encode(value), nextVersion(), this.expiry(options?.ttlSeconds));
    // One write in SWEEP_EVERY also clears some expired rows, in the same round trip.
    if (Math.random() < 1 / SWEEP_EVERY) await this.db.batch([upsert, this.sweepStatement()]);
    else await upsert.run();
  }

  async delete(key: string) {
    await this.db.prepare("DELETE FROM state WHERE k = ?1").bind(key).run();
  }

  async list(prefix: string, options?: ListOptions) {
    const { rows, cursor } = await this.range<{ k: string }>("k", prefix, options);
    return { keys: rows.map((r) => r.k), ...(cursor ? { cursor } : {}) };
  }

  async entries<T>(prefix: string, options?: ListOptions & { reverse?: boolean }) {
    const { rows, cursor } = await this.range<{ k: string; v: string }>("k, v", prefix, options);
    return { entries: rows.map((r) => [r.k, JSON.parse(r.v) as T] as [string, T]), ...(cursor ? { cursor } : {}) };
  }

  async update<T>(key: string, fn: (current: T | null) => T | null, options?: { ttlSeconds?: number }) {
    for (let attempt = 0; attempt < UPDATE_TRIES; attempt++) {
      if (attempt) await sleep(Math.random() * 5 * 2 ** attempt);
      const row = await this.db.prepare("SELECT v, ver, expires FROM state WHERE k = ?1").bind(key).first<Row>();
      const live = row && (row.expires === null || row.expires > this.now());
      const next = fn(live ? (JSON.parse(row.v) as T) : null);
      let changed: number;
      if (next === null) {
        if (!row) return null;
        changed = (await this.db.prepare("DELETE FROM state WHERE k = ?1 AND ver = ?2").bind(key, row.ver).run()).meta.changes;
      } else if (row) {
        changed = (
          await this.db
            .prepare("UPDATE state SET v = ?3, ver = ?4, expires = ?5 WHERE k = ?1 AND ver = ?2")
            .bind(key, row.ver, encode(next), nextVersion(), this.expiry(options?.ttlSeconds))
            .run()
        ).meta.changes;
      } else {
        changed = (
          await this.db
            .prepare("INSERT INTO state (k, v, ver, expires) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO NOTHING")
            .bind(key, encode(next), nextVersion(), this.expiry(options?.ttlSeconds))
            .run()
        ).meta.changes;
      }
      if (changed === 1) return next;
    }
    throw new ContentionError(key);
  }

  /** Deletes up to `limit` expired rows; put() runs it now and then. */
  async sweep(limit = SWEEP_ROWS) {
    return (await this.sweepStatement(limit).run()).meta.changes;
  }

  private sweepStatement(limit = SWEEP_ROWS) {
    return this.db.prepare("DELETE FROM state WHERE k IN (SELECT k FROM state WHERE expires <= ?1 LIMIT ?2)").bind(this.now(), limit);
  }

  private expiry(ttlSeconds?: number) {
    return ttlSeconds ? this.now() + ttlSeconds * 1000 : null;
  }

  /** One page of a prefix, one query: a row past the limit says whether there is a next page. */
  private async range<R extends { k: string }>(columns: string, prefix: string, options: ListOptions & { reverse?: boolean } = {}) {
    const limit = Number.isInteger(options.limit) && options.limit! > 0 ? options.limit! : 1000;
    const after = options.cursor === undefined ? "" : options.reverse ? "AND k < ?3" : "AND k > ?3";
    const sql = `SELECT ${columns} FROM state WHERE ${RANGE} ${after} ORDER BY k ${options.reverse ? "DESC" : "ASC"} LIMIT ${limit + 1}`;
    const binds: unknown[] = [prefix, this.now()];
    if (options.cursor !== undefined) binds.push(options.cursor);
    const { results } = await this.db.prepare(sql).bind(...binds).all<R>();
    const rows = results.slice(0, limit);
    return { rows, cursor: results.length > limit ? rows.at(-1)?.k : undefined };
  }
}

// JSON.stringify(undefined) is undefined, which the NOT NULL column would refuse.
const encode = (value: unknown) => JSON.stringify(value) ?? "null";
