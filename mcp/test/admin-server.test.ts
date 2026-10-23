import { describe, expect, it } from "vitest";
import type { AdminDeps } from "../src/core/deps";
import type { Principal, Scope } from "../src/core/types";
import { ADMIN_INSTRUCTIONS, createAdminServer } from "../src/servers/admin";
import { adminChangesetTools } from "../src/tools/admin-changesets";
import { adminProposeTools } from "../src/tools/admin-propose";
import { adminReadTools } from "../src/tools/admin-read";
import { PUBLIC_READ_TOOLS, publicTools } from "../src/tools/public";
import { OWNER, adminDeps, call, connect } from "./helpers";

const NEWS_URL = "https://e2b.dev/blog/gpu";
const PAGES = { [NEWS_URL]: { title: "E2B adds GPU sandboxes | E2B", text: "GPU sandboxes are here: start one with a single flag.", published: "2026-10-21" } };

const principal = (name: string, scopes: Scope[]): Principal => ({ name, kind: "apikey", keyId: `${name}-key`, scopes });
/** The owner signed in with GitHub: every scope, key tools included (the local server has none). */
const GH_OWNER: Principal = { name: "mehdidjabri", kind: "github", login: "mehdidjabri", githubId: 1470765, scopes: OWNER.scopes };

async function serve(over: Partial<AdminDeps> = {}) {
  const t = adminDeps({ pages: PAGES, ...over });
  const client = await connect(() => createAdminServer(t.deps));
  const names = (await client.listTools()).tools.map((x) => x.name).sort();
  return { ...t, client, names };
}

/** Every tool the admin server can offer, by the scope it needs ("public" for none): the catalogue readers, never the submission tools. */
function byScope() {
  const { deps } = adminDeps({ principal: GH_OWNER });
  const out = new Map<string, string[]>();
  const reads = publicTools(deps).filter((t) => (PUBLIC_READ_TOOLS as readonly string[]).includes(t.name));
  for (const spec of [...reads, ...adminReadTools(deps), ...adminChangesetTools(deps), ...adminProposeTools(deps)]) {
    const k = spec.scope ?? "public";
    out.set(k, [...(out.get(k) ?? []), spec.name]);
  }
  return out;
}

describe("createAdminServer", () => {
  it("names itself and tells agents how an update run works", async () => {
    const t = await serve();
    expect(t.client.getServerVersion()?.name).toBe("stackprints-admin");
    const instructions = t.client.getInstructions() ?? "";
    expect(instructions).toBe(ADMIN_INSTRUCTIONS);
    for (const step of ["whoami", "get_freshness_report", "get_research_rules", "open_changeset", "fetch_source", "search_x", "validate_changeset", "submit_changeset", "propose_hot_list", "get_hot_list"])
      expect(instructions).toContain(step);
    // What the review found agents needed told: ownership, versions, corrections, untrusted text, the hot list's receipts, pr fallback, revert.
    for (const rule of [
      "Give each subagent its own changeset",
      "expectedVersion",
      "list_corrections",
      "<<<UNTRUSTED PAGE TEXT",
      "48 hours",
      "submit again with mode pr",
      "call submit_changeset again",
      "revert_commit",
      "howToApply",
    ])
      expect(instructions).toContain(rule);
    expect(instructions).not.toMatch(/prepare_/);
  });

  it("offers the catalogue readers but none of the public submission tools", async () => {
    const t = await serve({ principal: GH_OWNER });
    for (const name of PUBLIC_READ_TOOLS) expect(t.names).toContain(name);
    for (const name of ["prepare_stack_submission", "prepare_option_submission", "prepare_correction", "get_submission_status", "validate_stack"]) expect(t.names).not.toContain(name);
  });

  it("gives the owner every public and admin tool, once each", async () => {
    const t = await serve({ principal: GH_OWNER });
    const all = [...byScope().values()].flat();
    expect(new Set(all).size).toBe(all.length);
    expect(t.names).toEqual([...all].sort());
    expect(t.names).toEqual(expect.arrayContaining(["search_stackprints", "get_stack", "whoami", "fetch_source", "list_corrections", "open_changeset", "submit_changeset", "revert_commit", "create_api_key", "propose_news", "propose_hot_list"]));
  });

  it("gives the local owner everything but the key tools", async () => {
    const t = await serve();
    const all = [...byScope().values()].flat().filter((n) => !["create_api_key", "list_api_keys", "revoke_api_key"].includes(n));
    expect(t.names).toEqual([...all].sort());
  });

  it("shows a content:read key the public and read tools only", async () => {
    const t = await serve({ principal: principal("reader", ["content:read"]) });
    const scopes = byScope();
    expect(t.names).toEqual([...scopes.get("public")!, ...scopes.get("content:read")!].sort());
    for (const name of [...scopes.get("content:write")!, ...scopes.get("content:publish")!, ...scopes.get("keys:manage")!]) expect(t.names).not.toContain(name);
  });

  it("shows a content:write key no revert and no key tools", async () => {
    const t = await serve({ principal: principal("writer", ["content:read", "content:write"]) });
    expect(t.names).toContain("propose_news");
    expect(t.names).toContain("submit_changeset");
    for (const name of ["revert_commit", "create_api_key", "list_api_keys", "revoke_api_key"]) expect(t.names).not.toContain(name);
  });

  it("shows a principal without scopes the public tools only", async () => {
    const t = await serve({ principal: principal("nobody", []) });
    expect(t.names).toEqual([...byScope().get("public")!].sort());
  });
});

