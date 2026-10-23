import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { verifyKey } from "../src/core/auth";
import { type Changeset, check, lastWrite, listChangesets, loadChangeset, mutate, openChangeset, stage } from "../src/core/changeset";
import type { AdminDeps } from "../src/core/deps";
import { type CommitResult, ProtectedBranchError, WrongBranchError } from "../src/core/store";
import { registerTools } from "../src/core/tool";
import type { Principal } from "../src/core/types";
import { adminChangesetTools, commitMessage, oneLine } from "../src/tools/admin-changesets";
import { OWNER, adminDeps, call, connect, repoFiles } from "./helpers";

const OPTION = "content/options/browser/browserbase.json";
const NEWS = "content/news/browser/browserbase.json";
const NOW = Date.parse("2026-10-22T12:00:00Z");

const WRITER: Principal = { name: "news-bot", kind: "apikey", keyId: "k1", scopes: ["content:read", "content:write"] };
const OTHER_WRITER: Principal = { name: "other-bot", kind: "apikey", keyId: "k2", scopes: ["content:read", "content:write"] };
const PUBLISHER: Principal = { name: "lead-agent", kind: "apikey", keyId: "k9", scopes: ["content:read", "content:write", "content:publish"] };
/** The owner signed in with GitHub: key tools are offered to signed-in callers, never to the local server. */
const GH_OWNER: Principal = { name: "mehdidjabri", kind: "github", login: "mehdidjabri", githubId: 1470765, scopes: ["content:read", "content:write", "content:publish", "keys:manage"] };

const client = (deps: AdminDeps) =>
  connect(() => {
    const server = new McpServer({ name: "admin", version: "0.0.0" });
    registerTools(server, { principal: deps.principal, state: deps.state, now: deps.now }, adminChangesetTools(deps));
    return server;
  });

/** The tool's error text, or a failure when it succeeds. */
async function failure(c: Awaited<ReturnType<typeof client>>, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args });
  expect(r.isError, `${name} should fail`).toBe(true);
  return (r.content as { text: string }[]).map((x) => x.text).join("\n");
}

/** The option file with its note replaced: a small, valid change (or an invalid one, past 60 characters). */
async function withNote(deps: AdminDeps, note: string) {
  const o = JSON.parse((await deps.store.files()).get(OPTION)!);
  return `${JSON.stringify({ ...o, note }, null, 2)}\n`;
}

/** Stages straight into state, as the propose_* tools would. */
async function stageInto(deps: AdminDeps, id: string, changes: Record<string, string | null>, extra: (cs: Changeset) => void = () => {}) {
  await mutate(deps.state, id, deps.principal, (cs) => {
    for (const [p, t] of Object.entries(changes)) stage(cs, p, t);
    cs.log.push("browserbase: note shortened");
    extra(cs);
  });
}

async function setup(principal: Principal = OWNER) {
  const { deps, store, state } = adminDeps({ principal });
  const c = await client(deps);
  const open = (kind = "option", title = "Browserbase note") => call(c, "open_changeset", { kind, title });
  return { deps, store, state, c, open };
}

