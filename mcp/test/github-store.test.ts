import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MemoryState } from "../src/core/state";
import { ConflictError, ProtectedBranchError } from "../src/core/store";
import { GitHubStore, untar } from "../src/stores/github";
import { FakeGitHub, tarball } from "./fake-github";
import { repoFiles } from "./helpers";

const REPO = "stackprints/stackprints";
const NOW = Date.parse("2026-10-22T12:00:00Z");
const NOTE = "content/options/browser/browserbase.json";

function setup(over: { files?: Map<string, string>; cache?: MemoryState } = {}) {
  const gh = new FakeGitHub(REPO, over.files ?? repoFiles());
  const fetchStub: typeof fetch = async (input, init) => {
    const res = await gh.handle(new Request(input, init));
    if (!res) throw new Error(`unexpected request ${new Request(input, init).url}`);
    return res;
  };
  const cache = over.cache ?? new MemoryState(() => NOW);
  // A repository of its own per test, so the isolate-wide files cache never mixes them up.
  const store = new GitHubStore({ repo: REPO, token: "test-token", cache, fetch: fetchStub, now: () => NOW });
  return { gh, store, cache };
}

const edited = (text: string) => {
  const o = JSON.parse(text);
  o.note = "Edited by a test";
  return `${JSON.stringify(o, null, 2)}\n`;
};

describe("untar", () => {
  it("reads pax, ustar-prefix and plain names, drops the top folder, and keeps only what's asked", () => {
    const files = new Map([
      ["content/layers.json", "[]"],
      ["content/options/browser/a-very-long-option-id-that-pushes-the-name-past-one-hundred-bytes-of-ustar.json", "{}"],
      ["docs/NEWS.md", "# News — é"],
      ["app/page.tsx", "export {}"],
    ]);
    const gz = tarball("stackprints-stackprints-abc1234", files);
    const tar = new Uint8Array(gunzipSync(gz));
    const out = untar(tar, (p) => /^(content|docs)\//.test(p));
    expect([...out.keys()].sort()).toEqual([...files.keys()].filter((p) => !p.startsWith("app/")).sort());
    expect(out.get("docs/NEWS.md")).toBe("# News — é");
  });
});

describe("GitHubStore reads", () => {
  it("returns main's head and every content and docs file at it, from one tarball", async () => {
    const { gh, store } = setup();
    const head = await store.head();
    expect(head).toBe(gh.refs.get("main"));
    const files = await store.files();
    const expected = repoFiles();
    expect([...files.keys()].sort()).toEqual([...expected.keys()].sort());
    expect(files.get(NOTE)).toBe(expected.get(NOTE));
    await store.files(head);
    expect(gh.tarballs).toBe(1);
  });

  it("keeps a commit's files in the cache, so another isolate needs no download", async () => {
    const { gh, store, cache } = setup();
    // Commits no other test made, so this isolate's in-memory copy can't answer for them.
    const fresh = gh.push({ "content/layers.json": `${repoFiles().get("content/layers.json")!}\n` }, `unique ${Math.random()}`);
    await store.files(fresh);
    expect(gh.tarballs).toBe(1);
    const cached = await cache.get<Record<string, string>>(`gh-files:${REPO}:${fresh}`);
    expect(Object.keys(cached!).length).toBe(repoFiles().size);

    const other = gh.push({ "README.md": "x" }, `unique ${Math.random()}`);
    await cache.put(`gh-files:${REPO}:${other}`, { "content/layers.json": "[]" });
    expect(await store.files(other)).toEqual(new Map([["content/layers.json", "[]"]]));
    expect(gh.tarballs).toBe(1);
  });

  it("resolves short shas and refuses unknown ones", async () => {
    const { gh, store } = setup();
    const head = gh.refs.get("main")!;
    expect((await store.files(head.slice(0, 7))).size).toBe(repoFiles().size);
    await expect(store.files("deadbeef")).rejects.toThrow(/no commit deadbeef/);
  });

  it("lists recent content commits with the paths each changed, newest first", async () => {
    const { gh, store } = setup();
    const a = gh.push({ [NOTE]: edited(repoFiles().get(NOTE)!) }, "option: browserbase note");
    gh.push({ "README.md": "x" }, "outside content");
    const history = await store.history(5);
    expect(history[0]).toMatchObject({ sha: a, message: "option: browserbase note", author: "tester", paths: [NOTE], url: `https://github.com/${REPO}/commit/${a}` });
    expect(history.map((c) => c.message)).not.toContain("outside content");
    expect(await store.commitInfo(a.slice(0, 8))).toEqual(history[0]);
  });

  it("follows the pages of a big commit's files, up to GitHub's 3000", async () => {
    const { gh, store } = setup();
    const many = (n: number, tag: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`content/news/x/${tag}-${String(i).padStart(4, "0")}.json`, "{}\n"]));
    const big = gh.push(many(700, "a"), "news: 700 files");
    const info = await store.commitInfo(big);
    expect(info.paths).toHaveLength(700);
    expect(gh.calls.filter((c) => c.startsWith(`GET /commits/${big}`))).toEqual([`GET /commits/${big}`, `GET /commits/${big}?page=2`, `GET /commits/${big}?page=3`]);

    gh.filesPerPage = 1000;
    const huge = gh.push(many(3500, "b"), "news: 3500 files");
    expect((await store.commitInfo(huge)).paths).toHaveLength(3000);
    expect(gh.calls.filter((c) => c.startsWith(`GET /commits/${huge}`))).toHaveLength(3);
  });

  it("never follows a Link header off GitHub's API, where the token would go", async () => {
    const gh = new FakeGitHub(REPO, new Map([["content/layers.json", "[]"]]));
    const seen: string[] = [];
    const store = new GitHubStore({
      repo: REPO,
      token: "test-token",
      fetch: async (input, init) => {
        const req = new Request(input, init);
        seen.push(req.url);
        const res = (await gh.handle(req))!;
        if (new URL(req.url).pathname.includes("/commits/")) res.headers.set("link", '<https://evil.example/steal?page=2>; rel="next"');
        return res;
      },
    });
    const info = await store.commitInfo(gh.refs.get("main")!);
    expect(info.paths).toEqual(["content/layers.json"]);
    expect(seen.some((u) => u.startsWith("https://evil.example"))).toBe(false);
  });

  it("lists the open correction issues, newest first, without pull requests", async () => {
    const { gh, store } = setup();
    gh.issues.push(
      { number: 3, title: "Correction: OpenRouter (Platform fee)", body: "**Target:** x", labels: ["correction"], state: "open", created_at: "2026-10-20T10:00:00Z" },
      { number: 4, title: "Correction: E2B", body: null, labels: ["correction", "triage"], state: "open", created_at: "2026-10-21T10:00:00Z" },
      { number: 5, title: "Fixed already", body: "", labels: ["correction"], state: "closed", created_at: "2026-10-21T11:00:00Z" },
      { number: 6, title: "A question", body: "", labels: ["question"], state: "open", created_at: "2026-10-21T12:00:00Z" },
      { number: 7, title: "PR labelled correction", body: "", labels: ["correction"], state: "open", created_at: "2026-10-22T09:00:00Z", pull_request: true },
    );
    expect(await store.corrections()).toEqual([
      { number: 4, title: "Correction: E2B", url: `https://github.com/${REPO}/issues/4`, body: "", createdAt: "2026-10-21T10:00:00Z", labels: ["correction", "triage"] },
      { number: 3, title: "Correction: OpenRouter (Platform fee)", url: `https://github.com/${REPO}/issues/3`, body: "**Target:** x", createdAt: "2026-10-20T10:00:00Z", labels: ["correction"] },
    ]);
    expect(gh.calls.at(-1)).toBe("GET /issues?labels=correction&state=open&per_page=50");
  });
});

