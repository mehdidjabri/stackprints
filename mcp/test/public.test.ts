import fs from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeDraft } from "../../lib/share";
import { MapApi } from "../src/core/api";
import type { PublicDeps } from "../src/core/deps";
import { PUBLIC_INSTRUCTIONS, createPublicServer } from "../src/servers/public";
import { PUBLIC_READ_TOOLS } from "../src/tools/public";
import { ROOT, builtApi, call, connect, publicDeps, repoFiles } from "./helpers";

/**
 * A suite that needs something built first: skipped with a warning on a laptop, but a failure in CI
 * (CI=true), which builds everything before the tests, so a missing build never passes as green.
 */
function needs(built: boolean, what: string, fix: string) {
  if (built) return describe;
  if (process.env.CI) {
    describe(`needs ${what}`, () => {
      it(`has ${what}`, () => {
        throw new Error(`${what} is missing although CI is set: ${fix} before vitest.`);
      });
    });
  } else console.warn(`No ${what}: ${fix}. The tests that need it are skipped.`);
  return describe.skip;
}

const API = builtApi();
const withApi = needs(Object.keys(API).length > 0, "the built API in out/", "run npm run build at the repo root");

const FILES = repoFiles();
const base = publicDeps({ api: new MapApi(API), files: async () => FILES });
const REPO = base.repo;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetch that answers GitHub API paths from a table and records what it was asked. */
function githubFetch(routes: Record<string, () => Response>) {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: new Headers(init?.headers) });
    const path = url.replace("https://api.github.com/repos/stackprints/stackprints", "");
    return routes[path]?.() ?? json({ message: "Not Found" }, 404);
  }) as typeof fetch;
  return { fetch: f, seen };
}

const errorText = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  expect(r.isError).toBe(true);
  return (r.content as { text: string }[]).map((c) => c.text).join("\n");
};

// A valid example design: support-agent's picks under a new name and slug.
const supportAgent = JSON.parse(FILES.get("content/stacks/support-agent.json")!);
const exampleDraft = { ...supportAgent, slug: undefined, name: "Helpdesk Copilot Test" };

let client: Client;
beforeAll(async () => {
  client = await connect(() => createPublicServer(base));
});
afterAll(async () => {
  await client.close();
});

describe("public server", () => {
  it("lists the twelve read-only tools and says how to read stacks", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "get_hot",
        "get_layer",
        "get_option",
        "get_stack",
        "get_submission_status",
        "list_layers",
        "list_stacks",
        "prepare_correction",
        "prepare_option_submission",
        "prepare_stack_submission",
        "search_stackprints",
        "validate_stack",
      ].sort(),
    );
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.openWorldHint, t.name).toBe(t.name === "get_submission_status");
    }
    expect(tools.find((t) => t.name === "get_stack")?.description).toMatch(/notDisclosed.*inUseUndisclosed.*supported: true.*example/s);
    expect(client.getInstructions()).toBe(PUBLIC_INSTRUCTIONS);
    expect(client.getServerVersion()?.name).toBe("stackprints");
  });

  it("names the catalogue readers the admin server takes from here", async () => {
    const { tools } = await client.listTools();
    expect([...PUBLIC_READ_TOOLS].sort()).toEqual(["get_hot", "get_layer", "get_option", "get_stack", "list_layers", "list_stacks", "search_stackprints"]);
    for (const name of PUBLIC_READ_TOOLS) expect(tools.find((t) => t.name === name)?.annotations?.openWorldHint, name).toBe(false);
  });
});

