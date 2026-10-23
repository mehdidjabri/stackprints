// The admin MCP server as a Cloudflare Worker: both the OAuth authorization server and the MCP
// resource at /mcp. Two ways in:
// - claude.ai (and any MCP client that signs in): OAuth with our consent page, GitHub as the identity
//   and an allowlist of numeric GitHub ids (github-auth.ts);
// - any other agent: an API key (Authorization: Bearer spk_...) minted with create_api_key, or, while
//   no key exists yet, the BOOTSTRAP_KEY secret, which acts as the owner to mint the first one.
// Each request builds the tools for its caller's scopes. Writes commit to the GitHub repository, which
// is the site's database; changesets, receipts, keys and the audit log live in D1, which reads back
// what was just written (KV may not, for a minute). Sign-in, registration, tokens and failed
// authentications are rate limited per address.
import {
  type ClientRegistrationCallbackOptions,
  type ClientRegistrationCallbackResult,
  OAuthProvider,
  type OAuthHelpers,
  type OAuthResourceContext,
  type ResolveExternalTokenResult,
} from "@cloudflare/workers-oauth-provider";
import { type AuthInfo, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { FetchApi } from "../core/api";
import { BOOTSTRAP_KEY_ID, hasAnyKey, parseScopes, sha256Hex, verifyKey } from "../core/auth";
import { D1State } from "../core/d1-state";
import type { AdminDeps } from "../core/deps";
import { createFetchPage } from "../core/fetch-source";
import { KvState, type StateStore } from "../core/state";
import { type Principal, SCOPES, type Scope } from "../core/types";
import { createSearchX } from "../core/x";
import { createAdminServer } from "../servers/admin";
import { GitHubStore } from "../stores/github";
import { GRANTABLE, REQUIRED_SCOPES, authorize, callback, isAllowedId } from "./github-auth";

export type Env = {
  /** Grants, tokens, clients and consent records of the OAuth provider. */
  OAUTH_KV: KVNamespace;
  /** Changesets, fetched pages, API keys and the audit log: the state table of migrations/. */
  DB: D1Database;
  /** Optional: keeps each commit's files and details between requests (they never change). */
  CACHE_KV?: KVNamespace;
  /** Optional: requests per address on sign-in, registration, tokens and failed /mcp authentication. */
  RATE_LIMITER?: RateLimit;
  /** "owner/name" of the content repository. */
  GITHUB_REPO: string;
  /** Secret: a token that can write contents and pull requests on GITHUB_REPO. */
  GITHUB_TOKEN: string;
  /** The GitHub OAuth App people sign in with (callback URL: <this origin>/callback). */
  GITHUB_CLIENT_ID: string;
  /** Secret. */
  GITHUB_CLIENT_SECRET: string;
  /** Comma-separated numeric GitHub user ids allowed to sign in, and whose API keys keep working. */
  ADMIN_GITHUB_IDS: string;
  /** "https://stackprints.com": the live site, whose JSON API the catalogue tools read. */
  SITE_URL: string;
  /** Secret, optional: turns on search_x. */
  X_BEARER_TOKEN?: string;
  /** Secret, optional: a bearer value (32+ characters) accepted as the owner while no API key exists, to mint the first. Delete it afterwards. */
  BOOTSTRAP_KEY?: string;
  /** Optional "Name <email>" for the commits the server writes; default: GITHUB_TOKEN's account. */
  GIT_COMMITTER?: string;
  /** Set by OAuthProvider for the handlers. */
  OAUTH_PROVIDER?: OAuthHelpers;
};

export type Props = { name: string; kind: "github" | "apikey"; login?: string; githubId?: number; keyId?: string; scopes: Scope[] };

const DEFAULT_SITE = "https://stackprints.com";
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 86400;
const BOOTSTRAP_MIN = 32;
/** Keep in step with ratelimits in wrangler.admin.jsonc. */
const LIMIT = "30 a minute";
const LIMITED_PATHS = new Set(["/authorize", "/oauth/register", "/oauth/token", "/callback"]);
const REGISTRATION_MAX_BYTES = 8192;
const REDIRECT_URIS_MAX = 5;

// Fetched lazily through the global, so it stays bound in Workers and tests can stub it.
const outbound: typeof fetch = (input, init) => fetch(input, init);

const SCOPE = z.enum(SCOPES as [Scope, ...Scope[]]);
const PROPS = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["github", "apikey"]),
  login: z.string().min(1).optional(),
  githubId: z.number().int().positive().optional(),
  keyId: z.string().min(1).optional(),
  scopes: z.array(SCOPE),
});