describe("an update run through the admin server", () => {
  it("opens, fetches, proposes, validates and publishes to main, and audits each write", async () => {
    const t = await serve();
    const before = await t.store.head();

    const me = await call(t.client, "whoami");
    expect(me).toMatchObject({ name: OWNER.name, headSha: before, today: "2026-10-22", can: { write: true, publish: true, manageKeys: false } });

    const { changeset } = await call(t.client, "open_changeset", { kind: "news", title: "E2B news" });
    const page = await call(t.client, "fetch_source", { url: NEWS_URL });
    expect(page).toMatchObject({ status: 200, published: "2026-10-21", trust: expect.stringMatching(/^untrusted/) });

    const item = { date: "2026-10-21", title: "E2B adds GPU sandboxes", url: NEWS_URL, source: "e2b.dev" };
    const proposed = await call(t.client, "propose_news", { changeset, layer: "sandbox", id: "e2b", items: [item] });
    expect(proposed.staged).toEqual(["content/news/sandbox/e2b.json"]);
    expect(proposed.added).toEqual([item]);

    const checked = await call(t.client, "validate_changeset", { changeset });
    expect(checked).toMatchObject({ ok: true, errors: [], willPublish: true });

    const submitted = await call(t.client, "submit_changeset", { changeset });
    expect(submitted).toMatchObject({ mode: "publish", files: ["content/news/sandbox/e2b.json"] });

    const head = await t.store.head();
    expect(head).not.toBe(before);
    expect(submitted.sha).toBe(head);
    expect(t.store.parentOf(head)).toBe(before);
    const news = JSON.parse((await t.store.files()).get("content/news/sandbox/e2b.json")!);
    expect(news.updated).toBe("2026-10-22");
    expect(news.items[0]).toEqual(item);
    const [commit] = await t.store.history(1);
    expect(commit.message).toMatch(/^news: E2B news\n/);
    expect(commit.message).toContain(`Agent: ${OWNER.name} (local)`);

    const log = await call(t.client, "get_audit_log", { limit: 20 });
    type Entry = { tool: string; outcome: string; who: { name: string }; detail?: string };
    const entries = log.entries as Entry[];
    // Reads are not audited; outside reads and writes are. The test clock stands still, so order is not compared.
    expect(entries.map((e) => e.tool).sort()).toEqual(["fetch_source", "open_changeset", "propose_news", "submit_changeset", "validate_changeset"]);
    expect(entries.every((e) => e.outcome === "ok" && e.who.name === OWNER.name)).toBe(true);
    expect(entries.find((e) => e.tool === "submit_changeset")?.detail).toBe(submitted.url);

    const listed = await call(t.client, "list_changesets", { status: "submitted" });
    expect(listed.changesets).toEqual([expect.objectContaining({ id: changeset, result: expect.objectContaining({ mode: "publish", sha: head }) })]);
    expect((await call(t.client, "get_freshness_report")).lastWrite).toMatchObject({ tool: "submit_changeset", sha: head, changeset });

    // And undone, from the sha alone.
    const reverted = await call(t.client, "revert_commit", { sha: head, reason: "test run" });
    expect(t.store.parentOf(reverted.sha)).toBe(head);
    expect((await t.store.files()).get("content/news/sandbox/e2b.json")).toBe((await t.store.files(before)).get("content/news/sandbox/e2b.json"));
  });

  it("opens a pull request instead when the caller may write but not publish", async () => {
    const t = await serve({ principal: principal("writer", ["content:read", "content:write"]) });
    const before = await t.store.head();
    const { changeset } = await call(t.client, "open_changeset", { kind: "news", title: "E2B news" });
    await call(t.client, "fetch_source", { url: NEWS_URL });
    await call(t.client, "propose_news", { changeset, layer: "sandbox", id: "e2b", items: [{ date: "2026-10-21", title: "E2B adds GPU sandboxes", url: NEWS_URL, source: "e2b.dev" }] });
    expect((await call(t.client, "validate_changeset", { changeset })).willPublish).toBe(false);
    const submitted = await call(t.client, "submit_changeset", { changeset });
    expect(submitted).toMatchObject({ mode: "pr", number: 1 });
    expect(await t.store.head()).toBe(before);
    expect(t.store.pulls[0]).toMatchObject({ branch: `bot/news/${changeset}`, title: "news: E2B news" });
  });
});