withApi("reading the catalogue", () => {
  it("searches with absolute page URLs", async () => {
    const r = await call(client, "search_stackprints", { query: "OpenRouter", limit: 5 });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.length).toBeLessThanOrEqual(5);
    expect(r.results[0]).toMatchObject({ kind: "option", title: "OpenRouter", url: "https://stackprints.com/layer/router/openrouter/" });
  });

  it("explains a stack match found in its parts", async () => {
    const r = await call(client, "search_stackprints", { query: "openrouter" });
    const stack = r.results.find((x: { kind: string }) => x.kind === "stack");
    expect(stack?.matched).toMatch(/^Uses /);
  });

  it("lists 28 layers with option counts, not options", async () => {
    const r = await call(client, "list_layers");
    expect(r.count).toBe(28);
    expect(r.layers[0]).toEqual(expect.objectContaining({ id: "channels", band: "surface", optionCount: expect.any(Number) }));
    expect(r.layers[0].options).toBeUndefined();
    expect(r.idsThatDifferFromNames).toContain("router = Model gateway");
  });

  it("finds a layer by id or display name, and lists valid ids otherwise", async () => {
    expect((await call(client, "get_layer", { layer: "memory" })).id).toBe("memory");
    expect((await call(client, "get_layer", { layer: "Model gateway" })).id).toBe("router");
    expect((await call(client, "get_layer", { layer: "Triggers" })).id).toBe("proactivity");
    const text = await errorText(client, "get_layer", { layer: "telepathy" });
    expect(text).toMatch(/No layer "telepathy"/);
    expect(text).toContain("router");
  });

  it("gets an option by id or name, and points at get_layer when it is unknown", async () => {
    const o = await call(client, "get_option", { layer: "router", option: "openrouter" });
    expect(o).toMatchObject({ id: "openrouter", name: "OpenRouter" });
    expect(o.usage).toEqual(expect.objectContaining({ stacks: expect.any(Number), exampleDesigns: expect.any(Number) }));
    expect((await call(client, "get_option", { layer: "Model gateway", option: "OpenRouter" })).id).toBe("openrouter");
    const text = await errorText(client, "get_option", { layer: "memory", option: "openrouter" });
    expect(text).toMatch(/get_layer/);
    expect(text).toMatch(/It is in: router/);
  });

  it("filters stacks by disclosure, kind and option", async () => {
    const all = await call(client, "list_stacks");
    expect(all.count).toBe(all.realStacks + all.exampleDesigns);
    const examples = await call(client, "list_stacks", { disclosure: "example" });
    expect(examples.stacks.every((s: { disclosure: string }) => s.disclosure === "example")).toBe(true);
    const coding = await call(client, "list_stacks", { kind: "coding agent" });
    expect(coding.count).toBeGreaterThan(0);
    expect(coding.stacks.every((s: { kind: string }) => s.kind === "Coding agent")).toBe(true);
    const usage = (await call(client, "get_option", { layer: "router", option: "openrouter" })).usage;
    const users = await call(client, "list_stacks", { uses_option: "Model gateway/openrouter" });
    expect(users.realStacks).toBe(usage.stacks);
    expect(users.exampleDesigns).toBe(usage.exampleDesigns);
    expect(users.stacks.map((s: { slug: string }) => s.slug)).toContain("openclaw");
    expect(await errorText(client, "list_stacks", { uses_option: "openrouter" })).toMatch(/layer\/id/);
    expect(await errorText(client, "list_stacks", { uses_option: "router/not-a-gateway" })).toMatch(/No option "not-a-gateway" in the router layer/);
  });

  it("gets a stack by slug or name, and lists the slugs when it is unknown", async () => {
    const s = await call(client, "get_stack", { slug: "openclaw" });
    expect(s).toMatchObject({ slug: "openclaw", disclosure: "open-source" });
    expect(Array.isArray(s.notDisclosed)).toBe(true);
    expect((await call(client, "get_stack", { slug: "OpenClaw" })).slug).toBe("openclaw");
    const text = await errorText(client, "get_stack", { slug: "no-such-agent" });
    expect(text).toMatch(/No stack "no-such-agent"/);
    expect(text).toContain("openclaw");
  });

  it("returns the hot list", async () => {
    const h = await call(client, "get_hot");
    expect(h.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(h.stacks)).toBe(true);
  });
});