describe("changesets: open, validate, submit", () => {
  it("publishes a valid change straight to main, and records its parent, paths and index", async () => {
    const { deps, store, state, c, open } = await setup();
    const before = await store.head();
    const opened = await open();
    expect(opened.baseSha).toBe(before);
    expect(opened.next).toMatch(/fetch_source/);

    const text = await withNote(deps, "Hosted browsers for agents");
    await stageInto(deps, opened.changeset, { [OPTION]: text });

    const v = await call(c, "validate_changeset", { changeset: opened.changeset });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.willPublish).toBe(true);
    expect(v.diff).toEqual([{ path: OPTION, change: "modified" }]);

    const r = await call(c, "submit_changeset", { changeset: opened.changeset });
    expect(r.mode).toBe("publish");
    expect(r.files).toEqual([OPTION]);
    expect(r.note).toMatch(/next deploy/);
    expect(await store.head()).toBe(r.sha);
    expect(store.parentOf(r.sha)).toBe(before);
    expect((await store.files()).get(OPTION)).toBe(text);

    const info = await store.commitInfo(r.sha);
    expect(info.paths).toEqual([OPTION]);
    expect(info.message.split("\n")[0]).toBe("option: Browserbase note");
    expect(info.message).toContain("- browserbase: note shortened");
    expect(info.message).toMatch(/\n\nAgent: tester \(local\)\nChangeset: [a-z0-9-]+$/);
    expect(info.message).toContain(`Changeset: ${opened.changeset}`);

    const cs = (await loadChangeset(state, opened.changeset))!;
    expect(cs.status).toBe("submitted");
    expect(cs.submitting).toBeUndefined();
    expect(cs.result).toMatchObject({ mode: "publish", sha: r.sha, parentSha: before, paths: [OPTION] });
    expect(await state.get(`published:${r.sha}`)).toBe(opened.changeset);
    expect(await lastWrite(state)).toMatchObject({ tool: "submit_changeset", who: "tester", mode: "publish", sha: r.sha, changeset: opened.changeset });

    const listed = await call(c, "list_changesets", { status: "submitted" });
    expect(listed.changesets).toEqual([expect.objectContaining({ id: opened.changeset, files: 1, status: "submitted", mine: true, result: expect.objectContaining({ sha: r.sha }) })]);
    expect((await call(c, "list_changesets", { status: "open" })).changesets).toEqual([]);

    await expect(call(c, "submit_changeset", { changeset: opened.changeset })).rejects.toThrow(/is submitted/);
  });

  it("is annotated as destructive: a publish replaces files on main", async () => {
    const { c } = await setup();
    const t = (await c.listTools()).tools.find((x) => x.name === "submit_changeset")!;
    expect(t.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true, readOnlyHint: false });
  });

  it("returns the changeset and its diff", async () => {
    const { deps, c, open } = await setup();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents"), "content/logos/brand-new.svg": null });
    const g = await call(c, "get_changeset", { changeset });
    expect(g.id).toBe(changeset);
    expect(g.mine).toBe(true);
    expect(g.owner).toBe("local:tester");
    expect(g.diff).toEqual([
      { path: "content/logos/brand-new.svg", change: "unchanged" },
      { path: OPTION, change: "modified" },
    ]);
    await expect(call(c, "get_changeset", { changeset: "nope" })).rejects.toThrow(/No changeset nope/);
  });

  it("rebases onto main when unrelated files changed, and refuses when the same file did", async () => {
    const { deps, store, c, open } = await setup();
    const a = await open();
    const b = await open("news", "Browserbase news");
    await stageInto(deps, a.changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    await stageInto(deps, b.changeset, { [OPTION]: await withNote(deps, "Headless browsers, hosted") });

    const news = JSON.parse((await store.files()).get(NEWS)!);
    const outside = store.push({ [NEWS]: `${JSON.stringify({ ...news, updated: "2026-10-22" }, null, 2)}\n` });

    const r = await call(c, "submit_changeset", { changeset: a.changeset });
    expect(store.parentOf(r.sha)).toBe(outside);
    const files = await store.files();
    expect(JSON.parse(files.get(NEWS)!).updated).toBe("2026-10-22");
    expect(JSON.parse(files.get(OPTION)!).note).toBe("Hosted browsers for agents");

    // b was opened before a published the same file.
    const v = await call(c, "validate_changeset", { changeset: b.changeset });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/main changed these files.*browserbase\.json/);
    await expect(call(c, "submit_changeset", { changeset: b.changeset })).rejects.toThrow(/main changed these files since the changeset was opened: close it, re-read with get_item and propose again/);
    expect(await store.head()).toBe(r.sha);
    // Refused without writing: it is open again, to close or fix.
    expect((await loadChangeset(deps.state, b.changeset))!.status).toBe("open");
  });

  it("accepts a file main changed to the very text the changeset proposes", async () => {
    const { deps, store, c, open } = await setup();
    const { changeset } = await open();
    const text = await withNote(deps, "Hosted browsers for agents");
    await stageInto(deps, changeset, { [OPTION]: text, [NEWS]: null });
    store.push({ [OPTION]: text });
    const r = await call(c, "submit_changeset", { changeset });
    // Only the file still different from main is written.
    expect(r.files).toEqual([NEWS]);
    expect((await store.files()).has(NEWS)).toBe(false);
  });

  it("retries once when main moves between reading its head and committing", async () => {
    const { deps, store, c, open } = await setup();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const commit = store.commit.bind(store);
    let calls = 0;
    let racer = "";
    store.commit = async (input): Promise<CommitResult> => {
      if (calls++ === 0) racer = store.push({ [NEWS]: (await store.files()).get(NEWS)!.replace("2026-10-21", "2026-10-22") });
      return commit(input);
    };
    const r = await call(c, "submit_changeset", { changeset });
    expect(calls).toBe(2);
    expect(store.parentOf(r.sha)).toBe(racer);
    expect((await loadChangeset(deps.state, changeset))!.result?.parentSha).toBe(racer);
  });

  it("gives up with a clear error when main keeps moving, and leaves the changeset open", async () => {
    const { deps, store, c, open } = await setup();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const commit = store.commit.bind(store);
    let n = 0;
    store.commit = async (input) => {
      store.push({ "content/logos/racer.svg": `<svg viewBox="0 0 1 ${++n}"></svg>` });
      return commit(input);
    };
    await expect(call(c, "submit_changeset", { changeset })).rejects.toThrow(/main kept moving/);
    const cs = (await loadChangeset(deps.state, changeset))!;
    expect(cs.status).toBe("open");
    expect(cs.submitting).toBeUndefined();
  });

  it("surfaces a wrong checkout without retrying, and a protected main with the way out", async () => {
    const { deps, store, c, open } = await setup();
    const head = await store.head();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const commit = store.commit.bind(store);
    let calls = 0;
    store.commit = async () => {
      calls++;
      throw new WrongBranchError("the checkout at /repo is on feature, not main: check out main there and submit again, or submit with mode pr");
    };
    const wrong = await failure(c, "submit_changeset", { changeset });
    expect(wrong).toMatch(/is on feature, not main/);
    expect(wrong).not.toMatch(/kept moving|Unexpected/);
    expect(calls).toBe(1);
    expect((await loadChangeset(deps.state, changeset))!.status).toBe("open");

    store.commit = async (input) => {
      if (input.mode === "publish") throw new ProtectedBranchError();
      return commit(input);
    };
    expect(await failure(c, "submit_changeset", { changeset })).toMatch(/only through pull requests: submit with mode pr/);
    expect((await loadChangeset(deps.state, changeset))!.status).toBe("open");
    const r = await call(c, "submit_changeset", { changeset, mode: "pr" });
    expect(r.mode).toBe("pr");
    expect(await store.head()).toBe(head);
  });

  it("finishes a publish whose answer was lost instead of writing it twice", async () => {
    const { deps, store, state, c, open } = await setup();
    const before = await store.head();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const commit = store.commit.bind(store);
    store.commit = async (input) => {
      await commit(input);
      throw new Error("socket hang up");
    };
    expect(await failure(c, "submit_changeset", { changeset })).toMatch(/Submitting failed: socket hang up\. It may have gone through: call submit_changeset again/);
    const landed = await store.head();
    expect(store.parentOf(landed)).toBe(before);
    const frozen = (await loadChangeset(state, changeset))!;
    expect(frozen.status).toBe("submitting");
    expect(frozen.submitting).toMatchObject({ mode: "publish", base: before, paths: [OPTION] });
    // Frozen: nothing more can be staged while the submit is unresolved.
    await expect(stageInto(deps, changeset, { [NEWS]: null })).rejects.toThrow(/is submitting/);

    store.commit = commit;
    const r = await call(c, "submit_changeset", { changeset });
    expect(r).toMatchObject({ mode: "publish", sha: landed, files: [OPTION] });
    expect(await store.head()).toBe(landed);
    expect((await loadChangeset(state, changeset))!.result).toMatchObject({ sha: landed, parentSha: before, paths: [OPTION] });
    expect(await state.get(`published:${landed}`)).toBe(changeset);
  });

  it("writes once when the same changeset is submitted twice at once", async () => {
    const { deps, store, c, open } = await setup();
    const before = await store.head();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const both = await Promise.all([0, 1].map(() => c.callTool({ name: "submit_changeset", arguments: { changeset } })));
    expect(both.filter((r) => !r.isError)).toHaveLength(1);
    const refused = both.find((r) => r.isError)!;
    expect((refused.content as { text: string }[])[0].text).toMatch(/is submitting/);
    expect(store.parentOf(await store.head())).toBe(before);
    expect((await loadChangeset(deps.state, changeset))!.status).toBe("submitted");
  });

  it("retries a lost pull request on the same branch, and says plainly when none was opened", async () => {
    const { deps, store, c, open } = await setup();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const commit = store.commit.bind(store);
    const branches: (string | undefined)[] = [];
    store.commit = async (input) => {
      branches.push(input.branch);
      if (branches.length === 1) throw new Error("timed out");
      const r = await commit(input);
      return { ...r, url: "branch:bot/x", number: 0, pushed: false, note: "the branch was kept locally; no pull request was opened (this checkout has no origin remote)" } as CommitResult;
    };
    await expect(call(c, "submit_changeset", { changeset, mode: "pr" })).rejects.toThrow(/may have gone through/);
    // A pull request that may exist can't become a publish on retry.
    expect(await failure(c, "submit_changeset", { changeset, mode: "publish" })).toMatch(/can only finish as one/);
    const r = await call(c, "submit_changeset", { changeset });
    expect(branches).toEqual([`bot/option/${changeset}`, `bot/option/${changeset}`]);
    expect(r).toMatchObject({ mode: "pr", pushed: false });
    expect(r.note).toMatch(/no pull request was opened.*no origin remote/);
    expect((await loadChangeset(deps.state, changeset))!.result).toMatchObject({ mode: "pr", pushed: false });
  });

  it("opens a pull request in pr mode and leaves main alone", async () => {
    const { deps, store, c, open } = await setup();
    const head = await store.head();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const r = await call(c, "submit_changeset", { changeset, mode: "pr", message: "option: shorter Browserbase note\nAsked by the owner." });
    expect(r).toMatchObject({ mode: "pr", number: 1, url: "memory://pull/1", note: "waiting for review", branch: `bot/option/${changeset}` });
    expect(await store.head()).toBe(head);
    expect(store.pulls).toHaveLength(1);
    const pull = store.pulls[0];
    expect(pull.title).toBe("option: shorter Browserbase note");
    expect(pull.branch).toBe(`bot/option/${changeset}`);
    expect(pull.body).toMatch(/^Asked by the owner\.\n\n- browserbase: note shortened\n\nAgent: tester \(local\)\nChangeset: /);
    expect((await loadChangeset(deps.state, changeset))!.result).toMatchObject({ mode: "pr", number: 1 });
  });

  it("sends a content:write principal's changes as a pull request and refuses publish", async () => {
    const { deps, store, c, open } = await setup(WRITER);
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["close_changeset", "get_changeset", "list_changesets", "open_changeset", "submit_changeset", "validate_changeset"]);

    const head = await store.head();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    expect((await call(c, "validate_changeset", { changeset })).willPublish).toBe(false);
    await expect(call(c, "submit_changeset", { changeset, mode: "publish" })).rejects.toThrow(/needs the content:publish scope/);
    const r = await call(c, "submit_changeset", { changeset });
    expect(r.mode).toBe("pr");
    expect(await store.head()).toBe(head);
    expect(store.pulls[0].body).toContain("Agent: news-bot (apikey)");
  });

  it("sends claims marked manual for review, and drops those on a file that ends up unchanged", async () => {
    const { deps, store, c, open } = await setup();
    const head = await store.head();
    const { changeset } = await open();
    const same = (await store.files()).get(NEWS)!;
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents"), [NEWS]: same }, (cs) => {
      cs.manual.push({ path: OPTION, field: "facts.Funding", url: "https://example.com/deck.pdf", reason: "PDF" });
      cs.manual.push({ path: NEWS, field: "news", url: "https://example.com/old.pdf", reason: "stale" });
      cs.warnings.push({ path: OPTION, text: "title differs from the page" }, { path: NEWS, text: "no longer relevant" });
    });
    const v = await call(c, "validate_changeset", { changeset });
    expect(v.ok).toBe(true);
    expect(v.willPublish).toBe(false);
    expect(v.manual).toEqual([{ path: OPTION, field: "facts.Funding", url: "https://example.com/deck.pdf", reason: "PDF" }]);
    expect(v.warnings).toContain(`${OPTION}: title differs from the page`);
    expect(v.warnings.join("\n")).not.toContain("no longer relevant");

    await expect(call(c, "submit_changeset", { changeset, mode: "publish" })).rejects.toThrow(/claims marked manual need a human: submit with mode pr/);
    const r = await call(c, "submit_changeset", { changeset });
    expect(r.mode).toBe("pr");
    expect(await store.head()).toBe(head);
    expect(store.pulls[0].body).toContain("MANUAL CHECK facts.Funding <https://example.com/deck.pdf>: PDF");
    expect(store.pulls[0].body).toContain(`Note: ${OPTION}: title differs from the page`);
    expect(store.pulls[0].body).not.toContain("old.pdf");
  });

  it("refuses content that fails the checks, with the validator's errors", async () => {
    const { deps, store, c, open } = await setup();
    const head = await store.head();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "x".repeat(80)) });
    const v = await call(c, "validate_changeset", { changeset });
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual([`${OPTION}: keep note under 60 characters`]);
    await expect(call(c, "submit_changeset", { changeset })).rejects.toThrow(/keep note under 60 characters/);
    expect(await store.head()).toBe(head);
  });

  it("never passes a changeset when the validator can't read the content at all", async () => {
    const { deps, store, c, open } = await setup();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    // Main itself breaks: the validator throws on both sides, which once counted as "preexisting".
    store.push({ "content/layers.json": "{ not json" });
    const v = await call(c, "validate_changeset", { changeset });
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toMatch(/content could not be read, so nothing else was checked/);
    await expect(call(c, "submit_changeset", { changeset })).rejects.toThrow(/doesn't pass the checks/);

    const files = repoFiles();
    expect(check(files, { "content/layers.json": "{ not json" }, NOW).ok).toBe(false);
    expect(check(new Map([...files, ["content/layers.json", "["]]), { "content/layers.json": files.get("content/layers.json")! }, NOW).ok).toBe(true);
  });

  it("refuses an empty changeset, or one that changes nothing", async () => {
    const { deps, store, c, open } = await setup();
    const empty = await open();
    const v = await call(c, "validate_changeset", { changeset: empty.changeset });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/nothing staged/);
    await expect(call(c, "submit_changeset", { changeset: empty.changeset })).rejects.toThrow(/nothing staged/);

    const same = await open();
    await stageInto(deps, same.changeset, { [OPTION]: (await store.files()).get(OPTION)! });
    expect((await call(c, "validate_changeset", { changeset: same.changeset })).ok).toBe(false);
    await expect(call(c, "submit_changeset", { changeset: same.changeset })).rejects.toThrow(/already matches main/);
  });
});

