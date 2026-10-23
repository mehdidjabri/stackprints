// The state stores behind one contract (memory, the local JSON file, D1), then what only the file and
// D1 have to get right: several processes on one file, and compare-and-swap on contention.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1State } from "../src/core/d1-state";
import { FileState } from "../src/core/file-state";
import { ContentionError, MemoryState, type StateStore } from "../src/core/state";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const MIGRATION = fs.readFileSync(path.join(import.meta.dirname, "../migrations/0001_state.sql"), "utf8");

/** Lets other pending work run, as a round trip to D1 would. */
const tick = () => new Promise<void>((r) => setImmediate(r));

/** Enough of D1's binding over node:sqlite: prepare, bind, first, all, run and batch, with D1's result shapes. */
class FakeD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(MIGRATION);
  }
  prepare(sql: string) {
    return new FakeStatement(this, sql, []);
  }
  async batch(statements: FakeStatement[]) {
    await tick();
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((s) => s.runNow());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

class FakeStatement {
  constructor(
    private readonly db: FakeD1,
    private readonly sql: string,
    private readonly values: unknown[],
  ) {}
  bind(...values: unknown[]) {
    // D1 refuses undefined; so does this, to catch a missing value.
    if (values.some((v) => v === undefined)) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    return new FakeStatement(this.db, this.sql, values);
  }
  private get statement() {
    return this.db.sqlite.prepare(this.sql);
  }
  private get args() {
    return this.values as (string | number | null)[];
  }
  async first<T>(column?: string) {
    await tick();
    const row = this.statement.get(...this.args) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }
  async all<T>() {
    await tick();
    const results = this.statement.all(...this.args).map((r) => ({ ...r })) as T[];
    return { success: true as const, results, meta: meta(0) };
  }
  async run() {
    await tick();
    return this.runNow();
  }
  runNow() {
    const info = this.statement.run(...this.args);
    return { success: true as const, results: [], meta: meta(Number(info.changes), Number(info.lastInsertRowid)) };
  }
}

const meta = (changes: number, lastRowId = 0) => ({ duration: 0, size_after: 0, rows_read: 0, rows_written: changes, last_row_id: lastRowId, changed_db: changes > 0, changes });

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-state-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

type Make = (now: () => number) => StateStore;
const stores: [string, Make][] = [
  ["MemoryState", (now) => new MemoryState(now)],
  ["FileState", (now) => new FileState(path.join(tmp, "nested", "state.json"), now)],
  ["D1State", (now) => new D1State(new FakeD1() as unknown as D1Database, now)],
];

describe.each(stores)("%s", (_name, make) => {
  let now: number;
  let s: StateStore;
  beforeEach(() => {
    now = NOW;
    s = make(() => now);
  });

  it("gets what was put, as a copy, and forgets what was deleted", async () => {
    const value = { name: "one", tags: ["a"] };
    await s.put("apikey:1", value);
    value.tags.push("mutated");
    const read = await s.get<typeof value>("apikey:1");
    expect(read).toEqual({ name: "one", tags: ["a"] });
    read!.tags.push("again");
    expect(await s.get("apikey:1")).toEqual({ name: "one", tags: ["a"] });
    await s.put("apikey:1", "replaced");
    expect(await s.get("apikey:1")).toBe("replaced");
    await s.delete("apikey:1");
    expect(await s.get("apikey:1")).toBeNull();
    expect(await s.get("never")).toBeNull();
  });

  it("lets a value expire: gone from get, list and entries", async () => {
    await s.put("page:short", "x", { ttlSeconds: 60 });
    await s.put("page:long", "y", { ttlSeconds: 3600 });
    await s.put("page:kept", "z");
    now += 61_000;
    expect(await s.get("page:short")).toBeNull();
    expect((await s.list("page:")).keys).toEqual(["page:kept", "page:long"]);
    expect((await s.entries("page:")).entries).toEqual([
      ["page:kept", "z"],
      ["page:long", "y"],
    ]);
    // Written again, it lives again.
    await s.put("page:short", "x2");
    expect(await s.get("page:short")).toBe("x2");
  });

  it("lists a prefix and nothing beside it, a page at a time, both ways", async () => {
    for (const k of ["a:3", "a:1", "a:5", "a:2", "a:4", "a", "a;", "a-1", "b:1", "a:\u00e9"]) await s.put(k, k.toUpperCase());
    expect((await s.list("a:")).keys).toEqual(["a:1", "a:2", "a:3", "a:4", "a:5", "a:\u00e9"]);

    const first = await s.entries<string>("a:", { limit: 2 });
    expect(first).toEqual({ entries: [["a:1", "A:1"], ["a:2", "A:2"]], cursor: "a:2" });
    const second = await s.entries<string>("a:", { limit: 2, cursor: first.cursor });
    expect(second).toEqual({ entries: [["a:3", "A:3"], ["a:4", "A:4"]], cursor: "a:4" });
    const last = await s.entries<string>("a:", { limit: 2, cursor: second.cursor });
    expect(last).toEqual({ entries: [["a:5", "A:5"], ["a:\u00e9", "A:\u00c9"]] });

    const back = await s.entries<string>("a:", { limit: 4, reverse: true });
    expect(back.entries.map(([k]) => k)).toEqual(["a:\u00e9", "a:5", "a:4", "a:3"]);
    expect(back.cursor).toBe("a:3");
    expect(await s.entries<string>("a:", { limit: 4, reverse: true, cursor: back.cursor })).toEqual({ entries: [["a:2", "A:2"], ["a:1", "A:1"]] });

    const keys = await s.list("a:", { limit: 5 });
    expect(keys).toEqual({ keys: ["a:1", "a:2", "a:3", "a:4", "a:5"], cursor: "a:5" });
    expect(await s.list("a:", { cursor: keys.cursor })).toEqual({ keys: ["a:\u00e9"] });
    expect((await s.list("")).keys).toHaveLength(10);
    expect(await s.entries("zzz")).toEqual({ entries: [] });
  });

  it("updates in one step: creates, changes, and deletes on null", async () => {
    expect(await s.update<{ n: number }>("count", (c) => ({ n: (c?.n ?? 0) + 1 }))).toEqual({ n: 1 });
    expect(await s.update<{ n: number }>("count", (c) => ({ n: c!.n + 1 }))).toEqual({ n: 2 });
    expect(await s.get("count")).toEqual({ n: 2 });
    expect(await s.update("count", () => null)).toBeNull();
    expect(await s.get("count")).toBeNull();
    expect(await s.update("absent", () => null)).toBeNull();
    expect(await s.get("absent")).toBeNull();
  });

  it("passes an expired value to update as absent, and expires what update writes with its ttl", async () => {
    await s.put("cs:1", { v: 1 }, { ttlSeconds: 60 });
    now += 61_000;
    expect(await s.update<{ v: number }>("cs:1", (c) => ({ v: c ? c.v + 1 : 100 }), { ttlSeconds: 60 })).toEqual({ v: 100 });
    now += 30_000;
    expect(await s.get("cs:1")).toEqual({ v: 100 });
    now += 31_000;
    expect(await s.get("cs:1")).toBeNull();
  });

  it("lets update's function abort with its own error, changing nothing", async () => {
    await s.put("cs:1", { status: "open" });
    const refusal = new Error("already submitted");
    await expect(
      s.update("cs:1", (c) => {
        (c as { status: string }).status = "mutated";
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(await s.get("cs:1")).toEqual({ status: "open" });
  });

  it("loses no update when they run at once", async () => {
    await Promise.all(Array.from({ length: 10 }, () => s.update<number>("n", (n) => (n ?? 0) + 1)));
    expect(await s.get("n")).toBe(10);
  });
});

describe("D1State", () => {
  it("runs update's function again when another write lands between its read and its write", async () => {
    const db = new FakeD1();
    const s = new D1State(db as unknown as D1Database, () => NOW);
    await s.put("n", 1);
    let calls = 0;
    const result = await s.update<number>("n", (n) => {
      // Someone else's write, after this read and before this write.
      if (++calls === 1) db.sqlite.prepare("UPDATE state SET v = '10', ver = ver + 1 WHERE k = 'n'").run();
      return n! + 1;
    });
    expect(calls).toBe(2);
    expect(result).toBe(11);
    expect(await s.get("n")).toBe(11);
  });

  it("runs it again when another process creates the key first, and when it deletes it", async () => {
    const db = new FakeD1();
    const s = new D1State(db as unknown as D1Database, () => NOW);
    const seen: (number | null)[] = [];
    await s.update<number>("k", (n) => {
      seen.push(n);
      if (seen.length === 1) db.sqlite.prepare("INSERT INTO state (k, v) VALUES ('k', '5')").run();
      return (n ?? 0) + 1;
    });
    expect(seen).toEqual([null, 5]);
    expect(await s.get("k")).toBe(6);

    seen.length = 0;
    await s.update<number>("k", (n) => {
      seen.push(n);
      if (seen.length === 1) db.sqlite.prepare("DELETE FROM state WHERE k = 'k'").run();
      return (n ?? 0) + 100;
    });
    expect(seen).toEqual([6, null]);
    expect(await s.get("k")).toBe(100);
  });

  it("gives up with a ContentionError when the key never holds still", async () => {
    const db = new FakeD1();
    const s = new D1State(db as unknown as D1Database, () => NOW);
    await s.put("hot", 0);
    let calls = 0;
    const error = await s
      .update<number>("hot", (n) => {
        calls++;
        db.sqlite.prepare("UPDATE state SET ver = ver + 1 WHERE k = 'hot'").run();
        return n! + 1;
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ContentionError);
    expect(calls).toBe(8);
    expect(await s.get("hot")).toBe(0);
  });

  it("deletes an expired row when it is read, and sweeps the others", async () => {
    let now = NOW;
    const db = new FakeD1();
    const s = new D1State(db as unknown as D1Database, () => now);
    for (let i = 0; i < 5; i++) await s.put(`page:${i}`, i, { ttlSeconds: 60 });
    await s.put("keep", 1);
    now += 61_000;
    const rows = () => (db.sqlite.prepare("SELECT count(*) AS n FROM state").get() as { n: number }).n;
    expect(await s.get("page:0")).toBeNull();
    expect(rows()).toBe(5);
    expect(await s.sweep()).toBe(4);
    expect(rows()).toBe(1);
  });

  it("reads one round trip per page of entries", async () => {
    const db = new FakeD1();
    const s = new D1State(db as unknown as D1Database, () => NOW);
    for (let i = 0; i < 30; i++) await s.put(`audit:${String(i).padStart(2, "0")}`, { i });
    const prepare = vi.spyOn(db, "prepare");
    const page = await s.entries<{ i: number }>("audit:", { limit: 25, reverse: true });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(page.entries).toHaveLength(25);
    expect(page.entries[0]).toEqual(["audit:29", { i: 29 }]);
  });
});

describe("FileState with several processes on one file", () => {
  let file: string;
  beforeEach(() => {
    file = path.join(tmp, "state", "admin-state.json");
  });

  it("keeps each instance's keys: every read looks at the file again", async () => {
    const a = new FileState(file, () => NOW);
    const b = new FileState(file, () => NOW);
    await a.put("apikey:a", { name: "from a" });
    await a.put("changeset:a", { id: "a" });
    await b.put("changeset:b", { id: "b" });
    expect(await a.get("changeset:b")).toEqual({ id: "b" });
    expect((await b.list("changeset:")).keys).toEqual(["changeset:a", "changeset:b"]);
    await b.delete("changeset:a");
    expect(await a.get("changeset:a")).toBeNull();

    const fresh = new FileState(file, () => NOW);
    expect((await fresh.list("")).keys).toEqual(["apikey:a", "changeset:b"]);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8"))).sort()).toEqual(["apikey:a", "changeset:b"]);
  });

  it("updates atomically across instances", async () => {
    const a = new FileState(file, () => NOW);
    const b = new FileState(file, () => NOW);
    const bump = (s: FileState) => s.update<number>("n", (n) => (n ?? 0) + 1);
    await Promise.all([...Array.from({ length: 10 }, () => bump(a)), ...Array.from({ length: 10 }, () => bump(b))]);
    expect(await a.get("n")).toBe(20);
    expect(await new FileState(file, () => NOW).get("n")).toBe(20);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("leaves the file as it was when an update aborts, and still saves the rest of the burst", async () => {
    const a = new FileState(file, () => NOW);
    await a.put("cs:1", "open");
    const before = fs.readFileSync(file, "utf8");
    const refusal = new Error("no");
    await expect(
      a.update("cs:1", () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(fs.readFileSync(file, "utf8")).toBe(before);

    const results = await Promise.allSettled([
      a.put("x", 1),
      a.update("cs:1", () => {
        throw refusal;
      }),
      a.put("y", 2),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ "cs:1": { value: "open" }, x: { value: 1 }, y: { value: 2 } });
  });

  it("parses the file only when it changed", async () => {
    const a = new FileState(file, () => NOW);
    await a.put("k", 1);
    const parse = vi.spyOn(JSON, "parse");
    for (let i = 0; i < 5; i++) await a.get("k");
    expect(parse).not.toHaveBeenCalled();
    await new FileState(file, () => NOW).put("k", 2);
    parse.mockClear();
    expect(await a.get("k")).toBe(2);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("waits for another process's lock", async () => {
    const a = new FileState(file, () => NOW);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.lock`, "999999\n");
    let done = false;
    const put = a.put("k", "v").then(() => (done = true));
    await new Promise((r) => setTimeout(r, 100));
    expect(done).toBe(false);
    fs.rmSync(`${file}.lock`);
    await put;
    expect(await new FileState(file, () => NOW).get("k")).toBe("v");
  });

  it("breaks a lock left by a process that died, and gives up on a live one in time", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.lock`, "999999\n");
    const old = new Date(Date.now() - 20_000);
    fs.utimesSync(`${file}.lock`, old, old);
    const a = new FileState(file, () => NOW);
    await a.put("k", "v");
    expect(fs.existsSync(`${file}.lock`)).toBe(false);

    fs.writeFileSync(`${file}.lock`, "999999\n");
    const impatient = new FileState(file, () => NOW, { lockWaitMs: 100 });
    await expect(impatient.put("k", "w")).rejects.toThrow(/stayed locked by another process/);
    expect(await impatient.get("k")).toBe("v");
  });

  it("stops at a file damaged after it started, rather than overwrite it", async () => {
    const a = new FileState(file, () => NOW);
    await a.put("apikey:1", "keep me");
    fs.writeFileSync(file, "{ not json");
    await expect(a.get("apikey:1")).rejects.toThrow(/not valid JSON/);
    await expect(a.put("other", 1)).rejects.toThrow(/not valid JSON/);
    expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
  });
});
