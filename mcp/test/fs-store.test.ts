// The local store against real git repositories in temp folders. FileState's tests are in state.test.ts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, WrongBranchError } from "../src/core/store";
import { FsStore } from "../src/stores/fs";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const LAYERS = `${JSON.stringify([{ id: "models", name: "Models" }], null, 2)}\n`;
const CLAUDE = `${JSON.stringify({ id: "claude", name: "Claude" }, null, 2)}\n`;

let tmp: string;
let root: string;
const savedEnv = { ...process.env };

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), text);
};
const store = (over: Partial<ConstructorParameters<typeof FsStore>[0]> = {}) => new FsStore({ root, now: () => NOW, ...over });

beforeAll(() => {
  // The person's own git config (signing, hooks, templates) must not leak into these repositories.
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  process.env = savedEnv;
});

let initial: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-store-test-"));
  root = path.join(tmp, "repo");
  fs.mkdirSync(root);
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Tester");
  git("config", "user.email", "tester@example.com");
  write("content/layers.json", LAYERS);
  write("content/options/models/claude.json", CLAUDE);
  write("content/notes.txt", "not content");
  write("docs/RESEARCH.md", "# Research\n");
  write("README.md", "# Repo\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "initial");
  initial = git("rev-parse", "HEAD");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("FsStore reads", () => {
  it("lists content and docs files at head and at an older commit", async () => {
    write("content/layers.json", LAYERS.replace("Models", "Model providers"));
    git("commit", "--quiet", "-am", "rename layer");
    const s = store();
    expect(await s.head()).toBe(git("rev-parse", "HEAD"));

    const now = await s.files();
    expect([...now.keys()].sort()).toEqual(["content/layers.json", "content/options/models/claude.json", "docs/RESEARCH.md"]);
    expect(now.get("content/layers.json")).toContain("Model providers");
    expect(now.get("docs/RESEARCH.md")).toBe("# Research\n");

    const before = await s.files(initial);
    expect(before.get("content/layers.json")).toBe(LAYERS);
    expect(await s.files(initial.slice(0, 10))).toEqual(before);

    // Callers get their own copy of the cached map.
    before.delete("content/layers.json");
    expect((await s.files(initial)).has("content/layers.json")).toBe(true);
  });

  it("reads multi-byte text exactly", async () => {
    const text = "{ \"name\": \"Café — 東京 🚀\" }\n";
    write("content/options/models/cafe.json", text);
    git("add", "-A");
    git("commit", "--quiet", "-m", "unicode");
    expect((await store().files()).get("content/options/models/cafe.json")).toBe(text);
  });

  it("rejects an unknown commit", async () => {
    await expect(store().files("0".repeat(40))).rejects.toThrow(/no commit/);
  });
});

describe("FsStore publish", () => {
  it("commits only the changed paths and leaves the person's staged and unstaged work alone", async () => {
    write("README.md", "# Repo, edited by hand\n");
    git("add", "README.md");
    write("docs/RESEARCH.md", "# Research, being edited\n");
    const s = store({ remoteUrl: "https://github.com/stackprints/stackprints/" });
    const base = await s.head();
    const added = `${JSON.stringify({ id: "gpt", name: "GPT" }, null, 2)}\n`;
    const r = await s.commit({
      baseSha: base,
      mode: "publish",
      message: "Add GPT\n\nSources: https://example.com",
      changes: { "content/options/models/gpt.json": added, "content/layers.json": LAYERS.replace("Models", "LLMs") },
    });

    const head = git("rev-parse", "HEAD");
    expect(r).toEqual({ mode: "publish", sha: head, url: `https://github.com/stackprints/stackprints/commit/${head}` });
    expect(git("rev-parse", "HEAD^")).toBe(base);
    expect(git("show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["content/layers.json", "content/options/models/gpt.json"]);
    expect(git("log", "-1", "--format=%B")).toBe("Add GPT\n\nSources: https://example.com");
    expect(read("content/options/models/gpt.json")).toBe(added);
    expect(read("content/layers.json")).toBe(LAYERS.replace("Models", "LLMs"));
    expect(git("status", "--porcelain")).toBe("M  README.md\n M docs/RESEARCH.md");
    expect(git("diff", "--cached", "--name-only")).toBe("README.md");
    expect(read("docs/RESEARCH.md")).toBe("# Research, being edited\n");
    expect(git("reflog", "-1", "--format=%gs", "main")).toBe("stackprints publish: Add GPT");
    expect((await s.files()).get("content/options/models/gpt.json")).toBe(added);
  });

  it("deletes files, and skips deleting one that is already gone", async () => {
    const s = store();
    const r = await s.commit({
      baseSha: await s.head(),
      mode: "publish",
      message: "Remove Claude",
      changes: { "content/options/models/claude.json": null, "content/options/models/never.json": null },
    });
    expect(fs.existsSync(path.join(root, "content/options/models/claude.json"))).toBe(false);
    // The folder the deletion emptied goes too, as git checkout would do.
    expect(fs.existsSync(path.join(root, "content/options"))).toBe(false);
    expect(git("show", "--name-status", "--format=", "HEAD")).toBe("D\tcontent/options/models/claude.json");
    expect(git("status", "--porcelain")).toBe("");
    expect((await s.files(r.sha)).has("content/options/models/claude.json")).toBe(false);
    expect(r.url).toBe(`file://${root}#${r.sha}`);
  });

  it("is a conflict when the branch moved past the base", async () => {
    const s = store();
    const base = await s.head();
    write("content/layers.json", LAYERS.replace("Models", "Moved"));
    git("commit", "--quiet", "-am", "someone else");
    await expect(s.commit({ baseSha: base, mode: "publish", message: "x", changes: { "content/hot.json": "{}\n" } })).rejects.toBeInstanceOf(ConflictError);
    expect(fs.existsSync(path.join(root, "content/hot.json"))).toBe(false);
  });

  it("says so, without calling it a conflict, when another branch is checked out", async () => {
    const s = store();
    const base = await s.head();
    git("checkout", "--quiet", "-b", "feature");
    const err = await s.commit({ baseSha: base, mode: "publish", message: "x", changes: { "content/hot.json": "{}\n" } }).catch((e) => e);
    expect(err).toBeInstanceOf(WrongBranchError);
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(err.message).toMatch(/on feature, not main: check out main/);
    expect(git("rev-parse", "main")).toBe(base);
  });

  it("refuses to overwrite local edits, staged changes or an untracked file", async () => {
    const s = store();
    const base = await s.head();
    const attempt = (p: string) => s.commit({ baseSha: base, mode: "publish", message: "x", changes: { [p]: "{}\n" } });

    write("content/layers.json", "my edit\n");
    await expect(attempt("content/layers.json")).rejects.toThrow(/uncommitted local changes.*content\/layers\.json/);
    expect(read("content/layers.json")).toBe("my edit\n");

    write("content/options/models/claude.json", "staged edit\n");
    git("add", "content/options/models/claude.json");
    await expect(attempt("content/options/models/claude.json")).rejects.toThrow(/content\/options\/models\/claude\.json/);
    expect(read("content/options/models/claude.json")).toBe("staged edit\n");

    write("content/stacks/mine.json", "draft\n");
    await expect(attempt("content/stacks/mine.json")).rejects.toThrow(/content\/stacks\/mine\.json/);
    expect(read("content/stacks/mine.json")).toBe("draft\n");

    expect(git("rev-parse", "HEAD")).toBe(base);
  });

  it("is a conflict, and touches nothing, when someone commits while the publish is being built", async () => {
    const s = store();
    const base = await s.head();
    // Another server or the person commits between the check and the move.
    const build = (s as any).commitOnto.bind(s);
    (s as any).commitOnto = async (...args: unknown[]) => {
      const made = await build(...args);
      write("README.md", "# someone else\n");
      git("commit", "--quiet", "-am", "someone else");
      return made;
    };
    await expect(
      s.commit({ baseSha: base, mode: "publish", message: "x", changes: { "content/layers.json": "[]\n", "content/hot.json": "{}\n" } }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(git("log", "-1", "--format=%s", "main")).toBe("someone else");
    expect(git("rev-parse", "main^")).toBe(base);
    expect(git("status", "--porcelain")).toBe("");
    expect(read("content/layers.json")).toBe(LAYERS);
    expect(fs.existsSync(path.join(root, "content/hot.json"))).toBe(false);
  });

  it("lets exactly one of two servers on the same checkout publish from the same base", async () => {
    const a = store();
    const b = store();
    const base = await a.head();
    const results = await Promise.allSettled([
      a.commit({ baseSha: base, mode: "publish", message: "from a", changes: { "content/hot.json": '{"a":1}\n' } }),
      b.commit({ baseSha: base, mode: "publish", message: "from b", changes: { "content/layers.json": "[]\n" } }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    const sha = (won[0] as PromiseFulfilledResult<{ sha: string }>).value.sha;
    expect(git("rev-parse", "main")).toBe(sha);
    expect(git("rev-parse", "main^")).toBe(base);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("leaves everything as it was when git can't move the branch", async () => {
    const s = store();
    const base = await s.head();
    // Another git process holds the branch's lock.
    fs.writeFileSync(path.join(root, ".git/refs/heads/main.lock"), "");
    const err = await s.commit({ baseSha: base, mode: "publish", message: "x", changes: { "content/layers.json": "[]\n" } }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(err.message).toMatch(/update-ref/);
    fs.rmSync(path.join(root, ".git/refs/heads/main.lock"));
    expect(git("rev-parse", "main")).toBe(base);
    expect(git("status", "--porcelain")).toBe("");
    expect(read("content/layers.json")).toBe(LAYERS);
  });

  it("keeps the publish and says how to catch the checkout up when the index can't be written", async () => {
    const logged: string[] = [];
    const s = store({ log: (m) => logged.push(m) });
    const base = await s.head();
    // Another git process holds the index lock just as the branch has moved.
    const build = (s as any).commitOnto.bind(s);
    (s as any).commitOnto = async (...args: unknown[]) => {
      const made = await build(...args);
      fs.writeFileSync(path.join(root, ".git/index.lock"), "");
      return made;
    };
    const r = await s.commit({ baseSha: base, mode: "publish", message: "x", changes: { "content/layers.json": "[]\n" } });
    fs.rmSync(path.join(root, ".git/index.lock"));
    expect(git("rev-parse", "main")).toBe(r.sha);
    expect(logged.join("\n")).toMatch(/published [0-9a-f]{7}, but the index and working tree still show the old content\/layers\.json .*run: git restore --source=HEAD --staged --worktree -- content\/layers\.json$/s);
    git("restore", "--source=HEAD", "--staged", "--worktree", "--", "content/layers.json");
    expect(git("status", "--porcelain")).toBe("");
    expect(read("content/layers.json")).toBe("[]\n");
  });

  it("refuses a change that matches the current content", async () => {
    const s = store();
    await expect(s.commit({ baseSha: await s.head(), mode: "publish", message: "x", changes: { "content/layers.json": LAYERS } })).rejects.toThrow(/nothing to commit/);
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("FsStore pull requests", () => {
  it("builds the branch without touching the working tree, the index or HEAD", async () => {
    write("README.md", "# staged\n");
    git("add", "README.md");
    write("docs/RESEARCH.md", "# unstaged\n");
    const s = store();
    const base = await s.head();
    const status = git("status", "--porcelain");
    const r = await s.commit({
      baseSha: base,
      mode: "pr",
      message: "News for models",
      changes: { "content/layers.json": "[]\n", "content/news/models/claude.json": "{}\n", "content/options/models/claude.json": null },
    });

    expect(r.mode).toBe("pr");
    if (r.mode !== "pr") return;
    expect(r.branch).toMatch(/^bot\/2026-10-22-[0-9a-f]{4}$/);
    expect(r).toMatchObject({ number: 0, url: `branch:${r.branch}`, pushed: false });
    expect(r.note).toBe(`the branch ${r.branch} was kept locally; no pull request was opened (this checkout has no origin remote): run git push origin ${r.branch} && gh pr create --head ${r.branch} --base main --fill`);
    expect(git("rev-parse", `refs/heads/${r.branch}`)).toBe(r.sha);
    expect(git("rev-parse", `${r.sha}^`)).toBe(base);
    expect(git("log", "-1", "--format=%s", r.sha)).toBe("News for models");

    expect(git("rev-parse", "HEAD")).toBe(base);
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git("status", "--porcelain")).toBe(status);
    expect(read("content/layers.json")).toBe(LAYERS);
    expect(fs.existsSync(path.join(root, "content/news"))).toBe(false);

    const files = await s.files(r.sha);
    expect(files.get("content/layers.json")).toBe("[]\n");
    expect(files.get("content/news/models/claude.json")).toBe("{}\n");
    expect(files.has("content/options/models/claude.json")).toBe(false);
    expect(files.get("docs/RESEARCH.md")).toBe("# Research\n");

    const named = await s.commit({ baseSha: base, mode: "pr", message: "again", branch: "bot/mine", changes: { "content/hot.json": "{}\n" } });
    expect(named).toMatchObject({ branch: "bot/mine", number: 0, url: "branch:bot/mine", pushed: false });
    await expect(s.commit({ baseSha: base, mode: "pr", message: "again", branch: "bot/mine", changes: { "content/hot.json": "{}\n" } })).rejects.toThrow(/already exists/);
    await expect(s.commit({ baseSha: base, mode: "pr", message: "x", branch: "main", changes: { "content/hot.json": "{}\n" } })).rejects.toThrow(/already exists/);
    await expect(s.commit({ baseSha: base, mode: "pr", message: "x", branch: "bad..name", changes: { "content/hot.json": "{}\n" } })).rejects.toThrow(/not a valid branch/);
    expect(git("rev-parse", "main")).toBe(base);
  });

  it("pushes to origin and opens the pull request with gh", async () => {
    const remote = path.join(tmp, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    git("remote", "add", "origin", remote);
    const gh = path.join(tmp, "gh");
    const seen = path.join(tmp, "gh-args");
    fs.writeFileSync(gh, `#!/bin/sh\necho "$@" > "${seen}"\ncat >> "${seen}"\necho "https://github.com/stackprints/stackprints/pull/42"\n`, { mode: 0o755 });
    const s = store({ gh });
    const r = await s.commit({ baseSha: await s.head(), mode: "pr", message: "Hot list", prTitle: "Hot this week", prBody: "Body text", changes: { "content/hot.json": "{}\n" } });

    expect(r).toMatchObject({ mode: "pr", number: 42, url: "https://github.com/stackprints/stackprints/pull/42", pushed: true });
    expect(r.mode === "pr" && r.note).toBeFalsy();
    if (r.mode !== "pr") return;
    expect(execFileSync("git", ["rev-parse", `refs/heads/${r.branch}`], { cwd: remote, encoding: "utf8" }).trim()).toBe(r.sha);
    expect(fs.readFileSync(seen, "utf8")).toBe(`pr create --head ${r.branch} --base main --title Hot this week --body-file -\nBody text`);
  });

  it("keeps the local branch when gh fails, and says no pull request was opened", async () => {
    const remote = path.join(tmp, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    git("remote", "add", "origin", remote);
    const gh = path.join(tmp, "gh");
    fs.writeFileSync(gh, "#!/bin/sh\necho 'not logged in' >&2\nexit 1\n", { mode: 0o755 });
    const logged: string[] = [];
    const s = store({ gh, log: (m) => logged.push(m) });
    const r = await s.commit({ baseSha: await s.head(), mode: "pr", message: "x", changes: { "content/hot.json": "{}\n" } });
    expect(r).toMatchObject({ mode: "pr", number: 0, pushed: false });
    if (r.mode !== "pr") return;
    expect(r.url).toBe(`branch:${r.branch}`);
    expect(r.note).toMatch(new RegExp(`^the branch ${r.branch} was kept locally; no pull request was opened \\(\\S*gh pr failed: not logged in\\): run git push origin ${r.branch} && gh pr create --head ${r.branch} --base main --fill$`));
    expect(git("rev-parse", `refs/heads/${r.branch}`)).toBe(r.sha);
    expect(logged.join("\n")).toMatch(/not logged in/);
  });

  it("says no pull request was opened when the push fails", async () => {
    git("remote", "add", "origin", path.join(tmp, "no-such-remote.git"));
    const s = store({ gh: "/bin/false" });
    const r = await s.commit({ baseSha: await s.head(), mode: "pr", message: "x", branch: "bot/it's", changes: { "content/hot.json": "{}\n" } });
    expect(r).toMatchObject({ mode: "pr", number: 0, pushed: false, branch: "bot/it's" });
    expect(r.mode === "pr" && r.note).toMatch(/\(git push failed: .*\): run git push origin 'bot\/it'\\''s' && gh pr create --head 'bot\/it'\\''s' --base main --fill$/s);
  });
});

describe("FsStore guards and history", () => {
  it("refuses paths outside the content files", async () => {
    const s = store();
    const base = await s.head();
    for (const mode of ["publish", "pr"] as const) {
      await expect(s.commit({ baseSha: base, mode, message: "x", changes: { "lib/validate.mjs": "boom" } })).rejects.toThrow(/outside the content files: lib\/validate\.mjs/);
      await expect(s.commit({ baseSha: base, mode, message: "x", changes: { "content/../README.md": "boom" } })).rejects.toThrow(/outside/);
      await expect(s.commit({ baseSha: base, mode, message: "x", changes: { "docs/RESEARCH.md": "boom" } })).rejects.toThrow(/outside/);
    }
    expect(read("README.md")).toBe("# Repo\n");
    expect(git("branch", "--list")).toBe("* main");
  });

  it("lists commits that touched content, and one commit's paths", async () => {
    const s = store({ remoteUrl: "https://github.com/stackprints/stackprints" });
    const r = await s.commit({ baseSha: await s.head(), mode: "publish", message: "Publish hot\n\nWith a body", changes: { "content/hot.json": "{}\n", "content/layers.json": "[]\n" } });
    write("README.md", "# docs only\n");
    git("commit", "--quiet", "-am", "readme only");

    write("content/layers.json", "[1]\n");
    write("README.md", "# both\n");
    git("commit", "--quiet", "-am", "content and readme");
    const both = git("rev-parse", "HEAD");

    const h = await s.history();
    expect(h.map((c) => c.sha)).toEqual([both, r.sha, initial]);
    // Every path each commit changed, as GitHub's commit details list them, not just those under content/.
    expect(h[0].paths).toEqual(["README.md", "content/layers.json"]);
    expect(h[1]).toMatchObject({ message: "Publish hot\n\nWith a body", author: "Tester", url: `https://github.com/stackprints/stackprints/commit/${r.sha}`, paths: ["content/hot.json", "content/layers.json"] });
    expect(h[2].paths).toEqual(["README.md", "content/layers.json", "content/notes.txt", "content/options/models/claude.json", "docs/RESEARCH.md"]);
    expect(await s.commitInfo(r.sha)).toEqual(h[1]);
    expect(h[0].date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
    expect(await s.history(1)).toHaveLength(1);

    const info = await s.commitInfo(r.sha.slice(0, 12));
    expect(info).toMatchObject({ sha: r.sha, message: "Publish hot\n\nWith a body", author: "Tester" });
    expect(info.paths.sort()).toEqual(["content/hot.json", "content/layers.json"]);
    expect((await s.commitInfo(initial)).paths.sort()).toEqual(["README.md", "content/layers.json", "content/notes.txt", "content/options/models/claude.json", "docs/RESEARCH.md"]);
    await expect(s.commitInfo("f".repeat(40))).rejects.toThrow(/no commit/);
  });
});

describe("FsStore corrections", () => {
  const ISSUES = [
    { number: 9, title: "Correction: E2B (Pricing)", url: "https://github.com/stackprints/stackprints/issues/9", body: "**Target:** x", createdAt: "2026-10-21T10:00:00Z", labels: [{ id: "L1", name: "correction", color: "ededed" }] },
    { number: 8, title: "Correction: OpenRouter", url: "https://github.com/stackprints/stackprints/issues/8", body: null, createdAt: "2026-10-20T10:00:00Z", labels: [] },
  ];

  it("lists open correction issues through gh, for the origin's repository", async () => {
    git("remote", "add", "origin", "https://github.com/stackprints/stackprints.git");
    const gh = path.join(tmp, "gh");
    const seen = path.join(tmp, "gh-args");
    fs.writeFileSync(gh, `#!/bin/sh\necho "$@" > "${seen}"\ncat <<'EOF'\n${JSON.stringify(ISSUES)}\nEOF\n`, { mode: 0o755 });
    const s = store({ gh, remoteUrl: "https://github.com/stackprints/stackprints" });
    expect(await s.corrections()).toEqual([
      { number: 9, title: "Correction: E2B (Pricing)", url: "https://github.com/stackprints/stackprints/issues/9", body: "**Target:** x", createdAt: "2026-10-21T10:00:00Z", labels: ["correction"] },
      { number: 8, title: "Correction: OpenRouter", url: "https://github.com/stackprints/stackprints/issues/8", body: "", createdAt: "2026-10-20T10:00:00Z", labels: [] },
    ]);
    expect(fs.readFileSync(seen, "utf8").trim()).toBe("issue list --label correction --state open --limit 50 --json number,title,url,body,createdAt,labels --repo stackprints/stackprints");
  });

  it("has none without an origin or without gh, and says why when gh fails", async () => {
    expect(await store({ gh: "/bin/false" }).corrections()).toEqual([]);
    git("remote", "add", "origin", "https://github.com/stackprints/stackprints.git");
    expect(await store({ gh: path.join(tmp, "no-gh-here") }).corrections()).toEqual([]);
    const gh = path.join(tmp, "gh");
    fs.writeFileSync(gh, "#!/bin/sh\necho 'HTTP 401: Bad credentials' >&2\nexit 1\n", { mode: 0o755 });
    await expect(store({ gh }).corrections()).rejects.toThrow(/could not list correction issues with gh: .*Bad credentials/);
  });
});
