import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { logoProblems } from "../../lib/validate.mjs";
import { check, loadChangeset, mutate, openChangeset, versionOf } from "../src/core/changeset";
import { paths } from "../src/core/content";
import type { Page } from "../src/core/receipts";
import { recordPage } from "../src/core/receipts";
import { registerTools } from "../src/core/tool";
import type { Option, Principal, Stack } from "../src/core/types";
import { adminProposeTools, mergeNews } from "../src/tools/admin-propose";
import { OWNER, adminDeps, call, connect, repoFiles } from "./helpers";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const SHA = "0123456789abcdef0123456789abcdef01234567";

type Pages = Record<string, { title?: string; text: string; published?: string }>;

const PAGES: Pages = {
  "https://e2b.dev/blog/gpu": { title: "E2B adds GPU sandboxes | E2B", text: "GPU sandboxes are here.", published: "2026-10-21" },
  "https://techcrunch.com/2026/10/20/e2b-series-b/": { title: "E2B raises a Series B", text: "E2B raised money.", published: "2026-10-20" },
  "https://e2b.dev/blog/templates-v2": { title: "Templates v2", text: "Templates, again.", published: "2026-10-18" },
  "https://e2b.dev/blog/regions": { title: "New regions", text: "More regions.", published: "2026-10-15" },
  "https://e2b.dev/blog/odd": { title: "Something else entirely", text: "Odd.", published: "2026-10-10" },
  "https://e2b.dev/blog/undated": { title: "Undated post", text: "No date here." },
  "https://e2b.dev/pricing": {
    title: "Pricing | E2B",
    text: "Hobby: $0 per month plus usage, with $100 in one-time credits. Pro: $150 per month plus usage. Sandboxes start in about 150 ms.",
  },
  "https://boxwood.dev": { title: "Boxwood", text: "Boxwood runs agent code in gVisor sandboxes. Licensed under Apache-2.0." },
  "https://e2b.dev/cloud": { title: "E2B Cloud", text: "E2B Cloud hosts your agents. Deploy in one command." },
  "https://pi.dev/blog/1-0": { title: "Pi 2.0 notes", text: "Pi 1.0 is out with a plugin registry.", published: "2026-10-19" },
  "https://e2b.dev/blog/series-b-recap": { title: "Our Series B", text: "We raised.", published: "2026-10-20" },
  "https://pi.dev/press": { title: "Pi press", text: "Press kit." },
  [`https://github.com/earendil-works/pi/blob/${SHA}/prompts/system.md`]: {
    title: "pi/prompts/system.md",
    text: "You are Pi, a coding agent in the terminal.\nUse the read, write, edit and bash tools.\n\nSummarize the conversation below.\nKeep it under 200 words.",
  },
};

/** An admin server with only the propose tools, an open changeset, and helpers to fetch and inspect. */
async function setup(over: { principal?: Principal; pages?: Pages } = {}) {
  const { deps, store, state } = adminDeps({ pages: { ...PAGES, ...over.pages }, ...(over.principal ? { principal: over.principal } : {}) });
  const client = await connect(() => {
    const server = new McpServer({ name: "admin-test", version: "0.0.0" });
    registerTools(server, { principal: deps.principal, state, now: deps.now }, adminProposeTools(deps));
    return server;
  });
  const cs = await openChangeset(state, { kind: "mixed", title: "test", principal: OWNER, baseSha: await store.head(), now: NOW });
  /** What fetch_source does: read the page and keep a receipt. */
  const fetchSource = async (...urls: string[]) => {
    for (const u of urls) await recordPage(state, await deps.fetchPage(u), NOW);
  };
  const staged = async () => (await loadChangeset(state, cs.id))!;
  const json = async <T = any>(path: string) => JSON.parse((await staged()).changes[path]!) as T;
  const checked = async () => {
    const c = await staged();
    return check(await store.files(c.baseSha), c.changes, NOW);
  };
  return { deps, store, state, client, cs, fetchSource, staged, json, checked };
}

const e2b = () => JSON.parse(repoFiles().get(paths.option("sandbox", "e2b"))!) as Option;
const pi = () => JSON.parse(repoFiles().get(paths.stack("pi"))!) as Stack;