describe("ownership", () => {
  it("lets only the owner submit: a publisher can't publish a writer's changeset, but can close it", async () => {
    const mine = adminDeps({ principal: WRITER });
    const writer = await client(mine.deps);
    const publisher = await client({ ...mine.deps, principal: PUBLISHER });
    const head = await mine.store.head();

    const { changeset } = await call(writer, "open_changeset", { kind: "option", title: "Browserbase note" });
    await stageInto(mine.deps, changeset, { [OPTION]: await withNote(mine.deps, "Hosted browsers for agents") });

    const v = await call(publisher, "validate_changeset", { changeset });
    expect(v).toMatchObject({ ok: true, willPublish: false, owner: "news-bot (apikey)", note: "only its owner can submit it" });
    expect(await failure(publisher, "submit_changeset", { changeset })).toMatch(/belongs to news-bot \(apikey\): only its owner adds to it or submits it/);
    expect(await failure(publisher, "submit_changeset", { changeset, mode: "pr" })).toMatch(/belongs to news-bot/);
    expect(await mine.store.head()).toBe(head);
    expect(mine.store.pulls).toEqual([]);
    expect((await call(publisher, "list_changesets", { status: "open" })).changesets[0]).toMatchObject({ id: changeset, mine: false });

    expect(await call(publisher, "close_changeset", { changeset, reason: "superseded" })).toEqual({ closed: changeset });
    expect((await loadChangeset(mine.state, changeset))!.log.at(-1)).toBe("closed by lead-agent: superseded");
  });

  it("tells keys apart by id, not by name", async () => {
    const mine = adminDeps({ principal: WRITER });
    const writer = await client(mine.deps);
    // Same name, another key.
    const twin = await client({ ...mine.deps, principal: { ...WRITER, keyId: "k1-twin" } });
    const { changeset } = await call(writer, "open_changeset", { kind: "news", title: "Run" });
    await stageInto(mine.deps, changeset, { [OPTION]: await withNote(mine.deps, "Hosted browsers for agents") });
    expect(await failure(twin, "submit_changeset", { changeset })).toMatch(/belongs to news-bot/);
    expect(await failure(twin, "close_changeset", { changeset, reason: "mine now" })).toMatch(/Only news-bot \(apikey\)/);
  });

  it("adds an Author trailer when the submitter's name differs from the author's", () => {
    const cs: Parameters<typeof commitMessage>[0] = { id: "abc-123", kind: "news", title: "run", log: [], manual: [], warnings: [], author: { name: "old-login", kind: "github" } };
    const m = commitMessage(cs, { ...GH_OWNER, name: "new-login" });
    expect(m.body).toBe("Agent: new-login (github)\nAuthor: old-login (github)\nChangeset: abc-123");
    expect(commitMessage({ ...cs, author: { name: "new-login", kind: "github" } }, { ...GH_OWNER, name: "new-login" }).body).not.toContain("Author:");
  });
});