describe("GitHubStore writes", () => {
  it("publishes one commit on main from the base, through a tree on the base's", async () => {
    const { gh, store } = setup();
    const base = await store.head();
    const text = edited((await store.files()).get(NOTE)!);
    const r = await store.commit({ baseSha: base, changes: { [NOTE]: text }, message: "option: note\n\nAgent: t (local)", mode: "publish" });
    expect(r).toEqual({ mode: "publish", sha: gh.refs.get("main"), url: `https://github.com/${REPO}/commit/${r.sha}` });
    expect(gh.commits.get(r.sha)).toMatchObject({ parents: [base], message: "option: note\n\nAgent: t (local)", paths: [NOTE] });
    expect((await store.files()).get(NOTE)).toBe(text);
    expect(gh.calls.filter((c) => c.startsWith("PATCH"))).toEqual(["PATCH /git/refs/heads/main"]);
  });

  it("refuses with a ConflictError when main moved, before or during the write", async () => {
    const { gh, store } = setup();
    const base = await store.head();
    gh.push({ "content/layers.json": `${repoFiles().get("content/layers.json")!} ` });
    await expect(store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "publish" })).rejects.toBeInstanceOf(ConflictError);

    // Main moves after the store checked it: GitHub refuses the non-fast-forward.
    const { gh: gh2, store: store2 } = setup();
    const base2 = await store2.head();
    const realHandle = gh2.handle.bind(gh2);
    gh2.handle = async (req) => {
      if (req.method === "PATCH") gh2.push({ "README.md": "moved" });
      return realHandle(req);
    };
    await expect(store2.commit({ baseSha: base2, changes: { [NOTE]: "{}\n" }, message: "m", mode: "publish" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("deletes files, skips deleting what is already gone, and refuses an empty change", async () => {
    const { gh, store } = setup();
    const base = await store.head();
    const logo = [...repoFiles().keys()].find((p) => p.startsWith("content/logos/"))!;
    const r = await store.commit({ baseSha: base, changes: { [logo]: null, "content/logos/never-there.svg": null }, message: "logo: drop", mode: "publish" });
    expect((await store.files(r.sha)).has(logo)).toBe(false);
    await expect(store.commit({ baseSha: r.sha, changes: { "content/logos/never-there.svg": null }, message: "m", mode: "publish" })).rejects.toThrow(/nothing to commit/);
    await expect(store.commit({ baseSha: r.sha, changes: { [NOTE]: repoFiles().get(NOTE)! }, message: "m", mode: "publish" })).rejects.toThrow(/nothing to commit/);
    expect(gh.refs.get("main")).toBe(r.sha);
  });

  it("says main is protected, not that something unexpected failed, when a ruleset refuses the push", async () => {
    const { gh, store } = setup();
    gh.protectedBranches.add("main");
    const base = await store.head();
    const err = await store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "publish" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProtectedBranchError);
    expect(err.message).toMatch(/^main takes changes only through pull requests \(.*422 Repository rule violations found Changes must be made through a pull request\.\); submit with mode pr$/);
    expect(gh.refs.get("main")).toBe(base);
    // A pull request still goes through.
    const r = await store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "pr" });
    expect(r).toMatchObject({ mode: "pr", number: 1 });
  });

  it("refuses paths outside the content files", async () => {
    const { store } = setup();
    const base = await store.head();
    await expect(store.commit({ baseSha: base, changes: { "package.json": "{}" }, message: "m", mode: "publish" })).rejects.toThrow(/outside the content files: package\.json/);
    await expect(store.commit({ baseSha: base, changes: { "content/../x.json": "{}" }, message: "m", mode: "pr" })).rejects.toThrow(/outside/);
  });

  it("opens a pull request from a new branch on the base, leaving main alone", async () => {
    const { gh, store } = setup();
    const base = await store.head();
    gh.push({ "README.md": "main moved; a pull request doesn't mind" });
    const main = gh.refs.get("main");
    const r = await store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "option: note\n\nbody", mode: "pr", branch: "bot/option/abc", prTitle: "option: note", prBody: "body" });
    expect(r).toEqual({ mode: "pr", sha: gh.refs.get("bot/option/abc"), url: `https://github.com/${REPO}/pull/1`, number: 1, branch: "bot/option/abc" });
    expect(gh.refs.get("main")).toBe(main);
    expect(gh.commits.get(r.sha)!.parents).toEqual([base]);
    expect(gh.pulls[0]).toEqual({ number: 1, head: "bot/option/abc", base: "main", title: "option: note", body: "body", state: "open" });
    await expect(store.commit({ baseSha: base, changes: { [NOTE]: "{\"other\": true}\n" }, message: "m", mode: "pr", branch: "bot/option/abc" })).rejects.toThrow(/already exists/);
    await expect(store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "pr", branch: "../main" })).rejects.toThrow(/not a valid branch/);
    await expect(store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "pr", branch: "main" })).rejects.toThrow(/not a valid branch/);
  });

  it("answers a retried submit with the pull request it already opened, once and only for the same files", async () => {
    const { gh, store } = setup();
    const base = await store.head();
    const input = { baseSha: base, changes: { [NOTE]: "{}\n" }, message: "option: note", mode: "pr" as const, branch: "bot/retry" };
    const first = await store.commit(input);
    const again = await store.commit({ ...input, message: "option: note (retry)" });
    expect(again).toEqual(first);
    expect(gh.pulls).toHaveLength(1);
    expect(gh.calls).toContain(`GET /pulls?head=${encodeURIComponent("stackprints:bot/retry")}&state=open&per_page=1`);

    // A closed pull request is not reopened by a retry.
    gh.pulls[0].state = "closed";
    await expect(store.commit(input)).rejects.toThrow(/branch bot\/retry already exists; pass another name/);
    expect(gh.pulls).toHaveLength(1);
  });

  it("names a branch when none is given, and removes it when the pull request can't be opened", async () => {
    const { gh, store } = setup();
    const base = await store.head();
    const r = await store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "pr" });
    expect(r.mode === "pr" && r.branch).toMatch(/^bot\/2026-10-22-[0-9a-f]{4}$/);

    const realHandle = gh.handle.bind(gh);
    gh.handle = async (req) => (new URL(req.url).pathname.endsWith("/pulls") ? Response.json({ message: "Validation Failed" }, { status: 422 }) : realHandle(req));
    await expect(store.commit({ baseSha: base, changes: { [NOTE]: "{}\n" }, message: "m", mode: "pr", branch: "bot/x" })).rejects.toThrow(/422 Validation Failed/);
    expect(gh.refs.has("bot/x")).toBe(false);
  });

  it("writes as the committer when one is given, and says when GitHub's rate limit is spent", async () => {
    const gh = new FakeGitHub(REPO, repoFiles());
    let limited = false;
    const store = new GitHubStore({
      repo: REPO,
      token: "test-token",
      committer: { name: "Stackprints admin", email: "admin@stackprints.com" },
      fetch: async (input, init) => {
        if (limited) return Response.json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793000000" } });
        return (await gh.handle(new Request(input, init)))!;
      },
    });
    const r = await store.commit({ baseSha: await store.head(), changes: { [NOTE]: "{}\n" }, message: "m", mode: "publish" });
    expect(gh.commits.get(r.sha)!.author).toBe("Stackprints admin");
    limited = true;
    await expect(store.head()).rejects.toThrow(/403 API rate limit exceeded; GitHub's rate limit is spent until 2026-/);
  });
});