describe("changeset access", () => {
  it("lists the seven write tools for content:write, and none for a read-only key", async () => {
    const t = await setup();
    const { tools } = await t.client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual(
      ["propose_hot_list", "propose_logo", "propose_news", "propose_option_create", "propose_option_update", "propose_prompt", "propose_stack"].sort(),
    );
    for (const x of tools) {
      expect(x.annotations?.readOnlyHint).toBe(false);
      expect(x.inputSchema.required).toContain("changeset");
    }
    const reader = await setup({ principal: { name: "reader", kind: "apikey", scopes: ["content:read"] } });
    expect((await reader.client.listTools()).tools).toEqual([]);
  });

  it("refuses a changeset that doesn't exist or isn't open", async () => {
    const t = await setup();
    await expect(call(t.client, "propose_news", { changeset: "nope", layer: "sandbox", id: "e2b", items: [] })).rejects.toThrow(/No changeset "nope"/);
    await mutate(t.state, t.cs.id, OWNER, (cs) => {
      cs.status = "closed";
    });
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [] })).rejects.toThrow(/is closed/);
  });

  it("refuses another owner's changeset to anyone, a publisher included", async () => {
    const writer: Principal = { name: "news-bot", kind: "apikey", keyId: "k1", scopes: ["content:read", "content:write"] };
    const t = await setup({ principal: writer });
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [] })).rejects.toThrow(/belongs to tester \(local\)/);

    const publisher: Principal = { name: "lead-agent", kind: "apikey", keyId: "k2", scopes: ["content:read", "content:write", "content:publish"] };
    const p = await setup({ principal: publisher });
    await expect(call(p.client, "propose_news", { changeset: p.cs.id, layer: "sandbox", id: "e2b", items: [] })).rejects.toThrow(/only its owner adds to it/);
    expect((await p.staged()).changes).toEqual({});

    // Its own changeset, though, a writer fills like anyone.
    const own = await openChangeset(t.state, { kind: "news", title: "mine", principal: writer, baseSha: await t.store.head(), now: NOW });
    expect((await call(t.client, "propose_news", { changeset: own.id, layer: "sandbox", id: "e2b", items: [] })).staged).toEqual(["content/news/sandbox/e2b.json"]);
  });

  it("stages concurrent proposals into one changeset, every one of them", async () => {
    const t = await setup();
    const targets = [
      ["sandbox", "e2b"],
      ["sandbox", "daytona"],
      ["router", "litellm"],
    ];
    const results = await Promise.all(targets.map(([layer, id]) => call(t.client, "propose_news", { changeset: t.cs.id, layer, id, items: [] })));
    expect(results.map((r) => r.staged[0]).sort()).toEqual(targets.map(([l, id]) => `content/news/${l}/${id}.json`).sort());
    const cs = await t.staged();
    expect(Object.keys(cs.changes).sort()).toEqual(targets.map(([l, id]) => `content/news/${l}/${id}.json`).sort());
    expect(cs.log).toHaveLength(3);
    expect((await t.checked()).ok).toBe(true);
  });

  it("recomputes a proposal that raced another on the same file, so both land", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/blog/gpu", "https://e2b.dev/blog/regions");
    // Both proposals read the changeset before either stages: the second must not overwrite the first.
    const files = t.store.files.bind(t.store);
    const parked: (() => void)[] = [];
    let reads = 0;
    t.store.files = async (sha?: string) => {
      if (++reads <= 2) await new Promise<void>((go) => (parked.push(go), parked.length === 2 && parked.forEach((f) => f())));
      return files(sha);
    };
    const items = [
      { date: "2026-10-21", title: "E2B adds GPU sandboxes", url: "https://e2b.dev/blog/gpu", source: "e2b.dev" },
      { date: "2026-10-15", title: "New regions", url: "https://e2b.dev/blog/regions", source: "e2b.dev" },
    ];
    await Promise.all(items.map((it) => call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [it] })));
    expect(reads).toBe(3);
    const n = await t.json("content/news/sandbox/e2b.json");
    for (const it of items) expect(n.items).toContainEqual(it);
    expect((await t.staged()).log).toHaveLength(2);
  });
});

describe("propose_news", () => {
  it("merges by the NEWS.md rule: dedupes, newest first, the 5 newest plus the last 30 days, updated today", async () => {
    const t = await setup();
    const fresh = [
      { date: "2026-10-15", title: "New regions", url: "https://e2b.dev/blog/regions", source: "e2b.dev" },
      { date: "2026-10-21", title: "E2B adds GPU sandboxes", url: "https://e2b.dev/blog/gpu", source: "e2b.dev" },
      { date: "2026-10-20", title: "E2B raises a Series B", url: "https://techcrunch.com/2026/10/20/e2b-series-b/", source: "techcrunch.com" },
      { date: "2026-10-18", title: "Templates v2", url: "https://e2b.dev/blog/templates-v2", source: "e2b.dev" },
    ];
    await t.fetchSource(...fresh.map((i) => i.url));
    const r = await call(t.client, "propose_news", {
      changeset: t.cs.id,
      layer: "sandbox",
      id: "e2b",
      items: [
        ...fresh,
        // Already listed: the same page with a tracking parameter, and the same story at another URL.
        { date: "2026-10-07", title: "Introducing E2B Secrets", url: "https://e2b.dev/resources/introducing-e2b-secrets/?utm_source=x", source: "e2b.dev" },
        { date: "2026-09-30", title: "Introducing  E2B embed", url: "https://news.example.com/e2b-embed", source: "news.example.com" },
      ],
    });
    expect(r.added).toHaveLength(4);
    expect(r.skipped).toEqual(["https://e2b.dev/resources/introducing-e2b-secrets/?utm_source=x", "https://news.example.com/e2b-embed"]);
    expect(r.warnings).toEqual([]);
    expect(r.next).toBe("validate_changeset, then submit_changeset");

    const n = await t.json(r.staged[0]);
    expect(n.updated).toBe("2026-10-22");
    // Six items: the 5 newest, plus 2026-09-30, which is inside the 30 days; older ones beyond the 5 drop.
    expect(n.items.map((i: { date: string }) => i.date)).toEqual(["2026-10-21", "2026-10-20", "2026-10-18", "2026-10-15", "2026-10-07", "2026-09-30"]);
    expect(r.dropped).toHaveLength(3);
    expect((await t.staged()).log).toEqual([expect.stringMatching(/^news sandbox\/e2b: 4 new items from https:\/\/e2b\.dev\/blog\/regions/)]);
    expect((await t.checked()).ok).toBe(true);
  });

  it("records 'checked, nothing new' with items: [], creating the news file if needed", async () => {
    const t = await setup();
    const r = await call(t.client, "propose_news", { changeset: t.cs.id, layer: "search", id: "brave-search", items: [] });
    expect(await t.json("content/news/search/brave-search.json")).toEqual({ updated: "2026-10-22", items: [] });
    expect(r.staged).toEqual(["content/news/search/brave-search.json"]);
    expect((await t.staged()).log).toEqual(["news search/brave-search: checked, nothing new"]);
    expect((await t.checked()).ok).toBe(true);
  });

  it("refuses an unfetched URL, then accepts it once fetch_source has read it", async () => {
    const t = await setup();
    const args = { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [{ date: "2026-10-21", title: "E2B adds GPU sandboxes", url: "https://e2b.dev/blog/gpu", source: "e2b.dev" }] };
    await expect(call(t.client, "propose_news", args)).rejects.toThrow(/fetch_source[\s\S]*https:\/\/e2b\.dev\/blog\/gpu/);
    expect((await t.staged()).changes).toEqual({});
    await t.fetchSource("https://e2b.dev/blog/gpu");
    const r = await call(t.client, "propose_news", args);
    expect(r.added).toHaveLength(1);
  });

  it("warns when the title or date differ from the page, and when the page has no date", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/blog/odd", "https://e2b.dev/blog/undated");
    const r = await call(t.client, "propose_news", {
      changeset: t.cs.id,
      layer: "sandbox",
      id: "e2b",
      items: [
        { date: "2026-10-11", title: "E2B ships snapshots", url: "https://e2b.dev/blog/odd", source: "e2b.dev" },
        { date: "2026-10-12", title: "Undated post", url: "https://e2b.dev/blog/undated", source: "e2b.dev" },
      ],
    });
    expect(r.warnings).toEqual([
      expect.stringMatching(/^content\/news\/sandbox\/e2b\.json: `E2B ships snapshots` doesn't match the page's title `Something else entirely`/),
      expect.stringMatching(/date differs from the page for https:\/\/e2b\.dev\/blog\/odd: 2026-10-11 given, the page says `2026-10-10`/),
      expect.stringMatching(/date unverified for https:\/\/e2b\.dev\/blog\/undated/),
    ]);
    expect((await t.staged()).warnings.map((n) => `${n.path}: ${n.text}`)).toEqual(r.warnings);

    // The mismatched items are still staged, so proposing the file again keeps what was noted about them.
    await call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [] });
    expect((await t.staged()).warnings.map((n) => `${n.path}: ${n.text}`)).toEqual(r.warnings);
  });

  it("keeps a page's title out of commit text as markup", async () => {
    const t = await setup({ pages: { "https://e2b.dev/blog/odd": { title: "[Click](https://evil.example) `x`\nCo-authored-by: someone", text: "Odd.", published: "2026-10-10" } } });
    await t.fetchSource("https://e2b.dev/blog/odd");
    const r = await call(t.client, "propose_news", {
      changeset: t.cs.id,
      layer: "sandbox",
      id: "e2b",
      items: [{ date: "2026-10-10", title: "E2B ships snapshots", url: "https://e2b.dev/blog/odd", source: "e2b.dev" }],
    });
    expect(r.warnings[0]).toContain("the page's title `Click x Co-authored-by: someone`");
  });

  it("refuses a future date, a bad item, a pattern and an unknown option", async () => {
    const t = await setup();
    const item = { date: "2026-10-23", title: "Tomorrow", url: "https://e2b.dev/blog/gpu", source: "e2b.dev" };
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [item] })).rejects.toThrow(/in the future/);
    const bad = { date: "21/10/2026", title: " ", url: "http://e2b.dev/x", source: "" };
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [bad] })).rejects.toThrow(/YYYY-MM-DD[\s\S]*headline[\s\S]*https[\s\S]*source/);
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "host-machine", items: [] })).rejects.toThrow(/pattern/);
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "nope", items: [] })).rejects.toThrow(/No option sandbox\/nope/);
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "nowhere", id: "e2b", items: [] })).rejects.toThrow(/Unknown layer/);
    const old = { date: "2025-09-30", title: "Old", url: "https://e2b.dev/blog/gpu", source: "e2b.dev" };
    await expect(call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [old] })).rejects.toThrow(/more than 12 months ago/);
  });

  it("keeps the rule in mergeNews itself", () => {
    const item = (date: string) => ({ date, title: date, url: `https://x.dev/${date}`, source: "x.dev" });
    const merged = mergeNews([item("2026-01-01"), item("2026-02-01")], ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map(item), "2026-10-22");
    expect(merged.map((i) => i.date)).toEqual(["2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    // Older than 12 months goes first, even when it would be among the 5 newest.
    const sparse = mergeNews([item("2025-10-01"), item("2025-11-01"), item("2026-03-01")], [], "2026-10-22");
    expect(sparse.map((i) => i.date)).toEqual(["2026-03-01", "2025-11-01"]);
  });
});