describe("close_changeset", () => {
  it("lets the author or a publisher close, and nobody else", async () => {
    const mine = adminDeps({ principal: WRITER });
    // Same store and state, different callers.
    const author = await client(mine.deps);
    const other = await client({ ...mine.deps, principal: OTHER_WRITER });
    const owner = await client({ ...mine.deps, principal: OWNER });

    const a = await call(author, "open_changeset", { kind: "news", title: "First run" });
    const b = await call(author, "open_changeset", { kind: "news", title: "Second run" });
    await expect(call(other, "close_changeset", { changeset: a.changeset, reason: "not mine" })).rejects.toThrow(/Only news-bot \(apikey\)/);
    expect(await call(author, "close_changeset", { changeset: a.changeset, reason: "main moved" })).toEqual({ closed: a.changeset });
    expect(await call(owner, "close_changeset", { changeset: b.changeset, reason: "duplicate" })).toEqual({ closed: b.changeset });

    const cs = (await loadChangeset(mine.state, a.changeset))!;
    expect(cs.status).toBe("closed");
    expect(cs.log.at(-1)).toBe("closed by news-bot: main moved");
    await expect(call(author, "close_changeset", { changeset: a.changeset, reason: "again" })).rejects.toThrow(/is closed/);
    await expect(call(author, "validate_changeset", { changeset: a.changeset })).rejects.toThrow(/is closed/);
  });

  it("records a publish an unanswered submit wrote instead of closing over it", async () => {
    const { deps, store, state, c, open } = await setup();
    const { changeset } = await open();
    await stageInto(deps, changeset, { [OPTION]: await withNote(deps, "Hosted browsers for agents") });
    const commit = store.commit.bind(store);
    store.commit = async (input) => {
      await commit(input);
      throw new Error("timed out");
    };
    await expect(call(c, "submit_changeset", { changeset })).rejects.toThrow(/may have gone through/);
    expect(await failure(c, "close_changeset", { changeset, reason: "give up" })).toMatch(/was published by an earlier submit/);
    expect((await loadChangeset(state, changeset))!).toMatchObject({ status: "submitted", result: { sha: await store.head() } });
  });
});