const isScope = (s: string): s is Scope => (SCOPES as string[]).includes(s);

/**
 * The caller, from what the token carries, or null when it can't act here. An OAuth token
 * (it names its client) holds what its consent granted, within what the grant's props allow; an API
 * key's props are its whole grant. A GitHub account's numeric id must still be on the allowlist:
 * removing it there locks it out at once, refresh tokens or not. Logins are only shown.
 */
export function principalFrom(props: unknown, auth: { clientId?: string; userId?: string; scope: string[] }, allowedIds: string | undefined): Principal | null {
  const p = PROPS.safeParse(props);
  if (!p.success) return null;
  const v = p.data;
  if (v.kind === "github") {
    if (!isAllowedId(v.githubId, allowedIds)) return null;
    // The grant's subject is the same account (callback() names it github-<id>).
    if (auth.userId !== undefined && auth.userId !== `github-${v.githubId}`) return null;
  }
  let scopes: Scope[] = v.scopes;
  if (auth.clientId !== undefined) {
    const granted = new Set(parseScopes(auth.scope.filter(isScope)));
    scopes = v.scopes.filter((s) => granted.has(s));
  }
  return {
    name: v.name,
    kind: v.kind,
    ...(v.login ? { login: v.login } : {}),
    ...(v.githubId !== undefined ? { githubId: v.githubId } : {}),
    ...(v.keyId ? { keyId: v.keyId } : {}),
    scopes,
  };
}

/** The Worker's state: D1, strongly consistent. */
export const stateFor = (env: Pick<Env, "DB">): StateStore => new D1State(env.DB);

/**
 * An API key, or the bootstrap key while no API key exists, as the props the MCP handler receives;
 * null for anything else. A key whose minting traces back to a GitHub account off ADMIN_GITHUB_IDS
 * is refused like a revoked one.
 */
export async function resolveApiKey(token: string, env: Pick<Env, "DB" | "BOOTSTRAP_KEY" | "ADMIN_GITHUB_IDS">, resource: string): Promise<ResolveExternalTokenResult | null> {
  const state = stateFor(env);
  const bootstrap = env.BOOTSTRAP_KEY?.trim();
  // Compared as hashes, so the comparison takes the same time wherever the strings differ.
  if (bootstrap && bootstrap.length >= BOOTSTRAP_MIN && (await sha256Hex(token)) === (await sha256Hex(bootstrap))) {
    if (await hasAnyKey(state)) {
      console.warn("stackprints-admin: BOOTSTRAP_KEY refused because API keys exist; delete the secret (npx wrangler secret delete BOOTSTRAP_KEY -c wrangler.admin.jsonc)");
      return null;
    }
    console.warn("stackprints-admin: BOOTSTRAP_KEY used as the owner; mint a key with create_api_key, then delete the secret");
    const props: Props = { name: "bootstrap", kind: "apikey", keyId: BOOTSTRAP_KEY_ID, scopes: [...SCOPES] };
    return { props, audience: resource };
  }
  const record = await verifyKey(state, token, { githubAllowed: (id) => isAllowedId(id, env.ADMIN_GITHUB_IDS) });
  if (!record) return null;
  const props: Props = { name: record.name, kind: "apikey", keyId: record.id, scopes: record.scopes };
  return { props, audience: resource };
}