describe("validate_stack", () => {
  it("passes a good draft", async () => {
    const r = await call(client, "validate_stack", { stack: exampleDraft });
    expect(r).toMatchObject({ ok: true, errors: [], slug: "helpdesk-copilot-test", path: "content/stacks/helpdesk-copilot-test.json", exists: false });
    expect(r.boardUrl).toMatch(/^https:\/\/stackprints\.com\/#s=/);
  });

  it("catches an unknown option, reported on this file only", async () => {
    const r = await call(client, "validate_stack", { stack: { ...exampleDraft, layers: { ...exampleDraft.layers, memory: "not-a-real-memory" } } });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("helpdesk-copilot-test.json: unknown option memory/not-a-real-memory");
    expect(r.errors.every((e: string) => e.startsWith("helpdesk-copilot-test.json:"))).toBe(true);
  });

  it("turns layer display names into ids", async () => {
    const { router: _r, ...rest } = exampleDraft.layers;
    const r = await call(client, "validate_stack", { stack: { ...exampleDraft, layers: { ...rest, "Model gateway": "openrouter" } } });
    expect(r.renamedLayers).toEqual(["Model gateway → router"]);
    expect(r.errors).toEqual([]);
  });

  it("warns when a real product's picks have no evidence", async () => {
    const r = await call(client, "validate_stack", {
      stack: { name: "Unsourced Agent", kind: "Personal agent", tagline: "t", description: "d", disclosure: "closed", layers: { model: "claude-sonnet-5-5" } },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/no evidence for: model/);
  });
});

describe("prepare_stack_submission", () => {
  it("refuses a slug that already exists and says how to edit it", async () => {
    const openclaw = JSON.parse(FILES.get("content/stacks/openclaw.json")!);
    const text = await errorText(client, "prepare_stack_submission", { stack: openclaw });
    expect(text).toMatch(/already exists at content\/stacks\/openclaw\.json/);
    expect(text).toContain(`${REPO}/edit/main/content/stacks/openclaw.json`);
  });

  it("returns the exact file, a prefilled new-file link, the board link and the steps", async () => {
    const r = await call(client, "prepare_stack_submission", { stack: exampleDraft });
    expect(r.ready).toBe(true);
    const file = JSON.parse(r.json);
    expect(file.slug).toBe("helpdesk-copilot-test");
    expect(file.layers).toEqual(exampleDraft.layers);
    expect(Object.keys(file).slice(0, 3)).toEqual(["slug", "name", "kind"]);
    expect(r.json.endsWith("}\n")).toBe(true);
    expect(r.newFileUrl.startsWith(`${REPO}/new/main?filename=content%2Fstacks%2Fhelpdesk-copilot-test.json&value=`)).toBe(true);
    expect(new URL(r.newFileUrl).searchParams.get("value")).toBe(r.json);
    const draft = decodeDraft(r.boardUrl.split("#s=")[1]);
    expect(draft?.name).toBe("Helpdesk Copilot Test");
    expect(draft?.layers.channels).toEqual(exampleDraft.layers.channels);
    expect(Array.isArray(draft?.layers.harness)).toBe(true);
    expect(r.ghSteps.at(-1)).toMatch(/^gh pr create --repo stackprints\/stackprints/);
    expect(r.checklist.find((c: { rule: string }) => c.rule.startsWith("the description starts with")).status).toBe("ok");
  });

  it("is not ready while a real product's picks lack evidence", async () => {
    const r = await call(client, "prepare_stack_submission", {
      stack: { name: "Unsourced Agent", kind: "Personal agent", tagline: "t", description: "d", disclosure: "closed", layers: { model: "claude-sonnet-5-5" } },
    });
    expect(r.ready).toBe(false);
    expect(r.checklist.filter((c: { status: string }) => c.status === "missing").map((c: { rule: string }) => c.rule).join("\n")).toMatch(/evidence/);
  });
});

describe("prepare_option_submission", () => {
  const sources = [{ title: "Docs", url: "https://quoxl.dev/docs" }];

  it("flags a duplicate", async () => {
    const r = await call(client, "prepare_option_submission", {
      layer: "router",
      option: { name: "OpenRouter", url: "openrouter.ai", note: "One API for many models", profile: "product", links: { site: "https://openrouter.ai" }, sources },
    });
    expect(r.ready).toBe(false);
    expect(r.duplicates).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "option", layer: "router", id: "openrouter" })]));
  });

  it("prepares a new option", async () => {
    const r = await call(client, "prepare_option_submission", {
      layer: "Model gateway",
      option: { name: "Quoxl Relay", url: "quoxl.dev", note: "Test gateway", profile: "product", links: { site: "https://quoxl.dev" }, sources },
    });
    expect(r).toMatchObject({ ready: true, layer: "router", id: "quoxl-relay", path: "content/options/router/quoxl-relay.json", duplicates: [], errors: [] });
    expect(Object.keys(JSON.parse(r.json))[0]).toBe("id");
    expect(new URL(r.newFileUrl).searchParams.get("filename")).toBe(r.path);
  });

  it("refuses maintainer fields and requires https links and a source", async () => {
    expect(await errorText(client, "prepare_option_submission", { layer: "router", option: { name: "Quoxl Relay", order: 1, logo: "x" } })).toMatch(
      /order, logo are set by the maintainers/,
    );
    const r = await call(client, "prepare_option_submission", { layer: "router", option: { name: "Quoxl Relay", links: { site: "http://quoxl.dev" } } });
    expect(r.ready).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(["links.site must be an https URL", expect.stringMatching(/at least one source/)]));
  });
});

