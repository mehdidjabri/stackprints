// The local admin server's ContentStore: this machine's checkout, read and written with git. Reads come
// from commits, never the working tree, so they match what the GitHub store would serve. Every commit
// is built in a temporary index. A publish then moves the branch only if it is still the base (so
// another server or the person committing meanwhile is a conflict, never a lost commit) and brings just
// the paths it changed up to date in the index and working tree, refusing to touch a file the person
// is editing. A pull request leaves the working tree, the index and HEAD where they are.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { day } from "../core/content";
import { type Changes, type CommitInfo, type CommitResult, ConflictError, type ContentStore, type Correction, WRITABLE, WrongBranchError } from "../core/store";
import type { Files } from "../core/types";

export type FsStoreOptions = {
  /** The repository root. */
  root: string;
  /** The branch publishes land on; default: the branch checked out when the store is first used. */
  branch?: string;
  /** e.g. https://github.com/mehdidjabri/stackprints, for commit URLs. */
  remoteUrl?: string;
  /** The GitHub CLI that opens pull requests; default "gh" on PATH. */
  gh?: string;
  now?: () => number;
  /** Where to say what went wrong after the fact, such as a pull request not opened (stderr for a stdio server; never stdout). */
  log?: (message: string) => void;
};

type CommitInput = Parameters<ContentStore["commit"]>[0];
/** What a commit wrote, by path: the blob and its text, or null for a deletion. */
type Blobs = Map<string, { oid: string; text: string } | null>;
type RunOptions = { input?: string; env?: Record<string, string>; timeout?: number };

const TREES = ["content", "docs"];
const CONTENT_FILE = /\.(json|md|svg)$/;
// Each commit starts with \x1e and its header ends with \x1d, so the paths --name-only -z lists after it split cleanly.
const LOG_FORMAT = "--format=%x1e%H%x1f%an%x1f%aI%x1f%B%x1d";
const CACHED_COMMITS = 8;
const MAX_OUTPUT = 512 * 1024 * 1024;
const NETWORK_TIMEOUT = 60_000;

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | string | null,
    readonly stderr: string,
  ) {
    super(`${command} failed${stderr ? `: ${stderr}` : code !== null ? ` (${code})` : ""}`);
    this.name = "CommandError";
  }
}

// Variables a git hook may have set would point every command at another index or repository.
function childEnv(extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", ...extra };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) if (!(k in extra)) delete env[k];
  return env;
}

/** Runs a program without a shell, feeding `input` on stdin; rejects with its stderr on a non-zero exit. */
export function runCommand(file: string, args: string[], cwd: string, options: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd, env: childEnv(options.env), encoding: "buffer", maxBuffer: MAX_OUTPUT, timeout: options.timeout ?? 120_000 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const code = typeof err.code === "number" || typeof err.code === "string" ? err.code : null;
        reject(new CommandError(`${file} ${args[0] ?? ""}`.trim(), code, stderr.toString("utf8").trim() || (code === "ENOENT" ? "not installed" : "")));
      },
    );
    // The program may exit before reading all of its input; the callback above says why.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
  });
}

