// The admin Worker's ContentStore: the repository on GitHub, read and written through its REST API.
// A commit's files come from one tarball download and are kept by sha (a commit never changes), so
// a request reads main in one or two subrequests. Writes go through the Git Data API: a tree on top
// of the base commit's, a commit on the base, then main moved forward only if it is still the base
// (publish), or a new branch and a pull request (pr).
import { day } from "../core/content";
import { type Changes, type CommitInfo, type CommitResult, ConflictError, type ContentStore, type Correction, ProtectedBranchError, WRITABLE } from "../core/store";
import type { Files } from "../core/types";

/** Where answers that never change (a commit's files and details) are kept between requests: KV in the Worker. */
export type ShaCache = {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>;
};

export type GitHubStoreOptions = {
  /** "owner/name" */
  repo: string;
  /** A token that can write contents and pull requests on this one repository. */
  token: string;
  /** The branch publishes land on and pull requests target; default "main". */
  branch?: string;
  /** Keeps each commit's files and details between requests; they never change. */
  cache?: ShaCache;
  /** Author and committer of the commits written; default the token's own account. */
  committer?: { name: string; email: string };
  fetch?: typeof fetch;
  now?: () => number;
};

type CommitInput = Parameters<ContentStore["commit"]>[0];
type ApiCommit = { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null }; files?: { filename: string; previous_filename?: string }[] };
type ApiPull = { html_url: string; number: number };
type ApiIssue = { number: number; title: string; html_url: string; body?: string | null; created_at: string; labels?: (string | { name?: string })[]; pull_request?: unknown };

const API = "https://api.github.com";
const CONTENT_FILE = /^(content|docs)\/.+\.(json|md|svg)$/;
const SHA = /^[0-9a-f]{40}$/;
const FILES_TTL = 7 * 86400;
const COMMIT_TTL = 90 * 86400;
const IN_MEMORY = 4;
// GitHub lists a commit's files 300 a page and at most 3000 in all.
const MAX_COMMIT_FILES = 3000;
// A ruleset or branch protection refusing a direct push to the branch.
const PROTECTED = /rule violations?|protected branch|through a pull request|required status check|review is required/i;

/** Files by "repo@sha", shared by every store in this isolate. */
const memory = new Map<string, Promise<Files>>();

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