describe("prepare_correction", () => {
  it("prefills the correction issue form", async () => {
    const r = await call(client, "prepare_correction", {
      kind: "option",
      layer: "Model gateway",
      id: "openrouter",
      field: "Platform fee",
      problem: "The fee changed.",
      proposed: "5.5% on credit purchases",
      sources: ["https://openrouter.ai/pricing"],
    });
    expect(r.issueUrl.startsWith(`${REPO}/issues/new?`)).toBe(true);
    const q = new URL(r.issueUrl).searchParams;
    expect(q.get("template")).toBe("correction.yml");
    expect(q.get("labels")).toBe("correction");
    expect(q.get("title")).toBe("Correction: OpenRouter (Platform fee)");
    expect(q.get("target")).toBe("https://stackprints.com/layer/router/openrouter/");
    expect(q.get("sources")).toBe("https://openrouter.ai/pricing");
    const body = q.get("body")!;
    expect(body).toBe(r.body);
    for (const part of ["https://stackprints.com/layer/router/openrouter/", "content/options/router/openrouter.json", "**Field:** Platform fee", "The fee changed.", "5.5% on credit purchases", "- https://openrouter.ai/pricing"])
      expect(body).toContain(part);
    expect(r.warnings).toEqual([]);
  });

  it("checks the target and the sources", async () => {
    expect(await errorText(client, "prepare_correction", { kind: "stack", slug: "no-such-agent", problem: "x", sources: ["https://example.com"] })).toMatch(/No stack/);
    expect(await errorText(client, "prepare_correction", { kind: "stack", slug: "openclaw", problem: "x", sources: ["http://example.com"] })).toMatch(/https/);
    const r = await call(client, "prepare_correction", { kind: "stack", slug: "openclaw", field: "layers.memory", problem: "x", sources: ["https://example.com"] });
    expect(r.target.page).toBe("https://stackprints.com/stack/openclaw/");
    expect(r.warnings).toEqual([]);
    const missing = await call(client, "prepare_correction", { kind: "option", layer: "router", id: "openrouter", field: "Pricing", problem: "x", sources: ["https://example.com"] });
    expect(missing.warnings[0]).toMatch(/"Pricing" is not a field or fact on OpenRouter/);
  });
});