describe("list_changesets", () => {
  it("lists newest first, a page at a time", async () => {
    const { deps, state, c } = await setup();
    const base = await deps.store.head();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await openChangeset(state, { kind: "news", title: `run ${i}`, principal: OWNER, baseSha: base, now: NOW + i * 60_000 })).id);
    const first = await call(c, "list_changesets", { limit: 2 });
    expect(first.changesets.map((x: { id: string }) => x.id)).toEqual([ids[4], ids[3]]);
    const second = await call(c, "list_changesets", { limit: 2, cursor: first.cursor });
    expect(second.changesets.map((x: { id: string }) => x.id)).toEqual([ids[2], ids[1]]);
    const third = await call(c, "list_changesets", { limit: 2, cursor: second.cursor });
    expect(third.changesets.map((x: { id: string }) => x.id)).toEqual([ids[0]]);
    expect(third.cursor).toBeUndefined();

    // A status filter reads through pages of entries, never one changeset at a time.
    await mutate(state, ids[1], OWNER, (cs) => {
      cs.status = "closed";
    });
    const reads = { get: 0, entries: 0 };
    const get = state.get.bind(state);
    const entries = state.entries.bind(state);
    state.get = (async (k: string) => (reads.get++, get(k))) as typeof state.get;
    state.entries = (async (prefix: string, o?: { limit?: number; cursor?: string }) => (reads.entries++, entries(prefix, o))) as typeof state.entries;
    const open = await listChangesets(state, { status: "open" });
    expect(open.changesets.map((x) => x.id)).toEqual([ids[4], ids[3], ids[2], ids[0]]);
    expect(reads).toEqual({ get: 0, entries: 1 });
  });
});

