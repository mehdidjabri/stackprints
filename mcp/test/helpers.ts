// Shared by the tests: the real repository content as fixtures, an in-memory ContentStore with
// commits and pull requests, and an MCP client wired straight to a server factory over HTTP.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { MapApi } from "../src/core/api";
import type { AdminDeps, PublicDeps } from "../src/core/deps";
import { MemoryState } from "../src/core/state";
import { type Changes, type CommitInfo, type CommitResult, ConflictError, type ContentStore, type Correction } from "../src/core/store";
import type { Files, Principal } from "../src/core/types";

export const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * The commit the content fixtures are read from. The agents this server serves change content/ every
 * day; pinned fixtures keep a routine publish from failing the tests (and with them the deploy).
 * Move it forward on purpose, together with the tests that read specific values.
 */
export const FIXTURE_SHA = "1224ca8479213a6829926cf3a575dacb8538e530";

const CONTENT_FILE = /\.(json|svg|md)$/;
let fixtures: Files | undefined;

/** content/** and docs/** at FIXTURE_SHA, or from the working tree, with a warning, when this clone lacks that commit. */
export function repoFiles(): Files {
  fixtures ??= filesAt(FIXTURE_SHA) ?? workingTreeFiles();
  return new Map(fixtures);
}

/** One listing and one cat-file for the whole tree, as FsStore reads it; null when git can't. */
function filesAt(sha: string): Files | null {
  // A git hook's variables would point these commands at another repository.
  const env = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[k];
  const git = (args: string[], input?: string) => execFileSync("git", args, { cwd: ROOT, env, input, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  let listing: string;
  try {
    listing = git(["ls-tree", "-r", "-z", sha, "--", "content", "docs"]).toString("utf8");
  } catch (e) {
    // In CI a missing commit is an error: reading live content would let content edits fail the tests again.
    if (process.env.CI) throw new Error(`Fixture commit ${sha} is not in this clone: check out with fetch-depth: 0`);
    console.warn(`Fixture commit ${sha} is not in this clone (${(e as Error).message.split("\n")[0]}): the tests read content/ and docs/ from the working tree, so content edits can break them. Fetch the full history (git fetch --unshallow; fetch-depth: 0 in CI).`);
    return null;
  }
  const blobs: { oid: string; path: string }[] = [];
  for (const entry of listing.split("\0")) {
    const m = /^10(?:0644|0755) blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
    if (m && CONTENT_FILE.test(m[2])) blobs.push({ oid: m[1], path: m[2] });
  }
  const out = git(["cat-file", "--batch"], `${blobs.map((b) => b.oid).join("\n")}\n`);
  const files: Files = new Map();
  let at = 0;
  for (const blob of blobs) {
    const eol = out.indexOf(0x0a, at);
    const size = Number(out.subarray(at, eol).toString("utf8").split(" ")[2]);
    files.set(blob.path, out.subarray(eol + 1, eol + 1 + size).toString("utf8"));
    at = eol + 1 + size + 1;
  }
  return files;
}

function workingTreeFiles(): Files {
  const files: Files = new Map();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (CONTENT_FILE.test(e.name)) files.set(p, fs.readFileSync(path.join(ROOT, p), "utf8"));
    }
  };
  walk("content");
  walk("docs");
  return files;
}

/** The site's built JSON API from out/ (run `npm run build` at the root first), keyed like "/api/stacks.json". */
export function builtApi(): Record<string, unknown> {
  const out = path.join(ROOT, "out");
  const map: Record<string, unknown> = {};
  if (!fs.existsSync(path.join(out, "api"))) return map;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(out, dir), { withFileTypes: true })) {
      const p = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) map[`/${p}`] = JSON.parse(fs.readFileSync(path.join(out, p), "utf8"));
    }
  };
  walk("api");
  if (fs.existsSync(path.join(out, "search.json"))) map["/search.json"] = JSON.parse(fs.readFileSync(path.join(out, "search.json"), "utf8"));
  return map;
}

type Commit = { sha: string; parent: string | null; files: Files; message: string; date: string; paths: string[] };