// Answers are kept a minute per repo and number for the whole module, so each test asks about its own numbers.
describe("get_submission_status", () => {
  const status = async (deps: Partial<PublicDeps>, number: number) => {
    const c = await connect(() => createPublicServer({ ...base, ...deps }));
    try {
      return await c.callTool({ name: "get_submission_status", arguments: { number } });
    } finally {
      await c.close();
    }
  };

  it("reads a pull request and its checks", async () => {
    const gh = githubFetch({
      "/pulls/42": () =>
        json({ number: 42, state: "closed", merged: true, title: "Add stack: X", html_url: "https://github.com/stackprints/stackprints/pull/42", updated_at: "2026-10-21T10:00:00Z", user: { login: "ada" }, head: { sha: "abc" } }),
      "/commits/abc/check-runs?per_page=100": () =>
        json({ total_count: 3, check_runs: [{ name: "check", status: "completed", conclusion: "success" }, { name: "preview", status: "completed", conclusion: "failure" }, { name: "lint", status: "in_progress", conclusion: null }] }),
    });
    const r = await status({ fetch: gh.fetch }, 42);
    expect(r.structuredContent).toMatchObject({
      kind: "pull",
      state: "merged",
      merged: true,
      title: "Add stack: X",
      url: "https://github.com/stackprints/stackprints/pull/42",
      updatedAt: "2026-10-21T10:00:00Z",
      checks: { total: 3, passed: 1, failing: ["preview"], pending: ["lint"] },
    });
    expect(gh.seen[0].url).toBe("https://api.github.com/repos/stackprints/stackprints/pulls/42");
    expect(gh.seen[0].headers.get("user-agent")).toBeTruthy();
    expect(gh.seen[0].headers.get("authorization")).toBeNull();
  });

  it("reads with the server's token when it has one", async () => {
    const gh = githubFetch({ "/pulls/43": () => json({ number: 43, state: "open", title: "t", html_url: "https://github.com/stackprints/stackprints/pull/43", updated_at: "2026-10-22T10:00:00Z" }) });
    const r = await status({ fetch: gh.fetch, githubToken: "github_pat_read" }, 43);
    expect(r.structuredContent).toMatchObject({ kind: "pull", number: 43, state: "open" });
    expect(gh.seen.map((s) => s.headers.get("authorization"))).toEqual(["Bearer github_pat_read"]);

    const limited = githubFetch({ "/pulls/46": () => json({ message: "API rate limit exceeded" }, 403) });
    expect(JSON.stringify((await status({ fetch: limited.fetch, githubToken: "github_pat_read" }, 46)).content)).toMatch(/rate-limiting this server's reads \(403\)/);
    expect(JSON.stringify((await status({ fetch: limited.fetch }, 46)).content)).toMatch(/rate-limiting anonymous reads \(403\)/);
  });

  it("keeps an answer for a minute, and never keeps an error", async () => {
    let now = Date.parse("2026-10-22T12:00:00Z");
    let opened = false;
    const gh = githubFetch({
      "/pulls/44": () => (opened ? json({ number: 44, state: "open", title: "New", html_url: "https://github.com/stackprints/stackprints/pull/44", updated_at: "2026-10-22T12:00:00Z" }) : json({ message: "Not Found" }, 404)),
    });
    const deps = { fetch: gh.fetch, now: () => now };
    expect((await status(deps, 44)).isError).toBe(true);
    opened = true;
    expect((await status(deps, 44)).structuredContent).toMatchObject({ number: 44, title: "New" });
    const asked = gh.seen.length;
    now += 59_000;
    expect((await status(deps, 44)).structuredContent).toMatchObject({ number: 44, title: "New" });
    expect(gh.seen.length).toBe(asked);
    now += 2_000;
    await status(deps, 44);
    expect(gh.seen.length).toBe(asked + 1);
  });

  it("falls back to the issue", async () => {
    const gh = githubFetch({
      "/issues/7": () => json({ number: 7, state: "open", title: "Correction: OpenRouter", html_url: "https://github.com/stackprints/stackprints/issues/7", updated_at: "2026-10-22T09:00:00Z", labels: [{ name: "correction" }], comments: 1 }),
    });
    const r = await status({ fetch: gh.fetch }, 7);
    expect(r.structuredContent).toMatchObject({ kind: "issue", state: "open", labels: ["correction"], comments: 1 });
    expect(gh.seen.map((s) => s.url.split("/stackprints/stackprints")[1])).toEqual(["/pulls/7", "/issues/7"]);
  });

  it("reports a missing number and network errors as tool errors", async () => {
    const missing = await status({ fetch: githubFetch({}).fetch }, 9999);
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toMatch(/No pull request or issue #9999/);
    const down = await status({ fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch }, 1);
    expect(down.isError).toBe(true);
    expect(JSON.stringify(down.content)).toMatch(/Could not reach GitHub: fetch failed/);
  });
});

const withBundle = needs(fs.existsSync(path.join(ROOT, "mcp/generated/bundle.json")), "mcp/generated/bundle.json", "run npm run bundle in mcp/");

withBundle("public Worker", () => {
  type Worker = { fetch: (req: Request, env: Record<string, unknown>) => Promise<Response> };
  let worker: Worker;
  let rateKey: (ip: string | null) => string;
  beforeAll(async () => {
    const mod = await import("../src/workers/public");
    worker = mod.default as unknown as Worker;
    rateKey = mod.rateKey;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves MCP on /mcp with CORS", async () => {
    let last: Response | undefined;
    const c = new Client({ name: "test", version: "0.0.0" });
    await c.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        fetch: async (u, i) => (last = await worker.fetch(new Request(u, i), {})),
      }),
    );
    expect((await c.listTools()).tools).toHaveLength(12);
    const r = await c.callTool({ name: "get_stack", arguments: { slug: "openclaw" } });
    expect((r.structuredContent as { slug: string }).slug).toBe("openclaw");
    expect(last?.headers.get("access-control-allow-origin")).toBe("*");
    await c.close();
  });

  it("answers a 2025-era initialize", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } } }),
      }),
      {},
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"protocolVersion":"2025-06-18"');
    expect(text).toContain('"name":"stackprints"');
  });

  it("answers preflight, the home page and 404", async () => {
    const pre = await worker.fetch(
      new Request("http://localhost/mcp", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-headers": "content-type, mcp-protocol-version, mcp-param-slug" } }),
      {},
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/mcp-protocol-version.*mcp-session-id.*mcp-param-slug/);
    const home = await worker.fetch(new Request("https://mcp.stackprints.com/"), {});
    expect(home.headers.get("content-type")).toMatch(/^text\/markdown/);
    const md = await home.text();
    expect(md).toContain("https://mcp.stackprints.com/mcp");
    expect(md).toContain("`search_stackprints`");
    expect((await worker.fetch(new Request("http://localhost/elsewhere"), {})).status).toBe(404);
  });

  it("rate limits /mcp per address and says the policy", async () => {
    const keys: string[] = [];
    const env = { RATE_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } };
    const res = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" }, body: "{}" }), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("ratelimit-policy")).toBe('"fair-use";q=600;w=60');
    expect(res.headers.get("ratelimit")).toBe('"fair-use";r=0;t=60');
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toMatch(/retry-after, ratelimit, ratelimit-policy/);
    const body = (await res.json()) as { error: { message: string } };
    expect(body).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32000 } });
    expect(body.error.message).toMatch(/at most 600 requests a minute per address/);
    expect(keys).toEqual(["203.0.113.9"]);

    // Within the limit, the request goes through.
    const ok = { RATE_LIMITER: { limit: async () => ({ success: true }) } };
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } } };
    const through = await worker.fetch(
      new Request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(init) }),
      ok,
    );
    expect(through.status).toBe(200);
  });

  it("counts an IPv6 /64 as one address, and an IPv4 address as itself", () => {
    expect(rateKey("203.0.113.9")).toBe("203.0.113.9");
    expect(rateKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    for (const ip of ["2001:db8:abcd:12::1", "2001:0DB8:abcd:0012:ffff:ffff:ffff:ffff", "2001:db8:abcd:12:1:2:3:4%eth0"]) expect(rateKey(ip), ip).toBe("2001:db8:abcd:12::/64");
    expect(rateKey("2001:db8:abcd:13::1")).toBe("2001:db8:abcd:13::/64");
    expect(rateKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(rateKey("::1")).toBe("0:0:0:0::/64");
    expect(rateKey("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
    expect(rateKey(null)).toBe("unknown");
    expect(rateKey("not-an-address")).toBe("not-an-address");
  });

  it("keeps the limit it states in step with wrangler.public.jsonc", () => {
    const config = fs.readFileSync(path.join(ROOT, "mcp/wrangler.public.jsonc"), "utf8");
    const m = /"name":\s*"RATE_LIMITER"[^}]*"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)/.exec(config);
    expect(m && [Number(m[1]), Number(m[2])]).toEqual([600, 60]);
  });

  it("reads submission status with GITHUB_READ_TOKEN when the Worker has one", async () => {
    // A fresh module: the Worker builds its handler from the first request's env.
    vi.resetModules();
    const fresh = (await import("../src/workers/public")).default as unknown as Worker;
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return json({ number: 77, state: "open", title: "Add stack: Y", html_url: "https://github.com/stackprints/stackprints/pull/77", updated_at: "2026-10-22T10:00:00Z" });
    });
    const c = new Client({ name: "test", version: "0.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (u, i) => fresh.fetch(new Request(u, i), { GITHUB_READ_TOKEN: "github_pat_read" }) }));
    const r = await c.callTool({ name: "get_submission_status", arguments: { number: 77 } });
    await c.close();
    expect(r.structuredContent).toMatchObject({ kind: "pull", number: 77 });
    expect(seen).toEqual([{ url: "https://api.github.com/repos/stackprints/stackprints/pulls/77", auth: "Bearer github_pat_read" }]);
  });
});