describe("revert_commit", () => {
  async function published() {
    const s = await setup();
    const original = (await s.store.files()).get(OPTION)!;
    const { changeset } = await s.open();
    await stageInto(s.deps, changeset, { [OPTION]: await withNote(s.deps, "Hosted browsers for agents"), "content/logos/brand-new.svg": '<svg viewBox="0 0 1 1"></svg>' });
    const r = await call(s.c, "submit_changeset", { changeset });
    return { ...s, changeset, original, sha: r.sha as string };
  }

  it("restores the text from before the commit, from the recorded parent and paths", async () => {
    const { store, state, c, changeset, original, sha } = await published();
    // The index and the recorded paths are enough: a commit's own file list (300 a page on GitHub) is never read.
    store.commitInfo = async () => {
      throw new Error("not needed");
    };
    const r = await call(c, "revert_commit", { sha, reason: "wrong note" });
    expect(r.reverted.sort()).toEqual(["content/logos/brand-new.svg", OPTION]);
    expect(await store.head()).toBe(r.sha);
    const files = await store.files();
    expect(files.get(OPTION)).toBe(original);
    expect(files.has("content/logos/brand-new.svg")).toBe(false);
    const msg = (await store.history(1))[0].message;
    expect(msg.split("\n")[0]).toBe(`revert: ${sha.slice(0, 7)} wrong note`);
    expect(msg).toMatch(/Agent: tester \(local\)\nReverts: [0-9a-f]{40}$/);
    expect((await loadChangeset(state, changeset))!.revertedBy).toBe(r.sha);
    expect(await lastWrite(state)).toMatchObject({ tool: "revert_commit", sha: r.sha });
    await expect(call(c, "revert_commit", { sha, reason: "again" })).rejects.toThrow(/was reverted already/);
  });

  it("refuses when a file changed after the commit", async () => {
    const { deps, store, c, sha } = await published();
    store.push({ [OPTION]: await withNote(deps, "Edited by hand") });
    await expect(call(c, "revert_commit", { sha, reason: "wrong note" })).rejects.toThrow(/These files changed after that commit: revert by hand/);
  });

  it("refuses commits outside content, and commits it did not publish", async () => {
    const { deps, store, c } = await setup();
    const docs = store.push({ "docs/RESEARCH.md": "rewritten" });
    await expect(call(c, "revert_commit", { sha: docs, reason: "nope" })).rejects.toThrow(/only content commits can be reverted here/);
    const outside = store.push({ [OPTION]: await withNote(deps, "Pushed by a person") });
    await expect(call(c, "revert_commit", { sha: outside, reason: "nope" })).rejects.toThrow(/only revert commits it published/);
    await expect(call(c, "revert_commit", { sha: "abcdef1", reason: "nope" })).rejects.toThrow(/No commit abcdef1/);
  });

  it("is only offered to publishers", async () => {
    const { c } = await setup(WRITER);
    expect((await c.listTools()).tools.map((t) => t.name)).not.toContain("revert_commit");
    const { c: owner } = await setup();
    const t = (await owner.listTools()).tools.find((x) => x.name === "revert_commit")!;
    expect(t.annotations?.destructiveHint).toBe(true);
  });
});

