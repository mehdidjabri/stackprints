import { describe, expect, it } from "vitest";
import { createFetchPage, decodeEntities, htmlMetadata, htmlToText, isPrivateAddress, toDay, xmlToText } from "../src/core/fetch-source";
import { pageFor, recordPage } from "../src/core/receipts";
import { MemoryState } from "../src/core/state";
import { ToolError } from "../src/core/tool";

type Route = (init: RequestInit) => Response | Promise<Response>;

/** A fetch that answers from a table of URLs and remembers every call. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    return route ? route(init) : new Response("no route", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const page = (body: string, type = "text/html; charset=utf-8", status = 200): Route => () => new Response(body, { status, headers: { "content-type": type } });
const redirect = (location: string, status = 301): Route => () => new Response(null, { status, headers: { location } });

async function refusal(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ToolError);
  return (e as ToolError).message;
}

const ARTICLE = `<!doctype html>
<html><head>
  <title>Fallback &amp; title</title>
  <meta property="og:title" content="Launch: Agents &quot;v2&quot; &mdash; now GA">
  <meta property="og:site_name" content="Example Blog">
  <meta property="og:type" content="article">
  <meta property="article:published_time" content="2026-10-20T09:00:00-07:00">
  <style>body { color: red }</style>
  <script>var secret = "do not show";</script>
</head>
<body>
  <nav><a href="/">Home</a></nav>
  <article>
    <h1>Agents   v2</h1>
    <p>We&rsquo;re shipping <b>agents</b> today.<br>Line two &#8212; with &#x2019;quotes&#39;.</p>
    <ul><li>One</li><li>Two&nbsp;&nbsp;items</li></ul>
    <svg><title>icon</title><path d="M0"/></svg>
    <noscript>Enable JavaScript</noscript>
    <pre>  indented
    code &lt;x&gt;</pre>
    <table><tr><td>a</td><td>b</td></tr></table>
  </article>
</body></html>`;

describe("HTML extraction", () => {
  it("prefers og:title, reads the published day, site name and type", () => {
    expect(htmlMetadata(ARTICLE)).toEqual({ title: 'Launch: Agents "v2" — now GA', published: "2026-10-20", meta: { siteName: "Example Blog", type: "article" } });
  });

  it("falls back to <title>, decoded and trimmed, ignoring svg titles", () => {
    expect(htmlMetadata("<svg><title>icon</title></svg><head><title>\n  Notes &amp; news  \n</title></head>").title).toBe("Notes & news");
  });

  it("finds the date in meta name=date, JSON-LD (including @graph) and <time>", () => {
    expect(htmlMetadata('<meta name="date" content="2026-09-01">').published).toBe("2026-09-01");
    expect(htmlMetadata('<meta itemprop="datePublished" content="2026-09-02T10:00:00Z">').published).toBe("2026-09-02");
    const graph = { "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "x" }, { "@type": "BlogPosting", datePublished: "2026-08-15T12:00:00+00:00" }] };
    expect(htmlMetadata(`<script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">${JSON.stringify(graph)}</script>`).published).toBe("2026-08-15");
    expect(htmlMetadata('<script type="application/ld+json">{ "datePublished": "2026-07-04",\n "headline": "bad\njson" }</script>').published).toBe("2026-07-04");
    expect(htmlMetadata('<p>Posted <time class="d" datetime="2026-06-30T08:00">June 30</time></p><time datetime="2020-01-01">').published).toBe("2026-06-30");
    expect(htmlMetadata("<p>No date</p>").published).toBeNull();
  });

  it("turns blocks into lines, decodes entities and drops what isn't shown", () => {
    const text = htmlToText(ARTICLE);
    expect(text).not.toMatch(/secret|color: red|icon|Enable JavaScript|Fallback/);
    expect(text).toContain("Agents v2");
    expect(text).toContain("We’re shipping agents today.\nLine two — with ’quotes'.");
    expect(text).toContain("One\n\nTwo items");
    expect(text).toContain("  indented\n    code <x>");
    expect(text).toContain("a b");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("decodes named, numeric and Windows-1252 entities, and leaves unknown ones", () => {
    expect(decodeEntities("&eacute;t&eacute; &Uuml;ber &ccedil;a &copy; &#169; &#x1F600; &#146; &bogus; &amp;lt;")).toBe("été Über ça © © 😀 ’ &bogus; &lt;");
  });

  it("reads dates as written, and parses other spellings", () => {
    expect(toDay("2026-10-21T23:30:00-07:00")).toBe("2026-10-21");
    expect(toDay("2026-02-30")).toBeNull();
    expect(toDay("Wed, 21 Oct 2026 14:00:00 GMT")).toBe("2026-10-21");
    expect(toDay("October 21, 2026")).toBe("2026-10-21");
    expect(toDay("soon")).toBeNull();
  });

  it("reads feeds, including CDATA and escaped HTML", () => {
    const text = xmlToText('<?xml version="1.0"?><rss><channel><title>Feed</title><item><title>Post &amp; more</title><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description><content><![CDATA[<p>Raw <i>html</i></p>]]></content></item></channel></rss>');
    expect(text.split("\n").filter(Boolean)).toEqual(["Feed", "Post & more", "Hello world", "Raw html"]);
  });
});

describe("fetchPage", () => {
  it("reads a page over https and returns its text and metadata", async () => {
    const { fetch, calls } = fakeFetch({ "https://example.com/post": page(ARTICLE) });
    const p = await createFetchPage({ fetch })("http://example.com/post#top");
    expect(calls[0].url).toBe("https://example.com/post");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(p).toMatchObject({ url: "https://example.com/post", finalUrl: "https://example.com/post", status: 200, title: 'Launch: Agents "v2" — now GA', published: "2026-10-20", via: "direct" });
    expect(p.meta).toMatchObject({ siteName: "Example Blog", type: "article" });
    expect(p.text).toContain("We’re shipping agents today.");
  });

  it("follows redirects by hand, re-checking each one, and upgrades http hops", async () => {
    const resolved: string[] = [];
    const resolveHost = async (host: string) => {
      resolved.push(host);
      return ["93.184.216.34"];
    };
    const { fetch, calls } = fakeFetch({
      "https://a.example.org/start": redirect("/moved", 302),
      "https://a.example.org/moved": redirect("http://b.example.net/final?x=1", 308),
      "https://b.example.net/final?x=1": page("<title>Final</title><p>Here.</p>"),
    });
    const p = await createFetchPage({ fetch, resolveHost })("https://a.example.org/start");
    expect(calls.map((c) => c.url)).toEqual(["https://a.example.org/start", "https://a.example.org/moved", "https://b.example.net/final?x=1"]);
    expect(resolved).toEqual(["a.example.org", "a.example.org", "b.example.net"]);
    expect(p).toMatchObject({ url: "https://a.example.org/start", finalUrl: "https://b.example.net/final?x=1", title: "Final", text: "Here." });
  });

  it("refuses a redirect to a private or local place", async () => {
    const toIp = fakeFetch({ "https://example.com/": redirect("http://169.254.169.254/latest/meta-data") });
    expect(await refusal(createFetchPage({ fetch: toIp.fetch })("https://example.com/"))).toMatch(/IP addresses/);
    expect(toIp.calls).toHaveLength(1);

    const toLocal = fakeFetch({ "https://example.com/": redirect("https://localhost/admin") });
    expect(await refusal(createFetchPage({ fetch: toLocal.fetch })("https://example.com/"))).toMatch(/not a public host/);

    const toPrivateDns = fakeFetch({ "https://example.com/": redirect("https://sneaky.example.net/") });
    const resolveHost = async (h: string) => (h === "sneaky.example.net" ? ["10.0.0.7"] : ["93.184.216.34"]);
    expect(await refusal(createFetchPage({ fetch: toPrivateDns.fetch, resolveHost })("https://example.com/"))).toMatch(/private address \(10\.0\.0\.7\)/);
    expect(toPrivateDns.calls).toHaveLength(1);
  });

  it("follows at most 5 redirects", async () => {
    const chain = (n: number) => {
      const routes: Record<string, Route> = {};
      for (let i = 0; i < n; i++) routes[`https://example.com/${i}`] = redirect(`/${i + 1}`);
      routes[`https://example.com/${n}`] = page("<p>end</p>");
      return routes;
    };
    expect((await createFetchPage(fakeFetch(chain(5)))("https://example.com/0")).finalUrl).toBe("https://example.com/5");
    const six = fakeFetch(chain(6));
    expect(await refusal(createFetchPage(six)("https://example.com/0"))).toMatch(/Too many redirects/);
    expect(six.calls).toHaveLength(6);
  });

  it("refuses IP literals, internal names, other ports, credentials, our own hosts and other schemes", async () => {
    const { fetch, calls } = fakeFetch({});
    const read = createFetchPage({ fetch, blockHosts: ["stackprints.com", "mcp.stackprints.com."] });
    for (const [url, why] of [
      ["https://127.0.0.1/", /IP addresses/],
      ["https://2130706433/", /IP addresses/],
      ["https://[::1]/", /IP addresses/],
      ["https://localhost/", /not a public host/],
      ["https://app.localhost/", /not a public host/],
      ["https://printer.local/", /not a public host/],
      ["https://metadata.google.internal/", /not a public host/],
      ["https://intranet/", /not a public host/],
      ["https://example.com:8443/", /port 8443/],
      ["http://example.com:8080/", /port 8080/],
      ["https://user:pw@example.com/", /credentials/],
      ["https://stackprints.com/api", /own hosts/],
      ["https://www.stackprints.com/", /own hosts/],
      ["ftp://example.com/file", /ftp: URLs/],
      ["file:///etc/passwd", /file: URLs/],
    ] as const)
      expect(await refusal(read(url)), url).toMatch(why);
    expect(await refusal(read("not a url at all"))).toMatch(/Not a URL/);
    expect(calls).toHaveLength(0);
  });

  it("refuses hosts that resolve to private addresses when it can resolve them", async () => {
    const { fetch, calls } = fakeFetch({ "https://ok.example.com/": page("<p>fine</p>") });
    const dns: Record<string, string[]> = {
      "ok.example.com": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
      "lo.example.com": ["127.0.0.1"],
      "mapped.example.com": ["93.184.216.34", "::ffff:192.168.1.1"],
      "ula.example.com": ["fd12:3456::1"],
      "none.example.com": [],
    };
    const read = createFetchPage({ fetch, resolveHost: async (h) => dns[h] ?? Promise.reject(new Error("NXDOMAIN")) });
    expect((await read("https://ok.example.com/")).text).toBe("fine");
    expect(await refusal(read("https://lo.example.com/"))).toMatch(/private address \(127\.0\.0\.1\)/);
    expect(await refusal(read("https://mapped.example.com/"))).toMatch(/private address/);
    expect(await refusal(read("https://ula.example.com/"))).toMatch(/private address/);
    expect(await refusal(read("https://none.example.com/"))).toMatch(/no addresses/);
    expect(await refusal(read("https://gone.example.com/"))).toMatch(/Couldn't resolve gone\.example\.com: NXDOMAIN/);
    expect(calls).toHaveLength(1);
  });

  it("refuses PDFs and binaries, pointing at the manual lane", async () => {
    const { fetch } = fakeFetch({
      "https://example.com/paper.pdf": page("%PDF-1.7 ...", "application/pdf"),
      "https://example.com/blob": page("\u0000\u0001", "application/octet-stream"),
      "https://example.com/untyped": () => new Response(new TextEncoder().encode("%PDF-1.4 rest")),
      "https://example.com/feed.json": page('{"items":[1]}', "application/feed+json"),
    });
    const read = createFetchPage({ fetch });
    expect(await refusal(read("https://example.com/paper.pdf"))).toMatch(/is a PDF.*verification 'manual'/);
    expect(await refusal(read("https://example.com/blob"))).toMatch(/application\/octet-stream.*manual/);
    expect(await refusal(read("https://example.com/untyped"))).toMatch(/is a PDF/);
    expect((await read("https://example.com/feed.json")).text).toBe('{"items":[1]}');
  });

  it("says the status of an HTTP error", async () => {
    const { fetch } = fakeFetch({ "https://example.com/blocked": page("no", "text/html", 403) });
    const read = createFetchPage({ fetch });
    expect(await refusal(read("https://example.com/missing"))).toMatch(/answered HTTP 404.*gone/);
    expect(await refusal(read("https://example.com/blocked"))).toMatch(/answered HTTP 403.*manual/);
  });

  it("stops reading at maxBytes and cancels the rest", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulls++;
          c.enqueue(new TextEncoder().encode("a".repeat(1000)));
        },
        cancel() {
          cancelled = true;
        },
      });
    const { fetch } = fakeFetch({ "https://example.com/huge": () => new Response(body(), { headers: { "content-type": "text/plain" } }) });
    const p = await createFetchPage({ fetch, maxBytes: 2500 })("https://example.com/huge");
    expect(p.text).toBe("a".repeat(2500));
    expect(p.meta).toEqual({ truncated: true });
    expect(pulls).toBeLessThanOrEqual(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toBe(true);
  });

  it("times out, while connecting and while reading", async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    expect(await refusal(createFetchPage({ fetch: hang, timeoutMs: 20 })("https://example.com/"))).toMatch(/Timed out after 0\.02s/);
    const { fetch } = fakeFetch({ "https://example.com/slow": () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { "content-type": "text/html" } }) });
    expect(await refusal(createFetchPage({ fetch, timeoutMs: 20 })("https://example.com/slow"))).toMatch(/Timed out/);
  });

  it("reads GitHub blobs from raw.githubusercontent.com, as is", async () => {
    const prompt = "# System prompt\n\n<b>Keep</b> this &amp; that exactly.\n";
    const { fetch, calls } = fakeFetch({ "https://raw.githubusercontent.com/acme/agent/main/prompts/system%20prompt.md": page(prompt, "text/plain; charset=utf-8") });
    const p = await createFetchPage({ fetch })("https://github.com/acme/agent/blob/main/prompts/system%20prompt.md#L3");
    expect(calls.map((c) => c.url)).toEqual(["https://raw.githubusercontent.com/acme/agent/main/prompts/system%20prompt.md"]);
    expect(p).toEqual({
      url: "https://github.com/acme/agent/blob/main/prompts/system%20prompt.md",
      finalUrl: "https://raw.githubusercontent.com/acme/agent/main/prompts/system%20prompt.md",
      status: 200,
      title: "prompts/system prompt.md",
      published: null,
      text: prompt,
      via: "direct",
      meta: { repo: "acme/agent", ref: "main", pinned: false },
    });
  });

  it("says whether a GitHub blob is pinned to a full commit SHA", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { fetch } = fakeFetch({
      [`https://raw.githubusercontent.com/acme/agent/${sha}/AGENTS.md`]: page("# Agents\n", "text/plain"),
      "https://raw.githubusercontent.com/acme/agent/0123456/AGENTS.md": page("# Agents\n", "text/plain"),
    });
    const read = createFetchPage({ fetch });
    expect((await read(`https://github.com/acme/agent/blob/${sha}/AGENTS.md`)).meta).toEqual({ repo: "acme/agent", ref: sha, pinned: true });
    expect((await read("https://github.com/acme/agent/blob/0123456/AGENTS.md")).meta).toMatchObject({ ref: "0123456", pinned: false });
  });
});

describe("posts on X", () => {
  const fx = {
    code: 200,
    message: "OK",
    tweet: {
      text: "We just shipped Agents v2.\nIt plans, codes and reviews.",
      author: { screen_name: "acme", name: "Acme", followers: 120000 },
      created_at: "Wed Oct 21 14:03:00 +0000 2026",
      created_timestamp: 1792591380,
      likes: 900,
      retweets: 120,
      replies: 45,
      quotes: 30,
      views: 250000,
      bookmarks: 80,
      quote: { text: "Agents v1 was just the start.", author: { screen_name: "acmeceo" } },
    },
  };

  it("reads a post through the public mirror", async () => {
    const { fetch, calls } = fakeFetch({ "https://api.fxtwitter.com/acme/status/1850000000000000001": () => Response.json(fx) });
    const p = await createFetchPage({ fetch })("https://twitter.com/acme/status/1850000000000000001?s=20&t=abc");
    expect(calls.map((c) => c.url)).toEqual(["https://api.fxtwitter.com/acme/status/1850000000000000001"]);
    expect(p).toEqual({
      url: "https://x.com/acme/status/1850000000000000001",
      finalUrl: "https://x.com/acme/status/1850000000000000001",
      status: 200,
      title: "@acme: We just shipped Agents v2. It plans, codes and reviews.",
      published: "2026-10-21",
      text: "We just shipped Agents v2.\nIt plans, codes and reviews.\n\nQuoting @acmeceo: Agents v1 was just the start.",
      via: "x-mirror",
      meta: { author: "@acme", followers: 120000, likes: 900, reposts: 120, replies: 45, quotes: 30, views: 250000, bookmarks: 80 },
    });
  });

  it("cuts the title at 100 characters and follows short links to posts", async () => {
    const long = { tweet: { ...fx.tweet, text: "x".repeat(150), quote: undefined, created_timestamp: undefined } };
    const { fetch } = fakeFetch({
      "https://t.co/abc": redirect("https://x.com/acme/status/42"),
      "https://api.fxtwitter.com/acme/status/42": () => Response.json(long),
    });
    const p = await createFetchPage({ fetch })("https://t.co/abc");
    expect(p.url).toBe("https://t.co/abc");
    expect(p.finalUrl).toBe("https://x.com/acme/status/42");
    expect(p.title).toBe(`@acme: ${"x".repeat(100)}`);
    expect(p.published).toBe("2026-10-21");
  });

  it("names search_x when the mirror can't help, and refuses other x.com pages", async () => {
    const { fetch } = fakeFetch({ "https://api.fxtwitter.com/acme/status/7": () => Response.json({ code: 404, message: "NOT_FOUND" }, { status: 404 }) });
    const read = createFetchPage({ fetch });
    expect(await refusal(read("https://x.com/acme/status/7"))).toMatch(/HTTP 404.*search_x/);
    expect(await refusal(read("https://x.com/acme"))).toMatch(/Only posts on X.*search_x/);
  });

  it("files a post under its real author, whatever handle the link names", async () => {
    const { fetch, calls } = fakeFetch({ "https://api.fxtwitter.com/OpenAI/status/1850000000000000001": () => Response.json(fx) });
    const p = await createFetchPage({ fetch })("https://x.com/OpenAI/status/1850000000000000001");
    expect(calls.map((c) => c.url)).toEqual(["https://api.fxtwitter.com/OpenAI/status/1850000000000000001"]);
    expect(p).toMatchObject({
      url: "https://x.com/acme/status/1850000000000000001",
      finalUrl: "https://x.com/acme/status/1850000000000000001",
      title: "@acme: We just shipped Agents v2. It plans, codes and reviews.",
      meta: { author: "@acme", requestedHandle: "@OpenAI" },
    });

    const now = Date.parse("2026-10-22T12:00:00Z");
    const state = new MemoryState(() => now);
    // Recorded as fetch_source does, under the URL as asked too: the asked spelling still gets no receipt.
    const rec = await recordPage(state, { ...p, url: "https://x.com/OpenAI/status/1850000000000000001" }, now);
    expect(rec.url).toBe("https://x.com/acme/status/1850000000000000001");
    expect(await pageFor(state, "https://x.com/OpenAI/status/1850000000000000001", now)).toBeNull();
    expect(await pageFor(state, "https://x.com/openai/status/1850000000000000001?s=20", now)).toBeNull();
    expect((await pageFor(state, "https://twitter.com/ACME/status/1850000000000000001", now))?.meta).toMatchObject({ author: "@acme" });
  });

  it("only notes a requested handle that differs by more than case, and credits nobody when the mirror names no author", async () => {
    const anonymous = { tweet: { ...fx.tweet, author: undefined, quote: undefined } };
    const { fetch } = fakeFetch({
      "https://api.fxtwitter.com/ACME/status/5": () => Response.json(fx),
      "https://api.fxtwitter.com/OpenAI/status/6": () => Response.json(anonymous),
      "https://api.fxtwitter.com/acme/status/7": () => Response.json({ tweet: { ...fx.tweet, author: { screen_name: "not a handle!" } } }),
    });
    const read = createFetchPage({ fetch });
    const sameCase = await read("https://x.com/ACME/status/5");
    expect(sameCase.url).toBe("https://x.com/acme/status/5");
    expect(sameCase.meta).not.toHaveProperty("requestedHandle");
    const nobody = await read("https://x.com/OpenAI/status/6");
    expect(nobody).toMatchObject({ url: "https://x.com/i/status/6", finalUrl: "https://x.com/i/status/6", meta: { author: "@unknown", requestedHandle: "@OpenAI" } });
    expect(nobody.title).toMatch(/^@unknown: /);
    expect((await read("https://x.com/acme/status/7")).url).toBe("https://x.com/i/status/7");
  });

  it("gives a page that recordPage keeps and pageFor finds by either spelling", async () => {
    const { fetch } = fakeFetch({ "https://api.fxtwitter.com/acme/status/1850000000000000001": () => Response.json(fx) });
    const now = Date.parse("2026-10-22T12:00:00Z");
    const state = new MemoryState(() => now);
    await recordPage(state, await createFetchPage({ fetch })("https://x.com/acme/status/1850000000000000001"), now);
    expect((await pageFor(state, "https://twitter.com/acme/status/1850000000000000001?s=46", now))?.via).toBe("x-mirror");
  });
});

describe("isPrivateAddress", () => {
  it.each([
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.168.0.10", true],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["100.128.0.1", false],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["::", true],
    ["::1", true],
    ["fc00::1", true],
    ["fdff:ffff::1", true],
    ["fe80::1%en0", true],
    ["ff02::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:7f00:1", true],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::a00:1", true],
    ["2002:c0a8:0101::1", true],
    ["2001:4860:4860::8888", false],
    ["not-an-ip", true],
  ])("%s -> %s", (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected));
});