const committer = (spec: string | undefined) => {
  const m = spec?.match(/^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  return m ? { name: m[1], email: m[2] } : undefined;
};

// One per site and isolate: FetchApi keeps the site's answers for five minutes.
const apis = new Map<string, FetchApi>();

export function adminDepsFor(env: Env, principal: Principal, request: Request): AdminDeps {
  const siteUrl = (env.SITE_URL || DEFAULT_SITE).replace(/\/$/, "");
  const state = stateFor(env);
  // A commit's files run to megabytes, past what a D1 row holds: KV keeps them, or nothing does.
  const cache = env.CACHE_KV ? new KvState(env.CACHE_KV) : undefined;
  const store = new GitHubStore({ repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, cache, committer: committer(env.GIT_COMMITTER) });
  let api = apis.get(siteUrl);
  if (!api) apis.set(siteUrl, (api = new FetchApi(siteUrl, outbound)));
  return {
    api,
    files: () => store.files(),
    now: Date.now,
    siteUrl,
    repo: `https://github.com/${env.GITHUB_REPO}`,
    fetch: outbound,
    store,
    state,
    principal,
    // Our own hosts are never sources (the site's subdomains included); global_fetch_strictly_public keeps the rest public.
    fetchPage: createFetchPage({ fetch: outbound, blockHosts: [new URL(siteUrl).hostname, new URL(request.url).hostname] }),
    searchX: env.X_BEARER_TOKEN ? createSearchX({ fetch: outbound, bearer: env.X_BEARER_TOKEN }) : undefined,
  };
}

/** /mcp, after the provider checked the token: the admin server for this caller. */
async function serveMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { auth, props } = ctx as unknown as OAuthResourceContext<unknown>;
  const principal = principalFrom(props, auth, env.ADMIN_GITHUB_IDS);
  if (!principal)
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "This credential no longer grants access here: sign in again, or ask the owner for a new API key." } },
      { status: 403 },
    );
  const authInfo: AuthInfo = {
    token: auth.token,
    clientId: auth.clientId ?? principal.keyId ?? principal.kind,
    scopes: principal.scopes,
    ...(auth.expiresAt ? { expiresAt: auth.expiresAt } : {}),
    resource: new URL(auth.audience),
    extra: { principal },
  };
  const deps = adminDepsFor(env, principal, request);
  return createMcpHandler(() => createAdminServer(deps), { legacy: "stateless" }).fetch(request, { authInfo });
}

/** GET /: what this is and how to connect, in markdown. */
function home(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  const endpoint = `${origin}/mcp`;
  const md = `# Stackprints admin MCP server

The maintainers' agents research and write [Stackprints](${(env.SITE_URL || DEFAULT_SITE).replace(/\/$/, "")}) content through this server. Every change is checked with the same rules as CI and committed to the repository, straight to main when the caller may publish, as a pull request otherwise. It is private: every call needs a credential.

Endpoint: ${endpoint} (Streamable HTTP; MCP 2026-07-28, and the 2025 handshake for older clients)

## Connect

- **claude.ai and Claude Desktop**: Settings, Connectors, Add custom connector, with the endpoint above. You sign in with GitHub; only allowed accounts (by GitHub user id) get in.
- **Claude Code and other agents**, with an API key: \`claude mcp add --transport http stackprints-admin ${endpoint} --header "Authorization: Bearer spk_..."\`
- **Any HTTP client**: send \`Authorization: Bearer spk_...\` on every request to ${endpoint}.

API keys are minted with the \`create_api_key\` tool (scope keys:manage), shown once, and revoked with \`revoke_api_key\`, which also ends every key the revoked one minted. Scopes: content:read (read and research), content:write (propose; submits open pull requests), content:publish (submit straight to main, revert), keys:manage.

First run, before any key exists: set the \`BOOTSTRAP_KEY\` secret, connect with \`Authorization: Bearer <that value>\` (it acts as the owner), mint your first key with \`create_api_key\`, then delete the secret (\`npx wrangler secret delete BOOTSTRAP_KEY -c wrangler.admin.jsonc\`). It stops working as soon as a key exists.

OAuth metadata: ${origin}/.well-known/oauth-protected-resource/mcp and ${origin}/.well-known/oauth-authorization-server
`;
  return new Response(request.method === "HEAD" ? null : md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

async function serveDefault(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/authorize") return authorize(request, env);
  if (path === "/callback" && request.method === "GET") return callback(request, env, outbound);
  if (path === "/" && (request.method === "GET" || request.method === "HEAD")) return home(request, env);
  return new Response("Not found. The MCP endpoint is /mcp.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Dynamic client registration is open to anyone (claude.ai registers that way), so each record is
 * kept small: the rate limit bounds how many, this bounds how big.
 */
export async function checkRegistration({ clientMetadata, request }: ClientRegistrationCallbackOptions): Promise<ClientRegistrationCallbackResult | void> {
  if ((await request.text()).length > REGISTRATION_MAX_BYTES) return { description: `Client metadata is limited to ${REGISTRATION_MAX_BYTES} bytes.` };
  const uris = clientMetadata.redirect_uris;
  if (Array.isArray(uris) && uris.length > REDIRECT_URIS_MAX) return { description: `At most ${REDIRECT_URIS_MAX} redirect_uris.` };
}

/**
 * The provider for one origin. A resource is an absolute URL fixed at construction, and this Worker
 * may answer on its workers.dev host and on a custom domain, so each origin gets its own (tokens
 * issued on one are refused on the other, as RFC 8707 wants).
 */
export function providerFor(origin: string) {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: serveMcp },
    defaultHandler: { fetch: serveDefault },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    // claude.ai registers dynamically today; clients on the 2026 spec use a Client ID Metadata Document.
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...GRANTABLE],
    // What the 401 challenge tells clients to ask for; claude.ai asks for exactly this (REQUIRED_SCOPES says why).
    requiredScopes: [...REQUIRED_SCOPES],
    clientRegistrationCallback: checkRegistration,
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource_name: "Stackprints admin",
    },
    accessTokenTTL: ACCESS_TTL,
    refreshTokenTTL: REFRESH_TTL,
    resolveExternalToken: async ({ token, request, env }) => resolveApiKey(token, env, `${new URL(request.url).origin}/mcp`),
  });
}

