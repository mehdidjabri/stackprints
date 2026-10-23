// The local server's state: MemoryState kept in a JSON file, so API keys, open changesets and fetched
// pages survive a restart. Every Claude Code session starts its own local server, so several processes
// may share the file: each read looks at the file again (parsing it only when it changed), and each
// write takes an exclusive lock file, re-reads, applies its change and rewrites the whole file through
// a temporary file and a rename, so a crash leaves the old state or the new one, never half of either,
// and no process drops another's keys. Node only.
import fs from "node:fs";
import path from "node:path";
import { type ListOptions, MemoryState } from "./state";

type Entry = { value: unknown; expires?: number };

export type FileStateOptions = {
  /** How long a write waits for another process's lock before failing; default 3 s. */
  lockWaitMs?: number;
  /** A lock older than this was left by a process that died holding it, and is broken; default 10 s. */
  staleLockMs?: number;
};

const expired = (e: Entry, now: number) => e.expires !== undefined && e.expires <= now;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parse(file: string, text: string): Record<string, Entry> {
  // Starting empty would let the next save wipe the API keys, so a damaged file stops the server instead.
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`state file ${file} is not valid JSON (${(e as Error).message}); fix or remove it`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`state file ${file} is not a JSON object; fix or remove it`);
  return data as Record<string, Entry>;
}

async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.tmp`;
  // Key hashes and fetched pages: nobody else on the machine needs to read them.
  await fs.promises.writeFile(tmp, text, { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}

type Op = { run: () => unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void };

export class FileState extends MemoryState {
  readonly lockFile: string;
  /** mtime, size and inode of the file as last parsed: "" for not read yet, "none" for no file. */
  private stamp = "";
  private queue: Op[] = [];
  private flushing = false;
  private readonly lockWaitMs: number;
  private readonly staleLockMs: number;

  constructor(
    readonly file: string,
    now: () => number = Date.now,
    options: FileStateOptions = {},
  ) {
    super(now);
    this.lockFile = `${file}.lock`;
    this.lockWaitMs = options.lockWaitMs ?? 3000;
    this.staleLockMs = options.staleLockMs ?? 10_000;
    this.refresh();
  }

  override async get<T>(key: string) {
    this.refresh();
    return super.get<T>(key);
  }
  override async list(prefix: string, options?: ListOptions) {
    this.refresh();
    return super.list(prefix, options);
  }
  override async entries<T>(prefix: string, options?: ListOptions & { reverse?: boolean }) {
    this.refresh();
    return super.entries<T>(prefix, options);
  }
  override async put(key: string, value: unknown, options?: { ttlSeconds?: number }) {
    await this.locked(() => this.write(key, value, options?.ttlSeconds));
  }
  override async delete(key: string) {
    await this.locked(() => this.data.delete(key));
  }
  override async update<T>(key: string, fn: (current: T | null) => T | null, options?: { ttlSeconds?: number }) {
    return this.locked(() => this.change(key, fn, options?.ttlSeconds));
  }

  /** Loads the file again if another process (or this one) rewrote it since the last read. */
  private refresh() {
    let fd: number;
    try {
      fd = fs.openSync(this.file, "r");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (this.stamp !== "none") this.data = new Map();
      this.stamp = "none";
      return;
    }
    try {
      const st = fs.fstatSync(fd);
      const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
      if (stamp === this.stamp) return;
      const now = this.now();
      const data = new Map<string, Entry>();
      for (const [key, entry] of Object.entries(parse(this.file, fs.readFileSync(fd, "utf8")))) {
        if (entry && typeof entry === "object" && !expired(entry, now)) data.set(key, entry);
      }
      this.data = data;
      this.stamp = stamp;
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Runs a change under the lock on the freshest state and saves it. Changes queued while the lock
   * is taken share it, so a burst of puts (a page recorded under two URLs, a changeset and its audit
   * entry) costs one write.
   */
  private locked<T>(run: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve: resolve as (v: unknown) => void, reject });
      if (!this.flushing) {
        this.flushing = true;
        void this.flush();
      }
    });
  }

  private async flush() {
    try {
      while (this.queue.length) {
        try {
          await this.lock();
        } catch (e) {
          for (const op of this.queue.splice(0)) op.reject(e);
          return;
        }
        const batch = this.queue.splice(0);
        const done: { op: Op; value: unknown }[] = [];
        let failure: { error: unknown } | undefined;
        try {
          this.refresh();
          for (const op of batch) {
            try {
              done.push({ op, value: op.run() });
            } catch (e) {
              // An update that threw changed nothing; the others still save.
              op.reject(e);
            }
          }
          if (done.length) await this.save();
        } catch (e) {
          // Memory may now hold changes the file doesn't: read the file again next time.
          this.stamp = "";
          failure = { error: e };
        }
        // Released before anyone hears back, so a caller that goes on finds the file free.
        await fs.promises.rm(this.lockFile, { force: true }).catch(() => {});
        if (failure) for (const op of batch) op.reject(failure.error);
        else for (const { op, value } of done) op.resolve(value);
      }
    } finally {
      // Set in the same step as the empty-queue check, so a change queued after it starts a new flush.
      this.flushing = false;
    }
  }

  private async save() {
    const now = this.now();
    const live: Record<string, Entry> = {};
    for (const [key, entry] of this.data) if (!expired(entry, now)) live[key] = entry;
    await writeAtomic(this.file, JSON.stringify(live));
    const st = await fs.promises.stat(this.file);
    this.stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
  }

  /** Creates the lock file, which only one process can do; waits for another holder, breaks a dead one's. */
  private async lock() {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        const handle = await fs.promises.open(this.lockFile, "wx", 0o600);
        await handle.writeFile(`${process.pid}\n`).finally(() => handle.close());
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      const held = await fs.promises.stat(this.lockFile).catch(() => null);
      if (held && Date.now() - held.mtimeMs > this.staleLockMs) {
        await fs.promises.rm(this.lockFile, { force: true });
        continue;
      }
      if (Date.now() - started > this.lockWaitMs)
        throw new Error(`state file ${this.file} stayed locked by another process for ${this.lockWaitMs} ms; if no other stackprints server is running, delete ${this.lockFile}`);
      await sleep(5 + Math.random() * 20);
    }
  }
}
