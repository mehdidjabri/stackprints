// The site on Cloudflare: the static export in out/ as Workers Static Assets, with the rules
// vercel.json describes for other hosts. Markdown twins for agents that ask for them, the right
// content types and discovery headers, markdown 404s, and /mcp handed to the public MCP Worker.

type Env = {
  ASSETS: Fetcher;
  /** The public MCP Worker, through a service binding; /mcp 404s without it. */
  MCP?: Fetcher;
};

const AI_AGENTS = /(GPTBot|ClaudeBot|PerplexityBot|OAI-SearchBot|Claude-SearchBot|ChatGPT-User|Claude-User|Perplexity-User)/i;
const DISCOVERY =
  '</sitemap.xml>; rel="sitemap", </llms.txt>; rel="describedby"; type="text/plain", </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", </api/>; rel="service-doc"; type="text/html", </.well-known/api-catalog>; rel="api-catalog"';
const SITE = "https://stackprints.com";
const MARKDOWN = "text/markdown; charset=utf-8";

/** The canonical HTML page of a markdown twin, for its Link header. */
function canonicalOf(mdPath: string) {
  if (mdPath === "/index.md") return `${SITE}/`;
  const m = mdPath.match(/^\/((?:stack|stacks|layer|layers|trending|about|contact|privacy|api|contribute|pricing)(?:\/.*)?)\.md$/);
  return m ? `${SITE}/${m[1]}/` : null;
}

function withHeaders(res: Response, path: string, extra: Record<string, string> = {}) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("Vary", "Accept, User-Agent");
  if (path.endsWith(".md")) {
    h.set("Content-Type", MARKDOWN);
    const canonical = canonicalOf(path);
    h.set("Link", canonical ? `<${canonical}>; rel="canonical", ${DISCOVERY}` : DISCOVERY);
    if (path === "/404.md") h.set("X-Robots-Tag", "noindex");
  } else h.set("Link", DISCOVERY);
  if (/(^|\/)llms(-full)?\.txt$/.test(path)) h.set("Content-Type", "text/plain; charset=utf-8");
  if (path === "/.well-known/api-catalog") h.set("Content-Type", 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
  if (path === "/openapi.json") h.set("Content-Type", "application/vnd.oai.openapi+json; charset=utf-8");
  if (/^\/(api\/.*\.json|search\.json|stacks\.json|openapi\.json|\.well-known\/.*)$/.test(path)) h.set("Access-Control-Allow-Origin", "*");
  if (/(^|\/)opengraph-image$/.test(path)) h.set("Content-Type", "image/png");
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return out;
}

/** An asset at another path, keeping the request's method and headers. */
const asset = (env: Env, req: Request, path: string) => env.ASSETS.fetch(new Request(new URL(path, req.url), req));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/mcp" || path.startsWith("/mcp/")) return env.MCP ? env.MCP.fetch(req) : new Response("Not found", { status: 404 });

    const wantsMarkdown = /text\/markdown/i.test(req.headers.get("accept") ?? "");
    const agent = AI_AGENTS.test(req.headers.get("user-agent") ?? "");

    // Pages answer with their markdown twin to agents that ask for markdown, and to AI crawlers on HTML paths.
    if (req.method === "GET" || req.method === "HEAD") {
      let twin: string | null = null;
      if (path === "/" && (wantsMarkdown || agent)) twin = "/index.md";
      else if (wantsMarkdown && /^\/(.+?)\/?$/.test(path) && !/\.\w+$/.test(path)) twin = `${path.replace(/\/$/, "")}.md`;
      else if (agent && path.endsWith("/") && path !== "/") twin = `${path.slice(0, -1)}.md`;
      if (twin) {
        const md = await asset(env, req, twin);
        if (md.ok) return withHeaders(md, twin);
      }
    }

    const res = await env.ASSETS.fetch(req);
    if (res.status !== 404) return withHeaders(res, path);
    if (wantsMarkdown) return withHeaders(new Response((await asset(env, req, "/404.md")).body, { status: 404 }), "/404.md");
    const page = await asset(env, req, "/404.html");
    return withHeaders(new Response(page.body, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }), path);
  },
} satisfies ExportedHandler<Env>;