describe("API keys", () => {
  it("mints a key once, verifies it, lists it without the key and revokes it", async () => {
    const { state, c } = await setup(GH_OWNER);
    const made = await call(c, "create_api_key", { name: "news run", scopes: ["content:write"] });
    expect(made.key).toMatch(/^spk_/);
    expect(made.shownOnce).toMatch(/only time/);
    expect(made.scopes).toEqual(["content:read", "content:write"]);
    expect(made.how).toBe("send it as Authorization: Bearer <key> to the admin MCP URL");

    const record = await verifyKey(state, made.key, { now: NOW });
    expect(record).toMatchObject({ id: made.id, name: "news run", createdBy: "mehdidjabri", createdById: "github:1470765" });

    const listed = await call(c, "list_api_keys");
    expect(listed.keys).toEqual([expect.objectContaining({ id: made.id, name: "news run", scopes: ["content:read", "content:write"], createdBy: "mehdidjabri" })]);
    expect(listed.bootstrapKey).toMatch(/^refused/);
    expect(JSON.stringify(listed)).not.toContain(made.key);

    expect(await call(c, "revoke_api_key", { id: made.id })).toEqual({ revoked: made.id, name: "news run" });
    expect(await verifyKey(state, made.key)).toBeNull();
    expect((await call(c, "list_api_keys")).keys).toEqual([]);
    expect((await call(c, "list_api_keys")).bootstrapKey).toMatch(/^accepted/);
    await expect(call(c, "revoke_api_key", { id: made.id })).rejects.toThrow(/No API key with id/);
  });

  it("can't grant, list or revoke beyond the caller's own scopes", async () => {
    const t = adminDeps({ principal: GH_OWNER });
    const owner = await client(t.deps);
    const publish = await call(owner, "create_api_key", { name: "publisher", scopes: ["content:publish"] });
    const keeperKey = await call(owner, "create_api_key", { name: "key-keeper", scopes: ["content:write", "keys:manage"] });
    const keeper: Principal = { name: "key-keeper", kind: "apikey", keyId: keeperKey.id, scopes: keeperKey.scopes };
    const k = await client({ ...t.deps, principal: keeper });

    await expect(call(k, "create_api_key", { name: "too much", scopes: ["content:publish"] })).rejects.toThrow(/can't grant scopes you don't hold: content:publish/);
    const ok = await call(k, "create_api_key", { name: "reader", scopes: ["content:read"] });
    expect(ok.scopes).toEqual(["content:read"]);
    await expect(call(k, "create_api_key", { name: "bad", scopes: ["root"] })).rejects.toThrow();

    const seen = await call(k, "list_api_keys");
    expect(seen.keys.map((x: { name: string }) => x.name).sort()).toEqual(["key-keeper", "reader"]);
    expect(seen.notShown).toMatch(/^1 keys/);
    expect(await failure(k, "revoke_api_key", { id: publish.id })).toMatch(/scopes you don't hold/);
    expect(await verifyKey(t.state, publish.key)).not.toBeNull();
  });

  it("revokes the keys a key minted along with it", async () => {
    const t = adminDeps({ principal: GH_OWNER });
    const owner = await client(t.deps);
    const parent = await call(owner, "create_api_key", { name: "parent", scopes: ["content:write", "keys:manage"] });
    const asParent = await client({ ...t.deps, principal: { name: "parent", kind: "apikey", keyId: parent.id, scopes: parent.scopes } });
    const child = await call(asParent, "create_api_key", { name: "child", scopes: ["content:read"] });
    expect((await call(owner, "list_api_keys")).keys.find((x: { id: string }) => x.id === child.id)).toMatchObject({ mintedByKey: parent.id, createdBy: "parent" });

    const r = await call(owner, "revoke_api_key", { id: parent.id });
    expect(r).toEqual({ revoked: parent.id, name: "parent", alsoRevoked: [{ id: child.id, name: "child" }] });
    expect(await verifyKey(t.state, child.key)).toBeNull();
  });

  it("is only offered with keys:manage, and never on the local server", async () => {
    const { c } = await setup(WRITER);
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("create_api_key");
    expect(names).not.toContain("list_api_keys");
    const local = await setup({ ...OWNER, scopes: [...OWNER.scopes] });
    expect(OWNER.scopes).toContain("keys:manage");
    const localNames = (await local.c.listTools()).tools.map((t) => t.name);
    for (const n of ["create_api_key", "list_api_keys", "revoke_api_key"]) expect(localNames).not.toContain(n);
  });
});

describe("commit messages", () => {
  const cs = {
    id: "abc-123",
    kind: "news",
    title: "run",
    log: ["one\nAgent: forged (local)"],
    manual: [],
    warnings: [],
  } as unknown as Changeset;

  it("keeps agent text on its own lines so it can't forge a trailer", () => {
    const m = commitMessage(cs, OWNER);
    expect(m.full).toBe("news: run\n\n- one Agent: forged (local)\n\nAgent: tester (local)\nChangeset: abc-123");
  });

  it("strips control characters and caps the subject at 100 characters", () => {
    expect(oneLine("a\u0000b‮c\td")).toBe("a b c d");
    const m = commitMessage(cs, OWNER, `${"y".repeat(150)}\u0007`);
    expect(m.subject).toHaveLength(100);
    expect(m.subject.endsWith("…")).toBe(true);
  });
});