describe("propose_option_update", () => {
  const PRICING = "Hobby $0 + usage; Pro $150/month + usage";
  const claim = { field: "Pricing", url: "https://e2b.dev/pricing", quote: "Pro: $150 per month plus usage" };
  const at = paths.option("sandbox", "e2b");

  it("needs a claim for each changed fact and checks its quote against the fetched page", async () => {
    const t = await setup();
    const base = { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["Pricing", PRICING]] } };
    await expect(call(t.client, "propose_option_update", base)).rejects.toThrow(/unclaimed[\s\S]*Pricing/);

    await expect(call(t.client, "propose_option_update", { ...base, claims: [claim] })).rejects.toThrow(/not fetched by fetch_source/);
    await t.fetchSource("https://e2b.dev/pricing");
    await expect(call(t.client, "propose_option_update", { ...base, claims: [{ ...claim, quote: "Pro: $99 per month, all in" }] })).rejects.toThrow(/quote not found/);

    const r = await call(t.client, "propose_option_update", { ...base, claims: [claim] });
    expect(r.changedFacts).toEqual(["Pricing"]);
    const o = await t.json<Option>(at);
    expect(o.facts!.find(([k]) => k === "Pricing")![1]).toBe(PRICING);
    expect(o.researched).toBe("2026-10-22");
    // The verified claim is cited: its page joins sources and evidence, placed before researched.
    expect(o.sources).toEqual([{ title: "Pricing | E2B", url: "https://e2b.dev/pricing" }]);
    expect(o.evidence).toEqual({ Pricing: ["https://e2b.dev/pricing"] });
    expect(Object.keys(o).slice(-3)).toEqual(["sources", "evidence", "researched"]);
    expect((await t.staged()).log).toEqual(["option sandbox/e2b: facts (facts: Pricing) from https://e2b.dev/pricing"]);
    expect((await t.checked()).ok).toBe(true);
  });

  it("keeps the facts a patch doesn't mention, in place, and adds new labels at the end", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/pricing");
    await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["Pricing", PRICING]] }, claims: [claim] });
    const before = e2b().facts!;
    const o = await t.json<Option>(at);
    expect(o.facts).toEqual(before.map(([k, v]) => [k, k === "Pricing" ? PRICING : v]));
    expect(o.links).toEqual(e2b().links);
    expect(o.goodFor).toEqual(e2b().goodFor);

    const r = await call(t.client, "propose_option_update", {
      changeset: t.cs.id,
      layer: "sandbox",
      id: "e2b",
      patch: { facts: [["Cold start", "About 150 ms (vendor-reported)"]] },
      claims: [{ field: "Cold start", url: "https://e2b.dev/pricing", quote: "Sandboxes start in about 150 ms", vendorReported: true }],
    });
    expect(r.changedFacts).toEqual(["Cold start"]);
    expect(r.warnings).toEqual([]);
    const after = await t.json<Option>(at);
    expect(after.facts).toHaveLength(before.length + 1);
    expect(after.facts!.at(-1)).toEqual(["Cold start", "About 150 ms (vendor-reported)"]);
    expect(after.evidence).toEqual({ Pricing: ["https://e2b.dev/pricing"], "Cold start": ["https://e2b.dev/pricing"] });
    expect((await t.checked()).ok).toBe(true);
  });

  it("builds on earlier proposals in the same changeset and warns on unmarked vendor numbers", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/pricing");
    const r1 = await call(t.client, "propose_option_update", {
      changeset: t.cs.id,
      layer: "sandbox",
      id: "e2b",
      patch: { facts: [["Cold start", "About 150 ms"]] },
      claims: [{ field: "Cold start", url: "https://e2b.dev/pricing", quote: "Sandboxes start in about 150 ms", vendorReported: true }],
    });
    expect(r1.warnings).toEqual([expect.stringMatching(/Cold start is vendor-reported, so write its value with "\(vendor-reported\)"/)]);
    const r2 = await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { goodFor: ["Short-lived code runs"] } });
    // A new whole list names every item it drops.
    expect(r2.warnings).toEqual([`${at}: removed from goodFor: ${e2b().goodFor!.map((x) => JSON.stringify(x)).join(", ")}`]);
    const o = await t.json<Option>(at);
    expect(o.facts).toContainEqual(["Cold start", "About 150 ms"]);
    expect(o.goodFor).toEqual(["Short-lived code runs"]);
    expect(o.evidence).toEqual({ "Cold start": ["https://e2b.dev/pricing"] });
    expect((await t.staged()).log).toHaveLength(2);
    // Notes add up: both reach the commit for a person to read.
    expect((await t.staged()).warnings.map((n) => n.text)).toEqual([expect.stringMatching(/Cold start is vendor-reported/), expect.stringMatching(/^removed from goodFor/)]);
    expect((await t.checked()).ok).toBe(true);
  });

  it("refuses changes to id, order, name, logo, affiliation and exclusive, but not the same values sent back", async () => {
    const t = await setup();
    const args = (patch: Record<string, unknown>) => ({ changeset: t.cs.id, layer: "sandbox", id: "e2b", patch });
    await expect(call(t.client, "propose_option_update", args({ order: 99 }))).rejects.toThrow(/can't change order/);
    await expect(call(t.client, "propose_option_update", args({ affiliation: "Ours.", exclusive: true }))).rejects.toThrow(/can't change affiliation, exclusive/);
    await expect(call(t.client, "propose_option_update", args({ id: "e2b-2" }))).rejects.toThrow(/can't change id/);
    await expect(call(t.client, "propose_option_update", args({ name: "E2B Sandbox" }))).rejects.toThrow(/can't change name/);
    await expect(call(t.client, "propose_option_update", args({ logo: "openai" }))).rejects.toThrow(/can't change logo[\s\S]*propose_logo's assign/);
    await expect(call(t.client, "propose_option_update", args({ colour: "red" }))).rejects.toThrow();
    const r = await call(t.client, "propose_option_update", args({ id: "e2b", name: "E2B", order: e2b().order, note: "Firecracker sandboxes for agents" }));
    expect(r.changedFacts).toEqual([]);
  });

  it("records manual claims under the file, and drops them when the fact is proposed again with a verified claim", async () => {
    const t = await setup();
    const manual = { field: "License", url: "https://e2b.dev/legal/terms.pdf", reason: "PDF that fetch_source can't read" };
    const r = await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["License", "Apache-2.0 (runtime), proprietary (cloud)"]] }, manual: [manual] });
    expect(r.manual).toEqual([{ path: at, ...manual }]);
    expect((await t.staged()).manual).toEqual([{ path: at, ...manual }]);
    // Unchecked, so not cited.
    expect((await t.json<Option>(at)).evidence).toBeUndefined();
    expect((await t.checked()).ok).toBe(true);

    const u = await setup({ pages: { "https://e2b.dev/license": { title: "License", text: "E2B is licensed under Apache-2.0 for the runtime." } } });
    await call(u.client, "propose_option_update", { changeset: u.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["License", "Apache-2.0 (runtime)"]] }, manual: [manual] });
    await u.fetchSource("https://e2b.dev/license");
    await call(u.client, "propose_option_update", {
      changeset: u.cs.id,
      layer: "sandbox",
      id: "e2b",
      patch: { facts: [["License", "Apache-2.0"]] },
      claims: [{ field: "License", url: "https://e2b.dev/license", quote: "licensed under Apache-2.0" }],
    });
    expect((await u.staged()).manual).toEqual([]);
  });

  it("keeps a manual claim when the same file is proposed again for other fields, so the change still goes for review", async () => {
    const t = await setup();
    const manual = { field: "Pricing", url: "https://e2b.dev/legal/pricing.pdf", reason: "PDF that fetch_source can't read" };
    await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["Pricing", "$999 per hour"]] }, manual: [manual] });
    await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { note: "Cloud sandboxes for AI agents" } });
    expect((await t.staged()).manual).toEqual([{ path: at, ...manual }]);
    // Removing the fact settles it.
    await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: {}, removeFacts: ["Pricing"] });
    expect((await t.staged()).manual).toEqual([]);
  });

  it("removes facts only through removeFacts, with their evidence", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/pricing");
    await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["Pricing", PRICING]] }, claims: [claim] });
    await expect(call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: {}, removeFacts: ["Price"] })).rejects.toThrow(/doesn't have: "Price"/);
    await expect(
      call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["Pricing", "x"]] }, removeFacts: ["Pricing"], claims: [claim] }),
    ).rejects.toThrow(/both in facts and in removeFacts/);
    const r = await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: {}, removeFacts: ["Pricing"] });
    expect(r.removedFacts).toEqual(["Pricing"]);
    expect(r.warnings).toEqual([expect.stringMatching(/dropped evidence for Pricing/)]);
    const o = await t.json<Option>(at);
    expect(o.facts!.map(([k]) => k)).toEqual(e2b().facts!.map(([k]) => k).filter((k) => k !== "Pricing"));
    expect(o.evidence).toBeUndefined();
    expect((await t.staged()).log.at(-1)).toMatch(/removed facts Pricing/);
    expect((await t.checked()).ok).toBe(true);
  });

  it("merges links by key and sources by URL, and drops evidence whose source goes", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/pricing");
    await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { facts: [["Pricing", PRICING]] }, claims: [claim] });
    await call(t.client, "propose_option_update", {
      changeset: t.cs.id,
      layer: "sandbox",
      id: "e2b",
      patch: { links: { x: null, blog: "https://e2b.dev/pricing" }, sources: [{ title: "E2B pricing", url: "https://e2b.dev/pricing/" }] },
    });
    let o = await t.json<Option>(at);
    const { x, ...rest } = e2b().links!;
    expect(x).toBeDefined();
    expect(o.links).toEqual({ ...rest, blog: "https://e2b.dev/pricing" });
    // Retitled in place, its URL spelled as listed, so evidence still matches it.
    expect(o.sources).toEqual([{ title: "E2B pricing", url: "https://e2b.dev/pricing" }]);
    expect(o.evidence).toEqual({ Pricing: ["https://e2b.dev/pricing"] });

    await expect(call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: {}, removeSources: ["https://nope.example"] })).rejects.toThrow(
      /removeSources names URLs/,
    );
    const r = await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: {}, removeSources: ["https://e2b.dev/pricing"] });
    expect(r.warnings).toEqual([expect.stringMatching(/dropped https:\/\/e2b\.dev\/pricing from evidence for Pricing/), expect.stringMatching(/dropped evidence for Pricing/)]);
    o = await t.json<Option>(at);
    expect(o.sources).toBeUndefined();
    expect(o.evidence).toBeUndefined();
    expect((await t.checked()).ok).toBe(true);
  });

  it("refuses a change built on a version of the file other than the one the changeset sees", async () => {
    const t = await setup();
    const read = await versionOf(repoFiles().get(at));
    // Someone publishes a change to the option after the agent read it; the agent opens its changeset after that.
    t.store.push({ [at]: `${JSON.stringify({ ...e2b(), note: "Changed by someone else" }, null, 2)}\n` });
    const late = await openChangeset(t.state, { kind: "option", title: "late", principal: OWNER, baseSha: await t.store.head(), now: NOW });
    const args = { changeset: late.id, layer: "sandbox", id: "e2b", patch: { summary: "A new summary." } };
    const e = await t.client.callTool({ name: "propose_option_update", arguments: { ...args, expectedVersion: read } });
    expect(e.isError).toBe(true);
    expect(e.structuredContent).toMatchObject({ error: expect.stringMatching(/changed since you read it: re-read it with get_item/), path: at, expectedVersion: read });
    expect((await loadChangeset(t.state, late.id))!.changes).toEqual({});

    const now = await versionOf((await t.store.files()).get(at));
    const r = await call(t.client, "propose_option_update", { ...args, expectedVersion: now });
    expect(r.staged).toEqual([at]);
  });

  it("needs a receipt for a new url, as https://<url>", async () => {
    const t = await setup();
    await expect(call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { url: "e2b.dev/cloud" } })).rejects.toThrow(
      /notFetched[\s\S]*https:\/\/e2b\.dev\/cloud/,
    );
    await t.fetchSource("https://e2b.dev/cloud");
    expect((await call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { url: "e2b.dev/cloud" } })).staged).toEqual([at]);
  });

  it("refuses new URLs nobody fetched", async () => {
    const t = await setup();
    await expect(
      call(t.client, "propose_option_update", { changeset: t.cs.id, layer: "sandbox", id: "e2b", patch: { links: { blog: "https://e2b.dev/engineering-blog" } } }),
    ).rejects.toThrow(/notFetched[\s\S]*https:\/\/e2b\.dev\/engineering-blog/);
  });
});

