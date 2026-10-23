// The admin Worker's default export, called as Workers would call it, with KV and D1 in memory, a
// rate limiter that counts, and every outside request (GitHub's API and sign-in, the pages it reads)
// answered by a stub of fetch. D1State's own SQL is tested in state.test.ts; here env.DB is a
// MemoryState, which keeps the same contract.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiKeyRecord, canManageKey, findKey, hasAnyKey, listKeys, mintKey, revokeKey, verifyKey } from "../src/core/auth";
import { MemoryState } from "../src/core/state";
import { type Principal, SCOPES } from "../src/core/types";
import worker, { type Env, clientKey, principalFrom, resolveApiKey } from "../src/workers/admin";
import { REQUIRED_SCOPES, consentPage, grantedScopes, isAllowedId } from "../src/workers/github-auth";
import { FakeGitHub } from "./fake-github";
import { repoFiles } from "./helpers";

// workers-oauth-provider imports this Workers-only module; our handlers are plain objects, so a stub does.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
// The Worker's state over env.DB: here env.DB is the state itself.
vi.mock("../src/core/d1-state", () => ({
  D1State: function D1State(db: unknown) {
    return db;
  },
}));

const ORIGIN = "https://admin.stackprints.test";
const MCP = `${ORIGIN}/mcp`;
const REPO = "stackprints/stackprints";
const BOOTSTRAP = "b".repeat(40);
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const NEWS_URL = "https://e2b.dev/blog/gpu";
const OWNER_ID = 1470765;
const BACKUP_ID = 7;
/** What claude.ai asks for: the scopes the 401 challenge names, and staying signed in. */
const CLAUDE_ASKS = "content:read content:write content:publish offline_access";

const OWNER: Principal = { name: "mehdidjabri", kind: "github", login: "mehdidjabri", githubId: OWNER_ID, scopes: [...SCOPES] };
const BACKUP: Principal = { name: "backup-admin", kind: "github", login: "backup-admin", githubId: BACKUP_ID, scopes: [...SCOPES] };
const asKey = (r: ApiKeyRecord): Principal => ({ name: r.name, kind: "apikey", keyId: r.id, scopes: r.scopes });

/** Workers KV in memory: text values, expirations, metadata and paged listing. */
class MemoryKV {
  data = new Map<string, { value: string; expiration?: number; metadata?: unknown }>();
  private live(key: string) {
    const e = this.data.get(key);
    if (e?.expiration && e.expiration * 1000 <= Date.now()) this.data.delete(key);
    return this.data.get(key);
  }
  async get(key: string, options?: string | { type?: string }) {
    const e = this.live(key);
    if (!e) return null;
    const type = typeof options === "string" ? options : (options?.type ?? "text");
    return type === "json" ? JSON.parse(e.value) : e.value;
  }
  async put(key: string, value: string | ArrayBuffer, options: { expiration?: number; expirationTtl?: number; metadata?: unknown } = {}) {
    if (options.expirationTtl !== undefined && options.expirationTtl < 60) throw new Error("KV PUT failed: 400 Invalid expiration_ttl of less than 60 seconds");
    const expiration = options.expiration ?? (options.expirationTtl ? Math.floor(Date.now() / 1000) + options.expirationTtl : undefined);
    this.data.set(key, { value: typeof value === "string" ? value : new TextDecoder().decode(value), expiration, metadata: options.metadata });
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const { prefix = "", limit = 1000, cursor } = options;
    const names = [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.live(k)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return {
      keys: page.map((name) => ({ name, expiration: this.data.get(name)!.expiration, metadata: this.data.get(name)!.metadata })),
      list_complete: done,
      ...(done ? {} : { cursor: String(start + limit) }),
      cacheStatus: null,
    };
  }
}

/** The ratelimits binding: `max` calls per key, for the whole test. */
class FakeLimiter {
  counts = new Map<string, number>();
  constructor(readonly max = 1000) {}
  async limit({ key }: { key: string }) {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return { success: n <= this.max };
  }
}

type World = { env: Env; gh: FakeGitHub; githubUser: { id: number; login: string }; outside: string[] };
let world: World;

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    OAUTH_KV: new MemoryKV() as unknown as KVNamespace,
    DB: new MemoryState() as unknown as D1Database,
    CACHE_KV: new MemoryKV() as unknown as KVNamespace,
    RATE_LIMITER: new FakeLimiter(),
    GITHUB_REPO: REPO,
    GITHUB_TOKEN: "test-token",
    GITHUB_CLIENT_ID: "gh-client",
    GITHUB_CLIENT_SECRET: "gh-secret",
    ADMIN_GITHUB_IDS: `${OWNER_ID}, ${BACKUP_ID}`,
    SITE_URL: "https://stackprints.com",
    ...over,
  };
}