export class FsStore implements ContentStore {
  readonly root: string;
  private branch?: string;
  private cache = new Map<string, Promise<Files>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private opts: FsStoreOptions) {
    this.root = path.resolve(opts.root);
  }

  private git(args: string[], options?: RunOptions) {
    return runCommand("git", args, this.root, options);
  }

  private async gitText(args: string[], options?: RunOptions) {
    return (await this.git(args, options)).toString("utf8");
  }

  private log(message: string) {
    this.opts.log?.(message);
  }

  private async currentBranch() {
    try {
      return (await this.gitText(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    } catch {
      return null;
    }
  }

  private async branchName() {
    if (this.branch) return this.branch;
    const b = this.opts.branch ?? (await this.currentBranch());
    if (!b) throw new Error(`${this.root} is on a detached HEAD; give the store the branch to publish to`);
    return (this.branch = b);
  }

  private async revParse(rev: string) {
    try {
      return (await this.gitText(["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`])).trim();
    } catch {
      throw new Error(`no commit ${rev} in ${this.root}`);
    }
  }

  private commitUrl(sha: string) {
    return this.opts.remoteUrl ? `${this.opts.remoteUrl.replace(/\/+$/, "")}/commit/${sha}` : `file://${this.root}#${sha}`;
  }

  async head() {
    return this.revParse(`refs/heads/${await this.branchName()}`);
  }

  async files(sha?: string): Promise<Files> {
    const commit = sha && this.cache.has(sha) ? sha : await (sha ? this.revParse(sha) : this.head());
    let files = this.cache.get(commit);
    if (!files) {
      const read = this.readTree(commit);
      files = read;
      this.cache.set(commit, read);
      read.catch(() => this.cache.get(commit) === read && this.cache.delete(commit));
      while (this.cache.size > CACHED_COMMITS) this.cache.delete(this.cache.keys().next().value!);
    }
    return new Map(await files);
  }

  /** One listing and one cat-file process for the whole tree, however many files it has. */
  private async readTree(commit: string): Promise<Files> {
    const blobs: { oid: string; path: string }[] = [];
    for (const entry of (await this.gitText(["ls-tree", "-r", "-z", commit, "--", ...TREES])).split("\0")) {
      const m = /^10(?:0644|0755) blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
      if (m && CONTENT_FILE.test(m[2])) blobs.push({ oid: m[1], path: m[2] });
    }
    const files: Files = new Map();
    if (!blobs.length) return files;
    const out = await this.git(["cat-file", "--batch"], { input: `${blobs.map((b) => b.oid).join("\n")}\n` });
    let at = 0;
    for (const blob of blobs) {
      const eol = out.indexOf(0x0a, at);
      const [, type, size] = out.subarray(at, eol).toString("utf8").split(" ");
      if (type !== "blob") throw new Error(`git cat-file: ${blob.path} (${blob.oid}) is missing`);
      const start = eol + 1;
      const end = start + Number(size);
      files.set(blob.path, out.subarray(start, end).toString("utf8"));
      at = end + 1;
    }
    return files;
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const paths = Object.keys(input.changes);
    const refused = paths.filter((p) => !WRITABLE.test(p));
    if (refused.length) throw new Error(`refusing to write outside the content files: ${refused.join(", ")}`);
    if (!paths.length) throw new Error("nothing to commit: no changes");
    // One commit at a time from this server; the compare-and-swap below covers other processes.
    const run = this.queue.then(() => (input.mode === "publish" ? this.publish(input) : this.pullRequest(input)));
    this.queue = run.catch(() => {});
    return run;
  }

  private async publish({ baseSha, changes, message }: CommitInput): Promise<CommitResult> {
    const branch = await this.branchName();
    const current = await this.currentBranch();
    if (current !== branch) {
      throw new WrongBranchError(`the checkout at ${this.root} is on ${current ?? "a detached HEAD"}, not ${branch}: check out ${branch} there and submit again, or submit with mode pr`);
    }
    const ref = `refs/heads/${branch}`;
    const base = await this.revParse(baseSha);
    if ((await this.revParse(ref)) !== base) throw new ConflictError();

    const paths = Object.keys(changes);
    const edited = await this.locallyChanged(paths);
    if (edited.length) throw new Error(`refusing to overwrite uncommitted local changes in ${this.root}: ${edited.join(", ")}; commit, stash or discard them first`);

    const tracked = new Set(await this.present(base, paths));
    // Deleting a file the branch doesn't have is already done; git would reject the path.
    const touched = Object.fromEntries(Object.entries(changes).filter(([p, text]) => text !== null || tracked.has(p)));
    if (!Object.keys(touched).length) throw new Error("nothing to commit: every file to delete is already gone");

    const made = await this.commitOnto(base, touched, message);
    try {
      // Moves the branch only if it still points at the base: a commit from anyone else meanwhile wins.
      await this.git(["update-ref", "-m", `stackprints publish: ${message.split("\n")[0]}`, ref, made.sha, base]);
    } catch (e) {
      if ((await this.revParse(ref).catch(() => null)) !== base) throw new ConflictError();
      throw e;
    }
    await this.checkOut(made.blobs).catch((e: Error) => {
      // The commit is on the branch; only the checkout lags, and the person can bring it level.
      const list = Object.keys(touched).join(" ");
      this.log(`stackprints: published ${made.sha.slice(0, 7)}, but the index and working tree still show the old ${list} (${e.message}); run: git restore --source=HEAD --staged --worktree -- ${list}`);
    });
    return { mode: "publish", sha: made.sha, url: this.commitUrl(made.sha) };
  }

  /** Paths with unstaged edits, staged changes or an untracked file in the way. */
  private async locallyChanged(paths: string[]) {
    const out = await this.gitText(["status", "--porcelain", "-z", "--untracked-files=all", "--", ...paths], { env: { GIT_OPTIONAL_LOCKS: "0" } });
    const records = out.split("\0");
    const found = new Set<string>();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r) continue;
      found.add(r.slice(3));
      // A rename or copy is followed by the path it came from.
      if (r[0] === "R" || r[0] === "C") found.add(records[++i]);
    }
    return [...found].filter(Boolean).sort();
  }

  /** Which of `paths` exist at `commit`. */
  private async present(commit: string, paths: string[]) {
    return (await this.gitText(["ls-tree", "-r", "-z", "--name-only", commit, "--", ...paths])).split("\0").filter(Boolean);
  }

  /**
   * Brings the index and the working tree level with the new commit for the paths it changed, and
   * only those: whatever else the person has staged or edited stays as it was.
   */
  private async checkOut(blobs: Blobs) {
    await this.updateIndex(blobs);
    for (const [p, b] of blobs) {
      const abs = path.join(this.root, p);
      if (b) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, b.text);
      } else {
        await fs.rm(abs, { force: true });
        await this.pruneEmptyDirs(path.dirname(abs));
      }
    }
  }

  /** Removes folders a deletion left empty, as git checkout does, up to the repository root. */
  private async pruneEmptyDirs(dir: string) {
    for (let d = dir; d.startsWith(`${this.root}${path.sep}`); d = path.dirname(d)) {
      // rmdir refuses a folder that still holds anything.
      if (!(await fs.rmdir(d).then(() => true, () => false))) return;
    }
  }

  /** Records the blobs in an index (the real one unless `env` names another); null removes the path. */
  private async updateIndex(blobs: Blobs, env?: Record<string, string>) {
    const added = [...blobs].flatMap(([p, b]) => (b ? ["--cacheinfo", `100644,${b.oid},${p}`] : []));
    const removed = [...blobs].filter(([, b]) => !b).map(([p]) => p);
    if (added.length) await this.git(["update-index", "--add", ...added], { env });
    if (removed.length) await this.git(["update-index", "--force-remove", "--", ...removed], { env });
  }

  private async pullRequest(input: CommitInput): Promise<CommitResult> {
    const base = await this.revParse(input.baseSha);
    const branch = input.branch ?? `bot/${day((this.opts.now ?? Date.now)())}-${randomBytes(2).toString("hex")}`;
    const ref = `refs/heads/${branch}`;
    try {
      await this.git(["check-ref-format", ref]);
    } catch {
      throw new Error(`not a valid branch name: ${branch}`);
    }
    if (await this.git(["show-ref", "--verify", "--quiet", ref]).then(() => true, () => false)) {
      throw new Error(`branch ${branch} already exists; pass another name`);
    }
    const { sha } = await this.commitOnto(base, input.changes, input.message);
    try {
      // The empty old value makes git refuse if the branch appeared meanwhile.
      await this.git(["update-ref", ref, sha, ""]);
    } catch {
      throw new Error(`branch ${branch} already exists; pass another name`);
    }
    let why: string;
    try {
      const pr = await this.openPullRequest(branch, input);
      if (pr) return { mode: "pr", sha, url: pr.url, number: pr.number, branch, pushed: true };
      why = "this checkout has no origin remote";
    } catch (e) {
      why = (e as Error).message;
    }
    // Said plainly, so nobody reports a pull request that doesn't exist.
    const note = `the branch ${branch} was kept locally; no pull request was opened (${why}): run git push origin ${shellWord(branch)} && gh pr create --head ${shellWord(branch)} --base ${shellWord(await this.branchName())} --fill`;
    this.log(`stackprints: ${note}`);
    return { mode: "pr", sha, url: `branch:${branch}`, number: 0, branch, pushed: false, note };
  }

  /** A commit of `changes` on top of `base`, built in a throwaway index, with the blobs it wrote (null for a deletion). */
  private async commitOnto(base: string, changes: Changes, message: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stackprints-index-"));
    const env = { GIT_INDEX_FILE: path.join(dir, "index") };
    try {
      await this.git(["read-tree", base], { env });
      const blobs: Blobs = new Map();
      for (const [p, text] of Object.entries(changes)) {
        blobs.set(p, text === null ? null : { oid: (await this.gitText(["hash-object", "-w", "--stdin"], { input: text })).trim(), text });
      }
      await this.updateIndex(blobs, env);
      const tree = (await this.gitText(["write-tree"], { env })).trim();
      if (tree === (await this.gitText(["rev-parse", `${base}^{tree}`])).trim()) throw new Error("nothing to commit: the changes match the current content");
      const sha = (await this.gitText(["commit-tree", tree, "-p", base], { input: message })).trim();
      return { sha, blobs };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  private async hasOrigin() {
    return this.git(["remote", "get-url", "origin"]).then(
      () => true,
      () => false,
    );
  }

  /** Pushes the branch to origin and opens the pull request with gh; null when there is no origin. */
  private async openPullRequest(branch: string, input: CommitInput) {
    if (!(await this.hasOrigin())) return null;
    await this.git(["push", "--quiet", "origin", `refs/heads/${branch}:refs/heads/${branch}`], { timeout: NETWORK_TIMEOUT });
    const title = input.prTitle ?? input.message.split("\n")[0];
    const args = ["pr", "create", "--head", branch, "--base", await this.branchName(), "--title", title, "--body-file", "-"];
    const out = (await runCommand(this.opts.gh ?? "gh", args, this.root, { input: input.prBody ?? input.message, timeout: NETWORK_TIMEOUT })).toString("utf8");
    const url = out.match(/https?:\/\/\S+\/pull\/\d+/)?.[0];
    if (!url) throw new Error(`gh printed no pull request URL: ${out.trim().slice(0, 200)}`);
    return { url, number: Number(url.split("/").at(-1)) };
  }

  async history(limit = 20): Promise<CommitInfo[]> {
    const n = Math.max(1, Math.floor(limit));
    // --full-diff lists every path a commit changed, not only those under content/, as GitHub's commit details do.
    const args = ["log", `--max-count=${n}`, "--root", "--name-only", "-z", "--no-renames", "--full-diff", "--diff-merges=first-parent", LOG_FORMAT];
    return this.parseLog(await this.gitText([...args, `refs/heads/${await this.branchName()}`, "--", "content"]));
  }

  async commitInfo(sha: string): Promise<CommitInfo> {
    const full = await this.revParse(sha);
    const [info] = this.parseLog(await this.gitText(["show", "--name-only", "--no-renames", "-z", "--diff-merges=first-parent", LOG_FORMAT, full]));
    if (!info) throw new Error(`no commit ${sha} in ${this.root}`);
    return info;
  }

  /** Open 'correction' issues through gh; none without gh or an origin to ask. */
  async corrections(): Promise<Correction[]> {
    if (!(await this.hasOrigin())) return [];
    const args = ["issue", "list", "--label", "correction", "--state", "open", "--limit", "50", "--json", "number,title,url,body,createdAt,labels"];
    const repo = this.opts.remoteUrl && /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/*$/.exec(this.opts.remoteUrl)?.[1];
    if (repo) args.push("--repo", repo);
    let out: Buffer;
    try {
      out = await runCommand(this.opts.gh ?? "gh", args, this.root, { timeout: NETWORK_TIMEOUT });
    } catch (e) {
      if (e instanceof CommandError && e.code === "ENOENT") return [];
      throw new Error(`could not list correction issues with gh: ${(e as Error).message}`);
    }
    type GhIssue = { number: number; title: string; url: string; body?: string | null; createdAt: string; labels?: { name: string }[] };
    return (JSON.parse(out.toString("utf8")) as GhIssue[]).map((i) => ({
      number: i.number,
      title: i.title,
      url: i.url,
      body: i.body ?? "",
      createdAt: i.createdAt,
      labels: (i.labels ?? []).map((l) => l.name),
    }));
  }

  /** Commits as LOG_FORMAT prints them with --name-only -z. */
  private parseLog(out: string): CommitInfo[] {
    return out
      .split("\x1e")
      .filter((r) => r.includes("\x1d"))
      .map((r) => {
        const cut = r.indexOf("\x1d");
        const [sha, author, date, ...message] = r.slice(0, cut).split("\x1f");
        const paths = r
          .slice(cut + 1)
          .split("\0")
          .map((p) => p.replace(/^\n/, ""))
          .filter(Boolean);
        return { sha, message: message.join("\x1f").trim(), date: new Date(date).toISOString(), url: this.commitUrl(sha), author, paths };
      });
  }
}

/** A word a POSIX shell reads back as itself. */
function shellWord(s: string) {
  return /^[\w./@:-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}