describe("propose_option_create", () => {
  const cloud = {
    name: "E2B Cloud",
    url: "e2b.dev/cloud",
    note: "Hosted agents from E2B",
    profile: "product",
    summary: "E2B Cloud hosts agents.",
    facts: [["Deploy", "One command"]],
    links: { site: "https://e2b.dev/cloud" },
  };
  const claim = { field: "Deploy", url: "https://e2b.dev/cloud", quote: "Deploy in one command" };

  it("refuses a likely duplicate, and accepts it with notDuplicate, staging the news file", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/cloud");
    const args = { changeset: t.cs.id, layer: "hosting", option: cloud, claims: [claim] };
    await expect(call(t.client, "propose_option_create", args)).rejects.toThrow(/may already be in the catalogue[\s\S]*same domain e2b\.dev/);

    const r = await call(t.client, "propose_option_create", { ...args, notDuplicate: "A hosting product from the same company, not the sandbox" });
    expect(r.id).toBe("e2b-cloud");
    expect(r.staged).toEqual(["content/options/hosting/e2b-cloud.json", "content/news/hosting/e2b-cloud.json"]);
    expect(r.warnings).toEqual([expect.stringMatching(/possible duplicates sandbox\/e2b: A hosting product/)]);
    const o = await t.json<Option>("content/options/hosting/e2b-cloud.json");
    expect(Object.keys(o)).toEqual(["id", "name", "url", "note", "profile", "summary", "facts", "links", "sources", "evidence", "researched"]);
    expect(o.evidence).toEqual({ Deploy: ["https://e2b.dev/cloud"] });
    expect(o.researched).toBe("2026-10-22");
    expect(await t.json("content/news/hosting/e2b-cloud.json")).toEqual({ updated: "2026-10-22", items: [] });
    expect((await t.checked()).ok).toBe(true);
  });

  it("needs claims for every fact, a fetch for every URL, and no maintainer-only fields", async () => {
    const t = await setup();
    const option = { name: "Boxwood", url: "boxwood.dev", profile: "product", facts: [["Isolation", "gVisor"], ["License", "Apache-2.0"]], links: { site: "https://boxwood.dev" } };
    const args = { changeset: t.cs.id, layer: "sandbox", option };
    await expect(call(t.client, "propose_option_create", { ...args, option: { ...option, order: 5 } })).rejects.toThrow(/Leave out order/);
    await expect(call(t.client, "propose_option_create", { ...args, option: { ...option, logo: "openai", exclusive: true } })).rejects.toThrow(/Leave out logo and exclusive[\s\S]*propose_logo/);
    await expect(call(t.client, "propose_option_create", args)).rejects.toThrow(/unclaimed[\s\S]*Isolation[\s\S]*License/);
    const claims = [
      { field: "Isolation", url: "https://boxwood.dev", quote: "runs agent code in gVisor sandboxes" },
      { field: "License", url: "https://boxwood.dev", quote: "Licensed under Apache-2.0" },
    ];
    await expect(call(t.client, "propose_option_create", { ...args, claims })).rejects.toThrow(/not fetched/);
    await t.fetchSource("https://boxwood.dev");
    const r = await call(t.client, "propose_option_create", { ...args, claims });
    expect(r.staged).toEqual(["content/options/sandbox/boxwood.json", "content/news/sandbox/boxwood.json"]);
    await expect(call(t.client, "propose_option_create", { ...args, claims })).rejects.toThrow(/already exists/);
    expect((await t.checked()).ok).toBe(true);
  });

  it("needs a receipt for the option's url, as https://<url>", async () => {
    const t = await setup();
    await t.fetchSource("https://e2b.dev/cloud");
    const option = { ...cloud, url: "e2b.dev/cloud/v2" };
    await expect(call(t.client, "propose_option_create", { changeset: t.cs.id, layer: "hosting", option, claims: [claim], notDuplicate: "Hosting, not the sandbox" })).rejects.toThrow(
      /notFetched[\s\S]*https:\/\/e2b\.dev\/cloud\/v2/,
    );
  });

  it("gives a pattern no news file", async () => {
    const t = await setup();
    const r = await call(t.client, "propose_option_create", {
      changeset: t.cs.id,
      layer: "proactivity",
      option: { name: "Morning digest loop", profile: "pattern", note: "Daily summary run", how: ["Wake at 7", "Collect", "Send"] },
    });
    expect(r.staged).toEqual(["content/options/proactivity/morning-digest-loop.json"]);
    expect((await t.checked()).ok).toBe(true);
  });
});