/** A repository in memory: main, branches, pull requests and correction issues, enough for the admin tools. */
export class MemoryStore implements ContentStore {
  commits = new Map<string, Commit>();
  branches = new Map<string, string>();
  pulls: { number: number; branch: string; title: string; body: string; sha: string }[] = [];
  /** Open correction issues, newest first, as corrections() returns them. */
  issues: Correction[] = [];
  private n = 0;
  constructor(files: Files) {
    const sha = this.sha();
    this.commits.set(sha, { sha, parent: null, files: new Map(files), message: "initial", date: new Date(0).toISOString(), paths: [...files.keys()] });
    this.branches.set("main", sha);
  }
  private sha() {
    return (++this.n).toString(16).padStart(40, "0");
  }
  async head() {
    return this.branches.get("main")!;
  }
  async files(sha?: string) {
    const c = this.commits.get(sha ?? (await this.head()));
    if (!c) throw new Error(`no commit ${sha}`);
    return new Map(c.files);
  }
  /** Commits straight onto main, as a person pushing would. */
  push(changes: Changes, message = "outside change") {
    const parent = this.branches.get("main")!;
    const sha = this.apply(parent, changes, message);
    this.branches.set("main", sha);
    return sha;
  }
  private apply(parent: string, changes: Changes, message: string) {
    const files = new Map(this.commits.get(parent)!.files);
    for (const [p, t] of Object.entries(changes)) t === null ? files.delete(p) : files.set(p, t);
    const sha = this.sha();
    this.commits.set(sha, { sha, parent, files, message, date: new Date().toISOString(), paths: Object.keys(changes) });
    return sha;
  }
  async commit(input: { baseSha: string; changes: Changes; message: string; mode: "publish" | "pr"; branch?: string; prTitle?: string; prBody?: string }): Promise<CommitResult> {
    if (!this.commits.has(input.baseSha)) throw new Error(`no commit ${input.baseSha}`);
    if (input.mode === "publish") {
      if (this.branches.get("main") !== input.baseSha) throw new ConflictError();
      const sha = this.apply(input.baseSha, input.changes, input.message);
      this.branches.set("main", sha);
      return { mode: "publish", sha, url: `memory://commit/${sha}` };
    }
    const branch = input.branch ?? `bot/${this.n}`;
    const sha = this.apply(input.baseSha, input.changes, input.message);
    this.branches.set(branch, sha);
    const number = this.pulls.length + 1;
    this.pulls.push({ number, branch, title: input.prTitle ?? input.message.split("\n")[0], body: input.prBody ?? "", sha });
    return { mode: "pr", sha, url: `memory://pull/${number}`, number, branch };
  }
  async history(limit = 20): Promise<CommitInfo[]> {
    const out: CommitInfo[] = [];
    let c = this.commits.get(this.branches.get("main")!);
    while (c && out.length < limit) {
      out.push(this.info(c));
      c = c.parent ? this.commits.get(c.parent) : undefined;
    }
    return out;
  }
  async commitInfo(sha: string) {
    const c = this.commits.get(sha);
    if (!c) throw new Error(`no commit ${sha}`);
    return this.info(c);
  }
  private info(c: Commit): CommitInfo {
    return { sha: c.sha, message: c.message, date: c.date, url: `memory://commit/${c.sha}`, author: "test", paths: c.paths };
  }
  async corrections() {
    return structuredClone(this.issues);
  }
  /** The parent of a commit, for revert tests. */
  parentOf(sha: string) {
    return this.commits.get(sha)?.parent ?? null;
  }
}

export const OWNER: Principal = { name: "tester", kind: "local", scopes: ["content:read", "content:write", "content:publish", "keys:manage"] };

export function publicDeps(over: Partial<PublicDeps> = {}): PublicDeps {
  const files = repoFiles();
  return {
    api: new MapApi(builtApi()),
    files: async () => files,
    now: () => Date.parse("2026-10-22T12:00:00Z"),
    siteUrl: "https://stackprints.com",
    repo: "https://github.com/stackprints/stackprints",
    fetch: async () => new Response("not in tests", { status: 599 }),
    ...over,
  };
}

/** Admin deps over a MemoryStore of the real content. `pages` answers fetchPage by URL. */
export function adminDeps(over: Partial<AdminDeps> & { pages?: Record<string, { title?: string; text: string; published?: string }> } = {}) {
  const store = new MemoryStore(repoFiles());
  const state = new MemoryState(() => Date.parse("2026-10-22T12:00:00Z"));
  const { pages = {}, ...rest } = over;
  const deps: AdminDeps = {
    ...publicDeps(),
    files: async () => store.files(),
    store,
    state,
    principal: OWNER,
    fetchPage: async (url) => {
      const p = pages[url];
      if (!p) throw new Error(`no page for ${url} in this test`);
      return { url, finalUrl: url, status: 200, title: p.title ?? null, published: p.published ?? null, text: p.text, via: "direct" };
    },
    ...rest,
  };
  return { deps, store, state };
}

/** A connected MCP client for a server factory, over the real HTTP handler. */
export async function connect(factory: () => McpServer) {
  const handler = createMcpHandler(factory);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) }));
  return client;
}

/** Calls a tool and returns its structured result, throwing with the text when it's an error. */
export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${(r.content as { text: string }[]).map((c) => c.text).join("\n")}`);
  return r.structuredContent as Record<string, any>;
}