// What git accepts as a branch name, narrowed to plain characters.
const BRANCH = /^(?![/.-]|.*(?:\/\/|\.\.|@\{|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]+(?<![/.])$/;
const refPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

export class GitHubStore implements ContentStore {
  private readonly branch: string;
  private readonly get: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: GitHubStoreOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`repo must be "owner/name", not "${opts.repo}"`);
    if (!opts.token) throw new Error("GitHubStore needs a token");
    this.branch = opts.branch ?? "main";
    // Called unbound: Workers refuse a fetch called with another object as `this`.
    this.get = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
  }

  private request(method: string, url: string, body?: unknown) {
    return this.get(url.startsWith("https://") ? url : `${API}/repos/${this.opts.repo}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "stackprints-admin",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    return (await this.page<T>(method, url, body)).body;
  }

  /** One answer and the URL of the next page, when GitHub's Link header names one on its own API. */
  private async page<T>(method: string, url: string, body?: unknown): Promise<{ body: T; next?: string }> {
    const res = await this.request(method, url, body);
    if (!res.ok) throw await failure(res, `${method} ${url.replace(API, "")}`);
    return { body: (await res.json()) as T, next: nextPage(res.headers.get("link")) };
  }

  private commitUrl(sha: string) {
    return `https://github.com/${this.opts.repo}/commit/${sha}`;
  }

  async head() {
    return (await this.call<{ object: { sha: string } }>("GET", `/git/ref/heads/${refPath(this.branch)}`)).object.sha;
  }

  /** A full sha for a sha, a short sha or a branch. */
  private async resolve(rev: string) {
    if (SHA.test(rev)) return rev;
    try {
      return (await this.call<ApiCommit>("GET", `/commits/${encodeURIComponent(rev)}`)).sha;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) throw new Error(`no commit ${rev} in ${this.opts.repo}`);
      throw e;
    }
  }

  async files(sha?: string): Promise<Files> {
    const commit = sha ? await this.resolve(sha) : await this.head();
    const key = `${this.opts.repo}@${commit}`;
    let files = memory.get(key);
    if (!files) {
      const read = this.readFiles(commit);
      files = read;
      memory.set(key, read);
      read.catch(() => memory.get(key) === read && memory.delete(key));
      while (memory.size > IN_MEMORY) memory.delete(memory.keys().next().value!);
    }
    return new Map(await files);
  }

  private async readFiles(commit: string): Promise<Files> {
    const cacheKey = `gh-files:${this.opts.repo}:${commit}`;
    const cached = await this.opts.cache?.get<Record<string, string>>(cacheKey).catch(() => null);
    if (cached) return new Map(Object.entries(cached));
    const res = await this.request("GET", `/tarball/${commit}`);
    if (!res.ok || !res.body) throw await failure(res, `GET /tarball/${commit}`);
    const tar = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const files = untar(tar, (p) => CONTENT_FILE.test(p));
    // A failed cache write costs a download next time, nothing more.
    await this.opts.cache?.put(cacheKey, Object.fromEntries(files), { ttlSeconds: FILES_TTL }).catch(() => {});
    return files;
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const paths = Object.keys(input.changes);
    const refused = paths.filter((p) => !WRITABLE.test(p));
    if (refused.length) throw new Error(`refusing to write outside the content files: ${refused.join(", ")}`);
    if (!paths.length) throw new Error("nothing to commit: no changes");
    const base = await this.resolve(input.baseSha);
    if (input.mode === "publish" && (await this.head()) !== base) throw new ConflictError();

    const made = await this.commitOnto(base, input.changes, input.message);
    if (input.mode === "publish") {
      const res = await this.request("PATCH", `/git/refs/heads/${refPath(this.branch)}`, { sha: made.sha, force: false });
      if (!res.ok) {
        const err = await failure(res, `moving ${this.branch}`);
        // Not a fast-forward: main moved after the check above.
        if (res.status === 422 && /fast.?forward/i.test(err.message)) throw new ConflictError();
        if ((res.status === 422 || res.status === 403) && PROTECTED.test(err.message)) {
          throw new ProtectedBranchError(`${this.branch} takes changes only through pull requests (${err.message}); submit with mode pr`);
        }
        throw err;
      }
      return { mode: "publish", sha: made.sha, url: this.commitUrl(made.sha) };
    }
    return this.pullRequest(input, made);
  }

  /** A commit of `changes` on top of `base`, and its tree; the branch is not moved. */
  private async commitOnto(base: string, changes: Changes, message: string) {
    const [parent, current] = await Promise.all([this.call<{ tree: { sha: string } }>("GET", `/git/commits/${base}`), this.files(base)]);
    // Deleting a file the base doesn't have is already done; GitHub would reject the path.
    const tree = Object.entries(changes)
      .filter(([p, text]) => text !== null || current.has(p))
      .map(([path, text]) => (text === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content: text }));
    if (!tree.length) throw new Error("nothing to commit: every file to delete is already gone");
    const made = await this.call<{ sha: string }>("POST", "/git/trees", { base_tree: parent.tree.sha, tree });
    if (made.sha === parent.tree.sha) throw new Error("nothing to commit: the changes match the current content");
    const who = this.opts.committer && { ...this.opts.committer, date: new Date(this.now()).toISOString() };
    const commit = await this.call<{ sha: string }>("POST", "/git/commits", { message, tree: made.sha, parents: [base], ...(who ? { author: who, committer: who } : {}) });
    return { sha: commit.sha, tree: made.sha };
  }

  private async pullRequest(input: CommitInput, made: { sha: string; tree: string }): Promise<CommitResult> {
    const rand = [...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const branch = input.branch ?? `bot/${day(this.now())}-${rand}`;
    if (!BRANCH.test(branch) || branch === this.branch) throw new Error(`not a valid branch name: ${branch}`);
    const created = await this.request("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: made.sha });
    if (!created.ok) {
      const err = await failure(created, `creating ${branch}`);
      if (created.status === 422 && /exists/i.test(err.message)) return this.existingPullRequest(branch, made.tree);
      throw err;
    }
    try {
      const pr = await this.call<ApiPull>("POST", "/pulls", {
        title: input.prTitle ?? input.message.split("\n")[0],
        head: branch,
        base: this.branch,
        body: input.prBody ?? input.message,
      });
      return { mode: "pr", sha: made.sha, url: pr.html_url, number: pr.number, branch };
    } catch (e) {
      // Without its pull request the branch is litter, and it would block a retry under the same name.
      await this.request("DELETE", `/git/refs/heads/${refPath(branch)}`).catch(() => {});
      throw e;
    }
  }

  /**
   * A retry of a submit that got as far as its pull request (a timeout after GitHub answered): the
   * branch holds the same files and its pull request is open, so that is the answer. Anything else
   * under the name is someone else's work.
   */
  private async existingPullRequest(branch: string, tree: string): Promise<CommitResult> {
    const taken = new Error(`branch ${branch} already exists; pass another name`);
    const at = (await this.call<{ object: { sha: string } }>("GET", `/git/ref/heads/${refPath(branch)}`)).object.sha;
    const commit = await this.call<{ tree: { sha: string } }>("GET", `/git/commits/${at}`);
    if (commit.tree.sha !== tree) throw taken;
    const head = `${this.opts.repo.split("/")[0]}:${branch}`;
    const [pr] = await this.call<ApiPull[]>("GET", `/pulls?head=${encodeURIComponent(head)}&state=open&per_page=1`);
    if (!pr) throw taken;
    return { mode: "pr", sha: at, url: pr.html_url, number: pr.number, branch };
  }

  async history(limit = 20): Promise<CommitInfo[]> {
    const n = Math.min(100, Math.max(1, Math.floor(limit)));
    const list = await this.call<ApiCommit[]>("GET", `/commits?sha=${encodeURIComponent(this.branch)}&path=content&per_page=${n}`);
    return Promise.all(list.map((c) => this.commitInfo(c.sha)));
  }

  async commitInfo(sha: string): Promise<CommitInfo> {
    const full = await this.resolve(sha);
    const cacheKey = `gh-commit:${this.opts.repo}:${full}`;
    const cached = await this.opts.cache?.get<CommitInfo>(cacheKey).catch(() => null);
    if (cached) return cached;
    let c: ApiCommit;
    let next: string | undefined;
    try {
      ({ body: c, next } = await this.page<ApiCommit>("GET", `/commits/${full}`));
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) throw new Error(`no commit ${sha} in ${this.opts.repo}`);
      throw e;
    }
    // A big commit's files come 300 a page: a revert must see every one of them.
    const files = [...(c.files ?? [])];
    while (next && files.length < MAX_COMMIT_FILES) {
      const more = await this.page<ApiCommit>("GET", next);
      files.push(...(more.body.files ?? []));
      next = more.next;
    }
    const paths = [...new Set(files.slice(0, MAX_COMMIT_FILES).flatMap((f) => (f.previous_filename ? [f.previous_filename, f.filename] : [f.filename])))].sort();
    const info: CommitInfo = {
      sha: c.sha,
      message: c.commit.message.trim(),
      date: new Date(c.commit.author?.date ?? 0).toISOString(),
      url: c.html_url || this.commitUrl(c.sha),
      author: c.commit.author?.name ?? "",
      paths,
    };
    await this.opts.cache?.put(cacheKey, info, { ttlSeconds: COMMIT_TTL }).catch(() => {});
    return info;
  }

  async corrections(): Promise<Correction[]> {
    const list = await this.call<ApiIssue[]>("GET", "/issues?labels=correction&state=open&per_page=50");
    // The issues endpoint lists pull requests too.
    return list
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        url: i.html_url,
        body: i.body ?? "",
        createdAt: i.created_at,
        labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
      }));
  }
}