describe("propose_stack", () => {
  it("replaces a stack with the object sent, keeping its key order, and warns on fields left out", async () => {
    const t = await setup();
    const s = { ...pi(), tagline: "A minimal coding agent you extend yourself." };
    // Replacing a whole file needs the version it was read at.
    await expect(call(t.client, "propose_stack", { changeset: t.cs.id, stack: s })).rejects.toThrow(/content\/stacks\/pi\.json exists, so replacing it needs expectedVersion/);
    const r = await call(t.client, "propose_stack", { changeset: t.cs.id, stack: s, expectedVersion: await versionOf(repoFiles().get("content/stacks/pi.json")) });
    expect(r.replaced).toBe(true);
    expect(r.warnings).toEqual([]);
    const text = (await t.staged()).changes["content/stacks/pi.json"]!;
    expect(text).toBe(`${JSON.stringify(s, null, 2)}\n`);
    expect((await t.checked()).ok).toBe(true);

    const { logo, ...noLogo } = pi();
    // Main's version no longer matches: the changeset staged its own since.
    await expect(
      call(t.client, "propose_stack", { changeset: t.cs.id, stack: noLogo, expectedVersion: await versionOf(repoFiles().get("content/stacks/pi.json")) }),
    ).rejects.toThrow(/changed since you read it/);
    const r2 = await call(t.client, "propose_stack", { changeset: t.cs.id, stack: noLogo, expectedVersion: await versionOf(text) });
    expect(logo).toBe("pi");
    expect(r2.warnings).toEqual([expect.stringMatching(/leaves out logo/)]);
    expect(JSON.parse((await t.staged()).changes["content/stacks/pi.json"]!).logo).toBeUndefined();
  });

  it("refuses new unfetched sources, and creates a stack once they are fetched", async () => {
    const t = await setup();
    const s = {
      name: "Pi Press",
      kind: "Coding agent",
      tagline: "Pi, for the press.",
      description: "An example design for a press desk.",
      disclosure: "example",
      sources: [{ title: "Pi press", url: "https://pi.dev/press" }],
      layers: { harness: "pi", model: "any-model" },
    };
    await expect(call(t.client, "propose_stack", { changeset: t.cs.id, stack: s })).rejects.toThrow(/https:\/\/pi\.dev\/press/);
    await t.fetchSource("https://pi.dev/press");
    const r = await call(t.client, "propose_stack", { changeset: t.cs.id, stack: s });
    expect(r.replaced).toBe(false);
    expect(r.staged).toEqual(["content/stacks/pi-press.json"]);
    const out = await t.json<Stack>("content/stacks/pi-press.json");
    expect(out.slug).toBe("pi-press");
    expect(out.researched).toBe("2026-10-22");
    expect(Object.keys(out).slice(0, 2)).toEqual(["slug", "name"]);
    await expect(call(t.client, "propose_stack", { changeset: t.cs.id, stack: { ...s, disclosure: undefined } })).rejects.toThrow();
  });
});

