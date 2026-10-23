// The public MCP server as a Cloudflare Worker: anonymous and read-only, answering from the bundle
// scripts/bundle.mjs writes before each deploy (the site's JSON API and the content it was built
// from), so the tools and the site always agree. Rate limited per address (an IPv6 /64 counts as one),
// generously, since connector platforms send every user's calls from a few shared addresses; open to
// browser clients.
import { type McpHttpHandler, createMcpHandler } from "@modelcontextprotocol/server";
// @ts-ignore: generated/ is written by scripts/bundle.mjs before every deploy, so a fresh checkout has none.
import bundle from "../../generated/bundle.json";
import { MapApi } from "../core/api";
import type { PublicDeps } from "../core/deps";
import type { Files } from "../core/types";
import { createPublicServer } from "../servers/public";
import { publicTools } from "../tools/public";

export type Env = {
  SITE_URL?: string;
  REPO_URL?: string;
  /** Workers Rate Limiting binding; absent in local dev, where nothing is limited. */
  RATE_LIMITER?: RateLimit;
  /** Secret, optional: a token that can only read public repositories, for get_submission_status. */
  GITHUB_READ_TOKEN?: string;
};

type Bundle = { builtAt: string; api: Record<string, unknown>; files: Record<string, string> };

const data = bundle as unknown as Bundle;
const files: Files = new Map(Object.entries(data.files));
const api = new MapApi(data.api);

const ALLOW_HEADERS = ["content-type", "accept", "authorization", "mcp-protocol-version", "mcp-session-id", "mcp-method", "mcp-name", "last-event-id"];
const EXPOSE_HEADERS = "mcp-session-id, mcp-protocol-version, retry-after, ratelimit, ratelimit-policy, www-authenticate";
// Mirror the ratelimits binding in wrangler.public.jsonc (public.test.ts checks that they agree).
const LIMIT = 600;
const PERIOD = 60;
const LIMIT_TEXT = `${LIMIT} requests a minute`;

// Bound by hand: Workers throw "Illegal invocation" on a detached global fetch.
const outbound: typeof fetch = (input, init) => fetch(input, init);

const depsFor = (env: Env): PublicDeps => ({
  api,
  files: async () => files,
  now: Date.now,
  siteUrl: (env.SITE_URL || "https://stackprints.com").replace(/\/$/, ""),
  repo: (env.REPO_URL || "https://github.com/stackprints/stackprints").replace(/\/$/, ""),
  fetch: outbound,
  ...(env.GITHUB_READ_TOKEN ? { githubToken: env.GITHUB_READ_TOKEN } : {}),
});

// One handler per isolate; env is the same for every request a deployment serves.
let handler: McpHttpHandler | undefined;
const mcp = (env: Env) => (handler ??= createMcpHandler(() => createPublicServer(depsFor(env)), { legacy: "stateless" }));

function withCors(res: Response) {
  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", "*");
  out.headers.set("Access-Control-Expose-Headers", EXPOSE_HEADERS);
  return out;
}

function preflight(req: Request) {
  // Clients may send Mcp-Param-* headers named after tool arguments, so requested names are allowed too.
  const asked = (req.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9-]+$/.test(h));
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": [...new Set([...ALLOW_HEADERS, ...asked])].join(", "),
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * Who a request counts against: the client's address, with IPv6 cut to its /64, the block one
 * subscriber usually holds (otherwise each of its 2^64 addresses would get a limit of its own).
 */
export function rateKey(ip: string | null): string {
  if (!ip) return "unknown";
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1];
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

/** The eight hextets of an IPv6 address, lower case without leading zeros; null if it isn't one. */
function expandIpv6(ip: string): string[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // An embedded IPv4 tail ("64:ff9b::192.0.2.1") is the last two hextets.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) s = `${s.slice(0, v4.index)}${((+v4[1] << 8) | +v4[2]).toString(16)}:${((+v4[3] << 8) | +v4[4]).toString(16)}`;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...tail];
  return all.every((w) => /^[0-9a-f]{1,4}$/.test(w)) ? all.map((w) => Number.parseInt(w, 16).toString(16)) : null;
}

async function overLimit(req: Request, env: Env) {
  if (!env.RATE_LIMITER) return false;
  const { success } = await env.RATE_LIMITER.limit({ key: rateKey(req.headers.get("cf-connecting-ip")) });
  return !success;
}

// RateLimit and RateLimit-Policy as the IETF httpapi draft spells them; the binding doesn't say how
// many calls are left or when its window turns, so the 429 says none, for at most one period.
const tooMany = () =>
  withCors(
    Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: `Rate limit exceeded: at most ${LIMIT_TEXT} per address. Retry after ${PERIOD} seconds.` } },
      {
        status: 429,
        headers: {
          "Retry-After": String(PERIOD),
          "RateLimit-Policy": `"fair-use";q=${LIMIT};w=${PERIOD}`,
          RateLimit: `"fair-use";r=0;t=${PERIOD}`,
        },
      },
    ),
  );

/** GET /: what this is and how to connect, in markdown, for people and agents alike. */
function home(req: Request, env: Env) {
  const deps = depsFor(env);
  const endpoint = new URL("/mcp", req.url).href;
  const tools = publicTools(deps).map((t) => `- \`${t.name}\`: ${t.description.split(/(?<=\.)\s/)[0]}`);
  const md = `# Stackprints MCP server

[Stackprints](${deps.siteUrl}) maps how AI agents are built: every agent as a stack of 28 layers in 5 bands, each pick with its sources. This server lets your agent read the catalogue, check a stack draft with the same rules as CI, and prepare a submission or a correction that you open on GitHub as yourself. It is anonymous and read-only, and stores nothing.

Endpoint: ${endpoint} (Streamable HTTP; MCP 2026-07-28, and the 2025 handshake for older clients)

## Connect

- Claude Code: \`claude mcp add --transport http stackprints ${endpoint}\`
- Claude and Claude Desktop: Settings, Connectors, Add custom connector, with the endpoint above.
- Clients with a JSON config:

\`\`\`json
{ "mcpServers": { "stackprints": { "type": "http", "url": "${endpoint}" } } }
\`\`\`

## Tools

${tools.join("\n")}

Fair use: ${LIMIT_TEXT} per address. Data built ${data.builtAt}. Source and contributions: ${deps.repo}
`;
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/mcp" || path === "/mcp/") {
      if (req.method === "OPTIONS") return preflight(req);
      if (await overLimit(req, env)) return tooMany();
      return withCors(await mcp(env).fetch(req));
    }
    if (path === "/" && (req.method === "GET" || req.method === "HEAD")) return home(req, env);
    return new Response("Not found. The MCP endpoint is /mcp.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
} satisfies ExportedHandler<Env>;