/** The Worker's state, as its tools see it. */
const stateOf = (env = world.env) => env.DB as unknown as MemoryState;

beforeEach(() => {
  world = { env: makeEnv(), gh: new FakeGitHub(REPO, repoFiles()), githubUser: { id: OWNER_ID, login: "mehdidjabri" }, outside: [] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const fromRepo = await world.gh.handle(req.clone() as Request);
    if (fromRepo) return fromRepo;
    world.outside.push(`${req.method} ${url.origin}${url.pathname}`);
    if (url.href === "https://github.com/login/oauth/access_token") {
      const form = new URLSearchParams(await req.text());
      if (form.get("code") !== "gh-code" || !form.get("code_verifier") || form.get("client_secret") !== "gh-secret") return Response.json({ error: "bad_verification_code" });
      expect(form.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
      return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "" });
    }
    if (url.href === "https://api.github.com/user") {
      expect(req.headers.get("authorization")).toBe("Bearer gho_test");
      return Response.json(world.githubUser);
    }
    if (url.href === "https://api.github.com/applications/gh-client/token" && req.method === "DELETE") return new Response(null, { status: 204 });
    if (url.href === NEWS_URL)
      return new Response(`<html><head><title>E2B adds GPU sandboxes | E2B</title><meta property="article:published_time" content="2026-10-21"></head><body><article><p>GPU sandboxes are here: start one with a single flag, on every plan, in every region we run today.</p><p>${"More detail about GPUs. ".repeat(20)}</p></article></body></html>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (url.hostname === "stackprints.com") return new Response("not built in tests", { status: 404 });
    throw new Error(`unexpected outside request ${req.method} ${req.url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ctx = () => ({ waitUntil() {}, passThroughOnException() {}, props: {} }) as unknown as ExecutionContext;
const hit = (input: string, init?: RequestInit, env = world.env) => worker.fetch(new Request(input.startsWith("http") ? input : `${ORIGIN}${input}`, init), env, ctx());

/** An MCP client that sends `token` on every request to the Worker. */
async function connect(token: string, env = world.env) {
  const client = new Client({ name: "worker-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP), {
      fetch: (u, i) => {
        const req = new Request(u, i);
        req.headers.set("authorization", `Bearer ${token}`);
        return worker.fetch(req, env, ctx());
      },
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${(r.content as { text: string }[]).map((c) => c.text).join("\n")}`);
  return r.structuredContent as Record<string, any>;
}

const toolNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);

const initialize = (headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
});
const withToken = (token: string, headers: Record<string, string> = {}) => initialize({ authorization: `Bearer ${token}`, ...headers });

describe("the admin Worker without credentials", () => {
  it("says at / what it is and how to connect", async () => {
    const res = await hit("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    const md = await res.text();
    expect(md).toContain(`Endpoint: ${MCP}`);
    expect(md).toContain("Add custom connector");
    expect(md).toContain("Authorization: Bearer spk_");
    expect(md).toContain("BOOTSTRAP_KEY");
    expect(md).toContain("stops working as soon as a key exists");
    expect((await hit("/nope")).status).toBe(404);
  });

  it("answers /mcp with a 401 that points at the resource metadata and the scopes to ask for", async () => {
    const res = await hit("/mcp", initialize());
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('scope="content:read content:write content:publish"');
    expect((await hit("/mcp", withToken("nonsense"))).status).toBe(401);
  });

  it("publishes protected resource and authorization server metadata", async () => {
    const resource = (await (await hit("/.well-known/oauth-protected-resource/mcp")).json()) as Record<string, unknown>;
    expect(resource).toMatchObject({ resource: MCP, authorization_servers: [ORIGIN], scopes_supported: REQUIRED_SCOPES, resource_name: "Stackprints admin" });
    const as = (await (await hit("/.well-known/oauth-authorization-server")).json()) as Record<string, any>;
    expect(as.issuer).toBe(ORIGIN);
    expect(as.authorization_endpoint).toBe(`${ORIGIN}/authorize`);
    expect(as.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(as.scopes_supported).toEqual([...SCOPES, "offline_access"]);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
  });
});

describe("API keys", () => {
  it("let an agent in with the tools its scopes allow, until the key is revoked", async () => {
    const { key, record } = await mintKey(stateOf(), { name: "news-bot", scopes: ["content:write"], creator: OWNER, now: Date.now() });
    expect(record).toMatchObject({ createdBy: "mehdidjabri", createdById: `github:${OWNER_ID}` });
    expect(record.parentKeyId).toBeUndefined();
    const client = await connect(key);
    const me = await call(client, "whoami");
    expect(me).toMatchObject({ name: "news-bot", kind: "apikey", scopes: ["content:read", "content:write"], headSha: world.gh.refs.get("main"), can: { write: true, publish: false, manageKeys: false } });
    const names = await toolNames(client);
    expect(names).toEqual(expect.arrayContaining(["whoami", "open_changeset", "propose_news", "submit_changeset", "search_stackprints"]));
    for (const n of ["revert_commit", "create_api_key", "list_api_keys", "revoke_api_key"]) expect(names).not.toContain(n);
    await client.close();

    await revokeKey(stateOf(), record.id);
    expect((await hit("/mcp", withToken(key))).status).toBe(401);
  });

  it("resolve to props bound to this resource, and nothing for other tokens", async () => {
    const { key, record } = await mintKey(stateOf(), { name: "reader", scopes: ["content:read"], creator: OWNER, now: Date.now() });
    expect(await resolveApiKey(key, world.env, MCP)).toEqual({ props: { name: "reader", kind: "apikey", keyId: record.id, scopes: ["content:read"] }, audience: MCP });
    expect(await resolveApiKey("spk_not-a-real-key-at-all-000000", world.env, MCP)).toBeNull();
    expect(await resolveApiKey("gho_something", world.env, MCP)).toBeNull();
  });

  it("end with the key that minted them, however far down", async () => {
    const state = stateOf();
    const parent = await mintKey(state, { name: "ops", scopes: ["content:publish", "keys:manage"], creator: OWNER, now: Date.now() });
    const child = await mintKey(state, { name: "news-run", scopes: ["content:write"], creator: asKey(parent.record), now: Date.now() });
    const grandchild = await mintKey(state, { name: "reader", scopes: ["content:read"], creator: { ...asKey(child.record), scopes: ["content:read", "content:write", "keys:manage"] }, now: Date.now() });
    expect(child.record).toMatchObject({ parentKeyId: parent.record.id, createdBy: "ops", createdById: `key:${parent.record.id}` });
    expect(await resolveApiKey(grandchild.key, world.env, MCP)).not.toBeNull();

    const revoked = await revokeKey(state, parent.record.id);
    expect(revoked?.revoked.id).toBe(parent.record.id);
    expect(revoked?.cascaded.map((r) => r.name).sort()).toEqual(["news-run", "reader"]);
    for (const k of [parent.key, child.key, grandchild.key]) expect(await resolveApiKey(k, world.env, MCP)).toBeNull();
    expect((await hit("/mcp", withToken(child.key))).status).toBe(401);
    expect(await listKeys(state)).toEqual([]);
  });

  it("refuse a child even when only its parent's record is gone", async () => {
    const state = stateOf();
    const parent = await mintKey(state, { name: "ops", scopes: ["keys:manage"], creator: OWNER, now: Date.now() });
    const child = await mintKey(state, { name: "reader", scopes: ["content:read"], creator: asKey(parent.record), now: Date.now() });
    // As if the cascade never reached the child (a child minted while its parent was being revoked).
    const hash = await state.get<string>(`apikey-id:${parent.record.id}`);
    await state.delete(`apikey:${hash}`);
    expect(await verifyKey(state, child.key)).toBeNull();
  });

  it("stay revoked even if a stale write brings the record back", async () => {
    const state = stateOf();
    const { key, record } = await mintKey(state, { name: "bot", scopes: ["content:read"], creator: OWNER, now: Date.now() });
    const hash = await state.get<string>(`apikey-id:${record.id}`);
    await revokeKey(state, record.id);
    await state.put(`apikey:${hash}`, record);
    expect(await verifyKey(state, key)).toBeNull();
  });

  it("end when the GitHub account that minted them, directly or not, leaves the allowlist", async () => {
    const state = stateOf();
    const backups = await mintKey(state, { name: "backup-ops", scopes: ["content:read", "keys:manage"], creator: BACKUP, now: Date.now() });
    const child = await mintKey(state, { name: "backup-reader", scopes: ["content:read"], creator: asKey(backups.record), now: Date.now() });
    const owners = await mintKey(state, { name: "owner-reader", scopes: ["content:read"], creator: OWNER, now: Date.now() });
    for (const k of [backups.key, child.key, owners.key]) expect(await resolveApiKey(k, world.env, MCP)).not.toBeNull();

    world.env.ADMIN_GITHUB_IDS = String(OWNER_ID);
    expect(await resolveApiKey(backups.key, world.env, MCP)).toBeNull();
    expect(await resolveApiKey(child.key, world.env, MCP)).toBeNull();
    expect(await resolveApiKey(owners.key, world.env, MCP)).not.toBeNull();
    // A login is no id: a list of logins lets no key in.
    world.env.ADMIN_GITHUB_IDS = "mehdidjabri";
    expect(await resolveApiKey(owners.key, world.env, MCP)).toBeNull();
  });

  it("note when they were used apart from the record, at most once an hour", async () => {
    const state = stateOf();
    const { key, record } = await mintKey(state, { name: "bot", scopes: ["content:read"], creator: OWNER, now: Date.parse("2026-10-22T10:00:00Z") });
    const hash = await state.get<string>(`apikey-id:${record.id}`);
    const put = vi.spyOn(state, "put");
    await verifyKey(state, key, { now: Date.parse("2026-10-22T12:00:00Z") });
    await verifyKey(state, key, { now: Date.parse("2026-10-22T12:30:00Z") });
    expect(put.mock.calls.map(([k]) => k)).toEqual([`apikey-used:${hash}`]);
    expect(await state.get(`apikey:${hash}`)).toEqual(record);
    expect((await listKeys(state))[0]).toMatchObject({ id: record.id, lastUsedAt: "2026-10-22T12:00:00.000Z" });
    await verifyKey(state, key, { now: Date.parse("2026-10-22T13:30:00Z") });
    expect((await listKeys(state))[0].lastUsedAt).toBe("2026-10-22T13:30:00.000Z");
  });

  it("are minted and revoked only within the caller's own scopes, and nest at most five deep", async () => {
    const state = stateOf();
    const manager: Principal = { name: "manager", kind: "apikey", keyId: "m", scopes: ["content:read", "keys:manage"] };
    expect(canManageKey(manager, { scopes: ["content:read"] })).toBe(true);
    expect(canManageKey(manager, { scopes: ["content:read", "content:write"] })).toBe(false);
    await expect(mintKey(state, { name: "x", scopes: ["content:publish"], creator: { ...BACKUP, scopes: ["content:read", "keys:manage"] }, now: Date.now() })).rejects.toThrow(/doesn't hold: content:write, content:publish/);

    const publisher = await mintKey(state, { name: "publisher", scopes: ["content:publish"], creator: OWNER, now: Date.now() });
    await expect(revokeKey(state, publisher.record.id, { by: manager })).rejects.toThrow(/scopes you don't hold/);
    expect(await findKey(state, publisher.record.id)).toEqual(publisher.record);

    let creator: Principal = { ...OWNER };
    const chain: ApiKeyRecord[] = [];
    for (let depth = 0; depth <= 5; depth++) {
      const { record } = await mintKey(state, { name: `level ${depth}`, scopes: ["content:read", "keys:manage"], creator, now: Date.now() });
      chain.push(record);
      creator = asKey(record);
    }
    await expect(mintKey(state, { name: "too deep", scopes: ["content:read"], creator, now: Date.now() })).rejects.toThrow(/at most 5 deep/);
    // A key minted by a revoked one can't be minted at all.
    await revokeKey(state, chain[3].id);
    await expect(mintKey(state, { name: "orphan", scopes: ["content:read"], creator: asKey(chain[4]), now: Date.now() })).rejects.toThrow(/revoked/);
  });
});

describe("the bootstrap key", () => {
  it("acts as the owner only while no API key exists", async () => {
    world.env = makeEnv({ BOOTSTRAP_KEY: BOOTSTRAP });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = await connect(BOOTSTRAP);
    const me = await call(owner, "whoami");
    expect(me).toMatchObject({ name: "bootstrap", kind: "apikey", scopes: SCOPES, can: { write: true, publish: true, manageKeys: true } });
    await owner.close();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/BOOTSTRAP_KEY used as the owner/));

    // The first key, as create_api_key mints it for the bootstrap caller: it hangs from no other key.
    const bootstrap: Principal = { name: "bootstrap", kind: "apikey", keyId: "bootstrap", scopes: [...SCOPES] };
    const minted = await mintKey(stateOf(), { name: "claude-code", scopes: ["content:publish", "keys:manage"], creator: bootstrap, now: Date.now() });
    expect(minted.record).toMatchObject({ createdById: "key:bootstrap" });
    expect(minted.record.parentKeyId).toBeUndefined();
    expect(await hasAnyKey(stateOf())).toBe(true);

    const agent = await connect(minted.key);
    expect(await call(agent, "whoami")).toMatchObject({ name: "claude-code", scopes: SCOPES });
    await agent.close();

    // A key exists: the secret, still set, is just a wrong token now.
    expect((await hit("/mcp", withToken(BOOTSTRAP))).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/BOOTSTRAP_KEY refused because API keys exist/));

    // Revoking every key doesn't bring it back: once spent, a leaked secret is worthless.
    await revokeKey(stateOf(), minted.record.id);
    expect(await listKeys(stateOf())).toEqual([]);
    expect((await hit("/mcp", withToken(BOOTSTRAP))).status).toBe(401);
  });

  it("is ignored when shorter than 32 characters, and must match exactly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = (bootstrap: string) => ({ DB: world.env.DB, BOOTSTRAP_KEY: bootstrap, ADMIN_GITHUB_IDS: "" });
    expect(await resolveApiKey("short-key", env("short-key"), MCP)).toBeNull();
    expect(await resolveApiKey(`${BOOTSTRAP}x`, env(BOOTSTRAP), MCP)).toBeNull();
    expect((await resolveApiKey(BOOTSTRAP, env(` ${BOOTSTRAP}\n`), MCP))?.props).toMatchObject({ name: "bootstrap" });
  });
});

describe("an update through the Worker", () => {
  it("fetches a source, proposes news and publishes it as a commit on GitHub main", async () => {
    const { key } = await mintKey(stateOf(), { name: "news-bot", scopes: ["content:publish"], creator: OWNER, now: Date.now() });
    const client = await connect(key);
    const before = world.gh.refs.get("main")!;
    const { changeset } = await call(client, "open_changeset", { kind: "news", title: "E2B news" });
    const page = await call(client, "fetch_source", { url: NEWS_URL });
    expect(page).toMatchObject({ status: 200, published: "2026-10-21" });
    const today = (await call(client, "whoami")).today as string;
    const item = { date: "2026-10-21", title: "E2B adds GPU sandboxes", url: NEWS_URL, source: "e2b.dev" };
    await call(client, "propose_news", { changeset, layer: "sandbox", id: "e2b", items: [item] });
    expect(await call(client, "validate_changeset", { changeset })).toMatchObject({ ok: true, willPublish: true });
    const done = await call(client, "submit_changeset", { changeset });
    await client.close();

    const head = world.gh.refs.get("main")!;
    expect(done).toMatchObject({ mode: "publish", sha: head, url: `https://github.com/${REPO}/commit/${head}`, files: ["content/news/sandbox/e2b.json"] });
    const commit = world.gh.commits.get(head)!;
    expect(commit.parents).toEqual([before]);
    expect(commit.message).toMatch(/^news: E2B news\n[\s\S]*Agent: news-bot \(apikey\)/);
    const news = JSON.parse(world.gh.filesAt("main").get("content/news/sandbox/e2b.json")!);
    expect(news).toMatchObject({ updated: today });
    expect(news.items).toContainEqual(item);
    // The page was read once, by fetch_source; nothing reached out to our own site.
    expect(world.outside).toEqual([`GET ${NEWS_URL}`]);
    // The commit's files went to the cache, not to D1.
    expect([...(world.env.CACHE_KV as unknown as MemoryKV).data.keys()].some((k) => k.startsWith("gh-files:"))).toBe(true);
    expect((await stateOf().list("gh-")).keys).toEqual([]);
  });
});

const cookies = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** Registers a client the way claude.ai does. */
async function register(headers: Record<string, string> = {}, over: Record<string, unknown> = {}) {
  return hit("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], ...over }),
  });
}

/** Registers and opens the consent page, asking for `scope`. */
async function consent(scope = CLAUDE_ASKS) {
  const reg = await register();
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };
  const verifier = "v".repeat(64);
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const authorizeUrl = new URL(`${ORIGIN}/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id, redirect_uri: CLAUDE_CALLBACK, scope, state: "client-state", code_challenge: challenge, code_challenge_method: "S256", resource: MCP }))
    authorizeUrl.searchParams.set(k, v);
  const page = await hit(authorizeUrl.href);
  expect(page.status).toBe(200);
  expect(page.headers.get("x-frame-options")).toBe("DENY");
  const html = await page.text();
  return { client_id, verifier, page, html, handle: /name="handle" value="([^"]+)"/.exec(html)![1] };
}

/** The authorization flow claude.ai runs: register, authorize, consent, GitHub, token. */
async function signIn(options: { ask?: string; scopes?: string[]; decision?: "approve" | "deny" } = {}) {
  const { client_id, verifier, page, html, handle } = await consent(options.ask);
  expect(html).toContain("Allow Claude to use Stackprints admin?");
  expect(html).toContain("claude.ai");

  const form = new URLSearchParams({ handle, decision: options.decision ?? "approve" });
  for (const s of options.scopes ?? ["content:write", "content:publish", "keys:manage", "offline_access"]) form.append("scope", s);
  const toGithub = await hit("/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies(page) }, body: form, redirect: "manual" });
  expect(toGithub.status).toBe(302);
  const location = new URL(toGithub.headers.get("location")!);
  if (options.decision === "deny") return { location };
  expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(location.searchParams.get("client_id")).toBe("gh-client");
  expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");

  const back = await hit(`/callback?code=gh-code&state=${encodeURIComponent(location.searchParams.get("state")!)}`, { headers: { cookie: cookies(toGithub) }, redirect: "manual" });
  expect(back.status).toBe(302);
  const toClient = new URL(back.headers.get("location")!);
  expect(toClient.origin + toClient.pathname).toBe(CLAUDE_CALLBACK);
  expect(toClient.searchParams.get("state")).toBe("client-state");
  const code = toClient.searchParams.get("code");
  if (!code) return { location: toClient };

  const token = await hit("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_CALLBACK, client_id, code_verifier: verifier, resource: MCP }),
  });
  expect(token.status).toBe(200);
  return { location: toClient, tokens: (await token.json()) as { access_token: string; refresh_token?: string; scope: string } };
}

describe("signing in from claude.ai", () => {
  it("registers, asks consent, signs in with GitHub, and the token works as the owner", async () => {
    const { tokens } = await signIn({ ask: `${CLAUDE_ASKS} keys:manage` });
    expect(tokens!.refresh_token).toBeTruthy();
    const client = await connect(tokens!.access_token);
    expect(await call(client, "whoami")).toMatchObject({ name: "mehdidjabri", kind: "github", scopes: SCOPES });
    expect(await toolNames(client)).toContain("create_api_key");
    await client.close();
    // GitHub's token was used once and revoked; it is not kept.
    expect(world.outside).toContain("DELETE https://api.github.com/applications/gh-client/token");
  });

  it("gives claude.ai's connector what it asks for, write and publish included, but never keys:manage unasked", async () => {
    const { tokens } = await signIn();
    const client = await connect(tokens!.access_token);
    expect(await call(client, "whoami")).toMatchObject({ kind: "github", scopes: ["content:read", "content:write", "content:publish"] });
    expect(await toolNames(client)).not.toContain("create_api_key");
    await client.close();
  });

  it("pre-ticks only what the client asked for, and shows keys:manage only when asked", async () => {
    const box = (html: string, scope: string) => new RegExp(`<input type="checkbox" name="scope" value="${scope}"( checked)?>`).exec(html);
    const readOnly = (await consent("content:read")).html;
    expect(readOnly).toMatch(/checked disabled> content:read/);
    expect(box(readOnly, "content:write")?.[1]).toBeUndefined();
    expect(box(readOnly, "content:publish")?.[1]).toBeUndefined();
    expect(box(readOnly, "keys:manage")).toBeNull();
    expect(box(readOnly, "offline_access")).toBeNull();

    const more = (await consent("content:read content:write keys:manage offline_access")).html;
    expect(box(more, "content:write")?.[1]).toBe(" checked");
    expect(box(more, "content:publish")?.[1]).toBeUndefined();
    expect(box(more, "keys:manage")).not.toBeNull();
    expect(box(more, "keys:manage")?.[1]).toBeUndefined();
    expect(box(more, "offline_access")?.[1]).toBe(" checked");
  });

  it("grants only what was ticked, within what the client asked for or the server offers", async () => {
    const { tokens } = await signIn({ ask: "content:read", scopes: ["content:publish", "keys:manage", "offline_access"] });
    expect(tokens!.scope.split(" ").sort()).toEqual(["content:publish", "content:read"]);
    const client = await connect(tokens!.access_token);
    expect(await call(client, "whoami")).toMatchObject({ kind: "github", scopes: ["content:read", "content:write", "content:publish"] });
    expect(await toolNames(client)).not.toContain("create_api_key");
    await client.close();
  });

  it("grants only the scopes left ticked on the consent page", async () => {
    const { tokens } = await signIn({ scopes: [] });
    const client = await connect(tokens!.access_token);
    expect(await call(client, "whoami")).toMatchObject({ kind: "github", scopes: ["content:read"] });
    const names = await toolNames(client);
    expect(names).toContain("fetch_source");
    expect(names).not.toContain("open_changeset");
    await client.close();
  });

  it("turns away a GitHub account that is not on the allowlist", async () => {
    world.githubUser = { id: 999, login: "someone-else" };
    const { location, tokens } = await signIn();
    expect(tokens).toBeUndefined();
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("error_description")).toMatch(/someone-else \(id 999\) is not allowed/);
  });

  it("turns away someone who took over the owner's old login", async () => {
    world.githubUser = { id: 999, login: "mehdidjabri" };
    const { location, tokens } = await signIn();
    expect(tokens).toBeUndefined();
    expect(location.searchParams.get("error")).toBe("access_denied");
  });

  it("lets the owner in under a new login, shown as that login", async () => {
    world.githubUser = { id: OWNER_ID, login: "mehdi-renamed" };
    const { tokens } = await signIn();
    const client = await connect(tokens!.access_token);
    expect(await call(client, "whoami")).toMatchObject({ name: "mehdi-renamed", kind: "github" });
    await client.close();
  });

  it("sends a denial back to the client", async () => {
    const { location } = await signIn({ decision: "deny" });
    expect(location.origin + location.pathname).toBe(CLAUDE_CALLBACK);
    expect(location.searchParams.get("error")).toBe("access_denied");
  });

  it("locks a signed-in account out as soon as its id leaves the allowlist", async () => {
    const { tokens } = await signIn();
    expect((await hit("/mcp", withToken(tokens!.access_token))).status).toBe(200);
    world.env.ADMIN_GITHUB_IDS = String(BACKUP_ID);
    expect((await hit("/mcp", withToken(tokens!.access_token))).status).toBe(403);
  });

  it("renders a consent form posted without its browser cookie as a problem, not a redirect", async () => {
    const res = await hit("/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ handle: "forged", decision: "approve" }), redirect: "manual" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sign-in problem");
  });
});

describe("rate limits", () => {
  it("stop registrations from one address past the limit, and keep each record small", async () => {
    world.env = makeEnv({ RATE_LIMITER: new FakeLimiter(2) });
    const from = { "cf-connecting-ip": "2001:db8:1:2::10" };
    expect((await register(from)).status).toBe(201);
    expect((await register({ "cf-connecting-ip": "2001:db8:1:2:aaaa::20" })).status).toBe(201);
    const third = await register(from);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
    expect(await third.json()).toMatchObject({ error: "temporarily_unavailable" });
    // Another /64 is another client.
    expect((await register({ "cf-connecting-ip": "2001:db8:1:3::10" })).status).toBe(201);

    world.env = makeEnv();
    const many = await register({}, { redirect_uris: Array.from({ length: 6 }, (_, i) => `https://example.com/cb${i}`) });
    expect(many.status).toBe(400);
    expect(await many.json()).toMatchObject({ error: "invalid_client_metadata" });
    expect((await register({}, { client_name: "x".repeat(10_000) })).status).toBe(400);
  });

  it("refuse an address that keeps failing to authenticate, for a minute, whatever it sends next", async () => {
    world.env = makeEnv({ RATE_LIMITER: new FakeLimiter(2) });
    const { key } = await mintKey(stateOf(), { name: "bot", scopes: ["content:read"], creator: OWNER, now: Date.now() });
    const from = { "cf-connecting-ip": "203.0.113.9" };
    expect((await hit("/mcp", initialize(from))).status).toBe(401); // no credential: discovery, not counted
    expect((await hit("/mcp", withToken("spk_guess-number-one-000000000", from))).status).toBe(401);
    expect((await hit("/mcp", withToken("spk_guess-number-two-000000000", from))).status).toBe(401);
    const third = await hit("/mcp", withToken("spk_guess-number-three-0000000", from));
    expect(third.status).toBe(429);
    expect((await hit("/mcp", withToken(key, from))).status).toBe(429);
    expect((await hit("/mcp", withToken(key, { "cf-connecting-ip": "203.0.113.10" }))).status).toBe(200);
  });

  it("count sign-in pages too, each endpoint on its own", async () => {
    world.env = makeEnv({ RATE_LIMITER: new FakeLimiter(1) });
    expect((await hit("/authorize")).status).not.toBe(429);
    const res = await hit("/authorize");
    expect(res.status).toBe(429);
    expect(await res.text()).toMatch(/Too many requests/);
    // A burst on one endpoint doesn't spend another's budget (registrations can't block sign-in).
    expect((await hit("/callback")).status).not.toBe(429);
    expect((await hit("/callback")).status).toBe(429);
    expect((await hit("/")).status).toBe(200);
  });

  it("key IPv6 clients by their /64", () => {
    const key = (ip?: string) => clientKey(new Request(ORIGIN, ip ? { headers: { "cf-connecting-ip": ip } } : {}));
    expect(key("203.0.113.9")).toBe("203.0.113.9");
    expect(key("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(key("2001:DB8:ABCD:0012::99")).toBe("2001:db8:abcd:12::/64");
    expect(key("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(key("::1")).toBe("0:0:0:0::/64");
    expect(key("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(key()).toBe("unknown");
  });
});

describe("principalFrom", () => {
  const oauth = (scope: string[], userId?: string) => ({ clientId: "claude", scope, ...(userId ? { userId } : {}) });
  const key = { scope: [] };
  const owner = { name: "mehdidjabri", kind: "github", login: "mehdidjabri", githubId: OWNER_ID, scopes: SCOPES };

  it("takes an API key's scopes from its props", () => {
    expect(principalFrom({ name: "bot", kind: "apikey", keyId: "k1", scopes: ["content:read"] }, key, "")).toEqual({ name: "bot", kind: "apikey", keyId: "k1", scopes: ["content:read"] });
  });

  it("narrows a GitHub grant to the token's scopes, with what they imply", () => {
    expect(principalFrom(owner, oauth(["content:publish", "offline_access"], `github-${OWNER_ID}`), String(OWNER_ID))).toEqual({
      name: "mehdidjabri",
      kind: "github",
      login: "mehdidjabri",
      githubId: OWNER_ID,
      scopes: ["content:read", "content:write", "content:publish"],
    });
    expect(principalFrom(owner, oauth([]), ` 5, ${OWNER_ID} `)?.scopes).toEqual([]);
  });

  it("refuses an id off the allowlist, a grant with a login and no id, another subject, a local principal, and malformed props", () => {
    expect(principalFrom({ ...owner, githubId: 999 }, oauth(["content:read"]), String(OWNER_ID))).toBeNull();
    expect(principalFrom({ name: "mehdidjabri", kind: "github", login: "mehdidjabri", scopes: SCOPES }, oauth(["content:read"]), "mehdidjabri")).toBeNull();
    expect(principalFrom(owner, oauth(["content:read"], "github-999"), String(OWNER_ID))).toBeNull();
    expect(principalFrom({ name: "me", kind: "local", scopes: SCOPES }, key, "")).toBeNull();
    expect(principalFrom({ name: "me", kind: "apikey", scopes: ["root"] }, key, "")).toBeNull();
    expect(principalFrom(undefined, key, "")).toBeNull();
  });
});

describe("the allowlist and the consent", () => {
  it("compares numeric ids only, and lets nobody in on an empty list", () => {
    expect(isAllowedId(OWNER_ID, "1470765")).toBe(true);
    expect(isAllowedId("7", " 1470765 , 7 ")).toBe(true);
    expect(isAllowedId(147076, "1470765")).toBe(false);
    expect(isAllowedId("mehdidjabri", "mehdidjabri")).toBe(false);
    expect(isAllowedId(1, "")).toBe(false);
    expect(isAllowedId(1, undefined)).toBe(false);
    expect(isAllowedId(undefined, "1470765")).toBe(false);
  });

  it("grants ticked scopes the client asked for or the server offers, and reading always", () => {
    expect(grantedScopes([], [])).toEqual(["content:read"]);
    expect(grantedScopes(["keys:manage", "content:write", "offline_access"], ["content:read"])).toEqual(["content:read", "content:write"]);
    expect(grantedScopes(["keys:manage", "offline_access"], ["keys:manage", "offline_access"])).toEqual(["content:read", "keys:manage", "offline_access"]);
    expect(grantedScopes(["content:publish", "root"], ["root"])).toEqual(["content:read", "content:publish"]);
  });

  it("escapes what the client sent on the consent page", () => {
    const html = consentPage({ clientId: "c", clientName: '<img src=x onerror="alert(1)">', redirectUri: "https://x.test/cb", redirectHost: "x.test", redirectIsLoopback: false, scope: ['"><script>'] }, "h");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#60;img");
  });
});