describe("file layout", () => {
  it("writes a news file in the layout it already has, so a re-check changes one line", async () => {
    const t = await setup();
    const at = paths.news("sandbox", "e2b");
    const before = repoFiles().get(at)!;
    await call(t.client, "propose_news", { changeset: t.cs.id, layer: "sandbox", id: "e2b", items: [] });
    const after = (await t.staged()).changes[at]!;
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(after.split("\n")).toHaveLength(before.split("\n").length);
    expect(changed).toEqual(['  "updated": "2026-10-22",']);
  });
});

describe("propose_hot_list", () => {
  /** The version of the hot list on main: a list is replaced whole, so it names the one it was built on. */
  const hotVersion = () => versionOf(repoFiles().get(paths.hot));

  it("writes the list with the 7-day window ending today, after every source is fetched", async () => {
    const t = await setup();
    const post = "https://x.com/badlogic/status/1";
    const list = {
      changeset: t.cs.id,
      expectedVersion: await hotVersion(),
      stacks: [
        {
          stack: "pi",
          why: "Pi 1.0 shipped a plugin registry; the release thread drew wide replies.",
          since: "2026-10-19",
          sources: [
            { title: "@badlogic: Pi 1.0 is out with a plugin registry…", url: post, date: "2026-10-19" },
            { title: "Pi 1.0 notes", url: "https://pi.dev/blog/1-0", date: "2026-10-19" },
          ],
        },
      ],
      options: [{ option: "sandbox/e2b", why: "E2B raised a Series B and posted a recap.", sources: [{ title: "Our Series B", url: "https://e2b.dev/blog/series-b-recap", date: "2026-10-21" }] }],
    };
    await expect(call(t.client, "propose_hot_list", list)).rejects.toThrow(/search_x[\s\S]*x\.com\/badlogic/);

    // search_x keeps a receipt for each post it returns.
    const x: Omit<Page, "sha256" | "fetchedAt"> = { url: post, finalUrl: post, status: 200, title: null, published: "2026-10-19", text: "Pi 1.0 is out with a plugin registry. Try it.", via: "x-api" };
    await recordPage(t.state, x, NOW);
    await t.fetchSource("https://pi.dev/blog/1-0", "https://e2b.dev/blog/series-b-recap");
    const r = await call(t.client, "propose_hot_list", list);
    expect(r).toMatchObject({ updated: "2026-10-22", from: "2026-10-15", staged: ["content/hot.json"] });
    // The post matches its text on X; the notes page has another title; the recap has another date.
    expect(r.warnings).toEqual([
      "content/hot.json: `Pi 1.0 notes` differs from the page's title `Pi 2.0 notes` (https://pi.dev/blog/1-0)",
      "content/hot.json: https://e2b.dev/blog/series-b-recap is dated 2026-10-21 here, the page says `2026-10-20`",
    ]);
    const hot = await t.json("content/hot.json");
    expect(hot).toEqual({ updated: "2026-10-22", from: "2026-10-15", stacks: list.stacks, options: list.options });
    expect((await t.checked()).ok).toBe(true);
  });

  const card = (sources: { title: string; url: string; date: string }[]) => ({ stack: "pi", why: "Pi 1.0 shipped a plugin registry.", since: "2026-10-19", sources });

  it("needs receipts from the last 48 hours, even for pages the content already cites", async () => {
    const t = await setup();
    const cited = JSON.parse(repoFiles().get(paths.hot)!).stacks[0].sources[0].url as string;
    const args = { changeset: t.cs.id, expectedVersion: await hotVersion(), stacks: [card([{ title: "Pi 1.0 notes", url: "https://pi.dev/blog/1-0", date: "2026-10-19" }])], options: [] };
    await recordPage(t.state, await t.deps.fetchPage("https://pi.dev/blog/1-0"), NOW - 3 * 864e5);
    await expect(call(t.client, "propose_hot_list", args)).rejects.toThrow(/read in the last 48 hours[\s\S]*pi\.dev\/blog\/1-0/);
    await expect(call(t.client, "propose_hot_list", { ...args, stacks: [card([{ title: "x", url: cited, date: "2026-10-19" }])] })).rejects.toThrow(/notFetched/);
    await recordPage(t.state, await t.deps.fetchPage("https://pi.dev/blog/1-0"), NOW - 36e5);
    expect((await call(t.client, "propose_hot_list", args)).staged).toEqual(["content/hot.json"]);
  });

  it("refuses a post titled for someone other than its author", async () => {
    const t = await setup();
    const post = "https://x.com/random_troll/status/2";
    const x: Omit<Page, "sha256" | "fetchedAt"> = { url: post, finalUrl: post, status: 200, title: "@random_troll: Pi 1.0 is out", published: "2026-10-19", text: "Pi 1.0 is out with a plugin registry.", via: "x-mirror", meta: { author: "@random_troll" } };
    await recordPage(t.state, x, NOW);
    const expectedVersion = await hotVersion();
    const send = (title: string) => call(t.client, "propose_hot_list", { changeset: t.cs.id, expectedVersion, stacks: [card([{ title, url: post, date: "2026-10-19" }])], options: [] });
    const e = await t.client.callTool({ name: "propose_hot_list", arguments: { changeset: t.cs.id, expectedVersion, stacks: [card([{ title: "@OpenAI: Pi 1.0 is out", url: post, date: "2026-10-19" }])], options: [] } });
    expect(e.isError).toBe(true);
    expect(e.structuredContent).toMatchObject({ error: expect.stringMatching(/must credit its own author/), miscredited: [{ url: post, credited: "@OpenAI", author: "@random_troll" }] });
    expect((await send("@Random_Troll: Pi 1.0 is out")).staged).toEqual(["content/hot.json"]);
  });

  it("requires the version it was read at, and checks it", async () => {
    const t = await setup();
    await t.fetchSource("https://pi.dev/blog/1-0");
    const args = { changeset: t.cs.id, stacks: [card([{ title: "Pi 2.0 notes", url: "https://pi.dev/blog/1-0", date: "2026-10-19" }])], options: [] };
    await expect(call(t.client, "propose_hot_list", args)).rejects.toThrow(/needs expectedVersion/);
    await expect(call(t.client, "propose_hot_list", { ...args, expectedVersion: "absent" })).rejects.toThrow(/changed since you read it/);
    const r = await call(t.client, "propose_hot_list", { ...args, expectedVersion: await versionOf(repoFiles().get(paths.hot)) });
    expect(r.staged).toEqual(["content/hot.json"]);
  });
});