/**
 * Who a request comes from, for rate limiting: its address, or for IPv6 its /64, the block one
 * machine or home usually holds (counting each of its addresses apart would let one client rotate).
 */
export function clientKey(request: Request) {
  const ip = (request.headers.get("cf-connecting-ip") ?? "").trim();
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail] = ip.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/** Addresses that failed authentication too often, refused until the time given, per limiter (so per Worker env). */
const blocked = new WeakMap<RateLimit, Map<string, number>>();
const BLOCK_MS = 60_000;

async function overLimit(env: Env, key: string) {
  if (!env.RATE_LIMITER) return false;
  return !(await env.RATE_LIMITER.limit({ key })).success;
}

function tooMany(path: string) {
  const message = `Too many requests from this address (at most ${LIMIT}): retry in a minute.`;
  const headers = { "Retry-After": "60", "Cache-Control": "no-store" };
  if (path === "/mcp") return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status: 429, headers });
  if (path.startsWith("/oauth/")) return Response.json({ error: "temporarily_unavailable", error_description: message }, { status: 429, headers });
  return new Response(`${message}\n`, { status: 429, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

const providers = new Map<string, OAuthProvider<Env>>();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const who = clientKey(request);
    if (LIMITED_PATHS.has(url.pathname) && (await overLimit(env, `${url.pathname}:${who}`))) return tooMany(url.pathname);

    // Failed authentications are counted apart; past the limit the address is refused for a minute
    // without its tokens being checked again (in this isolate).
    const failures = env.RATE_LIMITER && url.pathname === "/mcp" ? blocked.get(env.RATE_LIMITER) ?? new Map<string, number>() : undefined;
    if (failures && (failures.get(who) ?? 0) > Date.now()) return tooMany("/mcp");

    let provider = providers.get(url.origin);
    if (!provider) providers.set(url.origin, (provider = providerFor(url.origin)));
    const response = await provider.fetch(request, env, ctx);

    if (failures && response.status === 401 && request.headers.has("authorization") && (await overLimit(env, `auth-failed:${who}`))) {
      if (failures.size > 10_000) failures.clear();
      failures.set(who, Date.now() + BLOCK_MS);
      blocked.set(env.RATE_LIMITER!, failures);
      return tooMany("/mcp");
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