/** The rel="next" URL of a Link header, only when it points back at GitHub's API (it gets the token). */
function nextPage(link: string | null) {
  const next = link?.split(",").find((part) => /;\s*rel="?next"?/.test(part));
  const url = next?.match(/<([^>]+)>/)?.[1];
  try {
    return url && new URL(url).origin === API ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A GitHubError saying what failed, with GitHub's own message and, when it is one, the rate limit. */
async function failure(res: Response, what: string) {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string; errors?: { message?: string }[] };
    detail = [body.message, ...(body.errors ?? []).map((e) => e.message)]
      .filter((m): m is string => Boolean(m))
      .map((m) => m.replace(/\s+/g, " ").trim())
      .join("; ");
  } catch {}
  const limited = (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const hint = limited ? `; GitHub's rate limit is spent${reset ? ` until ${new Date(reset * 1000).toISOString()}` : ""}` : "";
  return new GitHubError(res.status, `GitHub ${what}: ${res.status}${detail ? ` ${detail}` : ""}${hint}`);
}

/**
 * The regular files in a tar archive whose path, less the archive's top folder (GitHub's
 * "<owner>-<repo>-<sha7>/"), passes `keep`. Reads ustar names with their prefix, pax `path`
 * records and GNU long names.
 */
export function untar(tar: Uint8Array, keep: (path: string) => boolean): Files {
  const text = new TextDecoder();
  const field = (h: Uint8Array, at: number, len: number) => {
    const raw = h.subarray(at, at + len);
    const end = raw.indexOf(0);
    return text.decode(end < 0 ? raw : raw.subarray(0, end));
  };
  const files: Files = new Map();
  let longName: string | undefined;
  for (let at = 0; at + 512 <= tar.length; ) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const size = Number.parseInt(field(h, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 0x30);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      longName = paxPath(text.decode(body)) ?? longName;
      continue;
    }
    if (type === "L") {
      longName = field(body, 0, body.length);
      continue;
    }
    if (type === "g") continue;
    const prefix = field(h, 257, 6).startsWith("ustar") ? field(h, 345, 155) : "";
    const name = longName ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    longName = undefined;
    if (type !== "0" && type !== "7") continue;
    const rel = name.split("/").slice(1).join("/");
    if (rel && keep(rel)) files.set(rel, text.decode(body));
  }
  return files;
}

/** The `path` record of a pax extended header ("<length> path=<value>\n" records). */
function paxPath(records: string) {
  for (let i = 0; i < records.length; ) {
    const space = records.indexOf(" ", i);
    const len = Number.parseInt(records.slice(i, space), 10);
    if (space < 0 || !len) break;
    // The length counts bytes, so a non-ASCII path needs the byte view.
    const bytes = new TextEncoder().encode(records.slice(i));
    const record = new TextDecoder().decode(bytes.subarray(0, len));
    const eq = record.indexOf("=");
    if (record.slice(record.indexOf(" ") + 1, eq) === "path") return record.slice(eq + 1, -1);
    i += record.length;
  }
  return undefined;
}