describe("propose_prompt", () => {
  const source = `https://github.com/earendil-works/pi/blob/${SHA}/prompts/system.md`;
  const base = { stack: "pi", id: "short-system-prompt", layer: "persona", kind: "system-prompt", title: "System prompt", source, license: "MIT" };

  it("needs a system prompt on its fetched source in full, or a manual reason", async () => {
    const t = await setup();
    const text = "You are Pi, a coding agent in the terminal.\nUse the read, write, edit and bash tools.\n";
    await expect(call(t.client, "propose_prompt", { changeset: t.cs.id, ...base, text })).rejects.toThrow(/fetch_source/);
    await t.fetchSource(source);
    const r = await call(t.client, "propose_prompt", { changeset: t.cs.id, ...base, text, note: "The default\nsystem prompt." });
    expect(r).toMatchObject({ staged: ["content/prompts/pi/short-system-prompt.md"], replaced: false });
    expect((await t.staged()).changes["content/prompts/pi/short-system-prompt.md"]).toBe(
      `---\nlayer: persona\nkind: system-prompt\ntitle: System prompt\nsource: ${source}\nlicense: MIT\nretrieved: 2026-10-22\nnote: The default system prompt.\n---\n${text}`,
    );
    expect((await t.checked()).ok).toBe(true);

    const edited = "You are Pi, the best coding agent.\nUse the read, write, edit and bash tools.";
    await expect(call(t.client, "propose_prompt", { changeset: t.cs.id, ...base, text: edited })).rejects.toThrow(/isn't on the source page[\s\S]*the best coding agent/);
    const m = await call(t.client, "propose_prompt", { changeset: t.cs.id, ...base, text: edited, manualReason: "The page renders the prompt with a variable name" });
    expect(m.replaced).toBe(true);
    expect((await t.staged()).manual).toEqual([
      { path: "content/prompts/pi/short-system-prompt.md", field: "prompt pi/short-system-prompt", url: source, reason: "The page renders the prompt with a variable name" },
    ]);
  });

  it("checks a template's opening literal text, placeholders aside", async () => {
    const t = await setup();
    await t.fetchSource(source);
    const args = { changeset: t.cs.id, ...base, id: "summary-template", layer: "harness", kind: "template", title: "Summary" };
    const r = await call(t.client, "propose_prompt", { ...args, text: "Summarize the conversation below.\n{{messages}}\nKeep it under 200 words." });
    expect(r.staged).toEqual(["content/prompts/pi/summary-template.md"]);
    await expect(call(t.client, "propose_prompt", { ...args, text: "First compaction:\n\nSummarize the conversation below.\n{{messages}}" })).rejects.toThrow(/First compaction:/);
    expect((await t.checked()).ok).toBe(true);
  });

  it("refuses an unpinned GitHub source and an unknown stack", async () => {
    const t = await setup();
    await expect(call(t.client, "propose_prompt", { changeset: t.cs.id, ...base, source: "https://github.com/earendil-works/pi/blob/main/prompts/system.md", text: "x" })).rejects.toThrow(/40-character commit SHA/);
    await expect(call(t.client, "propose_prompt", { changeset: t.cs.id, ...base, stack: "nope", text: "x" })).rejects.toThrow(/No stack "nope"/);
  });
});

describe("propose_logo", () => {
  const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>';

  it("refuses an SVG that would run, load or hard-code a colour, with the problems npm run check lists", async () => {
    const t = await setup();
    const bad = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="https://evil.example"><path fill="#000" stroke="red" style="fill: blue" onclick="x()" d="M0 0"/></a><rect fill="url(https://x.example/p.svg)"/></svg>';
    const r = await t.client.callTool({ name: "propose_logo", arguments: { changeset: t.cs.id, name: "bad", svg: bad } });
    expect(r.isError).toBe(true);
    // The same rules as the validator CI runs, so the tool and npm run check can't disagree.
    expect((r.structuredContent as { problems: string[] }).problems).toEqual(logoProblems(bad));
    expect(logoProblems(bad)).toEqual(
      expect.arrayContaining([
        "needs a viewBox on the <svg> element",
        expect.stringMatching(/^<script> is not allowed/),
        "<a> href: links are only allowed on <use>, as #id",
        "<path> onclick: event handlers are not allowed",
        expect.stringMatching(/^<path> fill="#000": logos are one colour/),
        expect.stringMatching(/^<rect> fill="url\(https:\/\/x\.example\/p\.svg\)"/),
      ]),
    );
    expect(logoProblems(good.replace("</svg>", `<path d="${"M0 0".repeat(2100)}"/></svg>`))).toEqual([expect.stringMatching(/bytes; keep logos under 8000/)]);
    await expect(call(t.client, "propose_logo", { changeset: t.cs.id, name: "Bad Name", svg: good })).rejects.toThrow(/kebab-case/);
    expect((await t.staged()).changes).toEqual({});
  });

  it("accepts every logo already in the repository", () => {
    for (const [p, svg] of repoFiles()) if (p.startsWith("content/logos/")) expect([p, logoProblems(svg)]).toEqual([p, []]);
  });

  it("stages the logo and assigns it to an option and a stack", async () => {
    const t = await setup();
    const r = await call(t.client, "propose_logo", { changeset: t.cs.id, name: "e2b", svg: `${good}\n`, assign: { option: "sandbox/e2b", stack: "pi" } });
    expect(r.staged).toEqual(["content/logos/e2b.svg", "content/options/sandbox/e2b.json", "content/stacks/pi.json"]);
    expect((await t.staged()).changes["content/logos/e2b.svg"]).toBe(good);
    const o = await t.json<Option>(paths.option("sandbox", "e2b"));
    expect(o.logo).toBe("e2b");
    expect(Object.keys(o).indexOf("logo")).toBe(Object.keys(o).indexOf("open") + 1);
    expect((await t.json<Stack>("content/stacks/pi.json")).logo).toBe("e2b");
    expect((await t.staged()).log).toEqual(["logo e2b added, set on sandbox/e2b and stack pi"]);
    expect((await t.checked()).ok).toBe(true);
    await expect(call(t.client, "propose_logo", { changeset: t.cs.id, name: "x", svg: good, assign: { option: "e2b" } })).rejects.toThrow(/layer\/id/);
  });
});
