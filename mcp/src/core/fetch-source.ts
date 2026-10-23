// fetch_source's page reader. It reads public https pages only: no IP literals, internal names,
// other ports or private addresses, checked again on every redirect, with time and size capped, so
// an agent can't use the server to reach anything a stranger couldn't. Posts on X and files on
// GitHub are read from where their text actually is.
import type { AdminDeps } from "./deps";
import type { Page } from "./receipts";
import { ToolError } from "./tool";
import { postMeta, postTitle } from "./x";

export type FetchedPage = Omit<Page, "sha256" | "fetchedAt">;

export type FetchPageOptions = {
  fetch: typeof fetch;
  /** Node only: the host's addresses, so private ones are refused. Workers get this from global_fetch_strictly_public. */
  resolveHost?: (host: string) => Promise<string[]>;
  /** Our own hostnames: never fetched, nor their subdomains. */
  blockHosts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
};

const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; StackprintsBot/1.0; +https://stackprints.com)";
const MANUAL = "A claim from it can't be checked by machine: send it with verification 'manual' and a reason, or cite an HTML page that says the same.";

type Ctx = {
  get: (url: string, init: RequestInit) => Promise<Response>;
  resolveHost?: (host: string) => Promise<string[]>;
  blocked: string[];
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  userAgent: string;
};

export function createFetchPage(opts: FetchPageOptions): AdminDeps["fetchPage"] {
  // Kept unbound: Workers refuse a fetch called with another object as `this`.
  const f = opts.fetch;
  const blocked = (opts.blockHosts ?? []).map(bareHost);
  return async (input) => {
    const asked = parseUrl(input);
    assertPublicUrl(asked, blocked);
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const ctx: Ctx = {
      get: (url, init) => f(url, init),
      resolveHost: opts.resolveHost,
      blocked,
      signal: AbortSignal.timeout(timeoutMs),
      timeoutMs,
      maxBytes: opts.maxBytes ?? 3 * 1024 * 1024,
      userAgent: opts.userAgent ?? USER_AGENT,
    };
    const post = xStatus(asked);
    if (post) return readPost(ctx, post);
    const blob = githubBlob(asked);
    if (blob) {
      const read = await readDirect(ctx, blob.raw, true);
      return { ...read, url: asked.href, title: blob.path, meta: { ...read.meta, repo: blob.repo, ref: blob.ref, pinned: blob.pinned } };
    }
    return readDirect(ctx, asked, false);
  };
}

// ---- URLs and addresses ----

const bareHost = (h: string) => h.trim().toLowerCase().replace(/\.+$/, "");

function parseUrl(input: string, base?: URL): URL {
  const s = input.trim();
  let u: URL;
  try {
    u = base ? new URL(s, base) : new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    throw new ToolError(`Not a URL: ${input}. Pass a full https:// address.`, { url: input });
  }
  if (u.protocol === "http:") u.protocol = "https:";
  u.hash = "";
  return u;
}

const INTERNAL = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|arpa|test|invalid|example)$/;

function assertPublicUrl(u: URL, blocked: string[]) {
  const refuse = (why: string) => new ToolError(`Refused ${u.href}: ${why}. fetch_source reads public https pages only.`, { url: u.href });
  if (u.protocol !== "https:") throw refuse(`${u.protocol} URLs can't be fetched`);
  if (u.username || u.password) throw refuse("URLs with credentials are not fetched");
  if (u.port) throw refuse(`port ${u.port} is not allowed, only 443`);
  const host = bareHost(u.hostname);
  if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) throw refuse("IP addresses are not fetched, use the site's host name");
  if (!host.includes(".") || INTERNAL.test(host)) throw refuse("not a public host name");
  if (blocked.some((b) => host === b || host.endsWith(`.${b}`))) throw refuse("this server's own hosts are not fetched");
}

function ipv4Bytes(s: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const b = s.split(".").map(Number);
  return b.every((x) => x <= 255) ? b : null;
}

function privateV4([a, b, c]: number[]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Groups(ip: string): number[] | null {
  let s = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  let tail: number[] = [];
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = ipv4Bytes(v4[2]);
    if (!b) return null;
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    s = v4[1].endsWith("::") ? v4[1] : v4[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h === "" ? [] : h.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)));
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  const need = 8 - tail.length;
  if (halves.length === 1) return head.length === need ? [...head, ...tail] : null;
  const fill = need - head.length - rest.length;
  return fill < 0 ? null : [...head, ...Array<number>(fill).fill(0), ...rest, ...tail];
}

function privateV6(g: number[]) {
  const v4 = (hi: number, lo: number) => privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 7) && g[7] <= 1) return true; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, old site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7]); // IPv4-mapped and -compatible
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4(g[6], g[7]); // IPv4-translated
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4
  return false;
}

/** True for loopback, private, link-local, CGNAT, unique-local, multicast and unspecified addresses, and for anything unparseable. */
export function isPrivateAddress(ip: string) {
  const v4 = ipv4Bytes(ip.trim());
  if (v4) return privateV4(v4);
  const v6 = ip.includes(":") ? ipv6Groups(ip.trim()) : null;
  return v6 ? privateV6(v6) : true;
}

async function assertPublicAddress(ctx: Ctx, u: URL) {
  if (!ctx.resolveHost) return;
  const host = bareHost(u.hostname);
  let addresses: string[];
  try {
    addresses = await ctx.resolveHost(host);
  } catch (e) {
    throw new ToolError(`Couldn't resolve ${host}: ${(e as Error).message}.`, { url: u.href });
  }
  if (!addresses.length) throw new ToolError(`Couldn't resolve ${host}: no addresses.`, { url: u.href });
  const bad = addresses.find(isPrivateAddress);
  if (bad) throw new ToolError(`Refused ${u.href}: ${host} resolves to a private address (${bad}). fetch_source reads public https pages only.`, { url: u.href });
}

const X_HOST = /^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/;

function xStatus(u: URL): { user: string | null; id: string } | null {
  if (!X_HOST.test(bareHost(u.hostname))) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
  if (m) return { user: m[1].toLowerCase() === "i" ? null : m[1], id: m[2] };
  const w = u.pathname.match(/^\/i\/web\/status\/(\d+)/);
  if (w) return { user: null, id: w[1] };
  throw new ToolError(`Only posts on X (x.com/<user>/status/<id>) can be read, not ${u.href}. Use search_x to find posts.`, { url: u.href });
}

/**
 * A file on GitHub, read from raw.githubusercontent.com. `pinned` says the ref is a full 40-character
 * commit SHA. Pinned is not proof the text is the repository's own: GitHub serves any commit in a
 * fork network under the parent's URL, so a fork's commit can pose as vendor/repo's. Proving the
 * commit is reachable from one of the repository's own branches or tags takes the GitHub API (the
 * compare or branches-where-head endpoints), which is left to the caller as an optional check.
 */
function githubBlob(u: URL) {
  if (!/^(www\.)?github\.com$/.test(bareHost(u.hostname))) return null;
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (!m) return null;
  let path = m[4];
  try {
    path = decodeURIComponent(path);
  } catch {}
  return {
    raw: new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`),
    path,
    repo: `${m[1]}/${m[2]}`,
    ref: m[3],
    pinned: /^[0-9a-f]{40}$/.test(m[3]),
  };
}

// ---- Fetching ----

function networkError(ctx: Ctx, u: URL, e: unknown) {
  if (e instanceof ToolError) return e;
  if (ctx.signal.aborted) return new ToolError(`Timed out after ${ctx.timeoutMs / 1000}s reading ${u.href}.`, { url: u.href });
  return new ToolError(`Couldn't reach ${u.host}: ${(e as Error).message}.`, { url: u.href });
}

async function send(ctx: Ctx, u: URL, accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5") {
  try {
    return await ctx.get(u.href, { redirect: "manual", signal: ctx.signal, headers: { accept, "accept-language": "en", "user-agent": ctx.userAgent } });
  } catch (e) {
    throw networkError(ctx, u, e);
  }
}

const discard = (res: Response) => res.body?.cancel().catch(() => {});

/** The body up to maxBytes, then the stream is cancelled. Gives up when the signal aborts. */
async function readCapped(res: Response, maxBytes: number, signal: AbortSignal) {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {});
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      const chunk = value as Uint8Array;
      const room = maxBytes - size;
      if (chunk.byteLength > room) {
        chunks.push(chunk.subarray(0, room));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    if (truncated || signal.aborted) reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes, truncated };
}

const TEXT_TYPES = /^(text\/.+|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|[\w.-]+\+json|[\w.-]+\+xml))$/;
const mimeOf = (h: string | null) => (h ? h.split(";")[0].trim().toLowerCase() : "");
const charsetOf = (h: string | null) => h?.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1] ?? null;

function unreadable(u: URL, what: string) {
  return new ToolError(`${u.href} is ${what}, which the server can't read as text. ${MANUAL}`, { url: u.href, contentType: what });
}

function decode(bytes: Uint8Array, charset: string | null) {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function httpError(status: number, u: URL) {
  const hint =
    status === 404 || status === 410
      ? "The page is gone: check the URL."
      : status === 401 || status === 403 || status === 429
        ? `It may need a login or block bots. ${MANUAL}`
        : "Try again later, or cite another page.";
  return new ToolError(`${u.href} answered HTTP ${status}. ${hint}`, { url: u.href, status });
}

async function readDirect(ctx: Ctx, start: URL, raw: boolean): Promise<FetchedPage> {
  let current = start;
  for (let hops = 0; ; hops++) {
    await assertPublicAddress(ctx, current);
    const res = await send(ctx, current);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await discard(res);
      if (hops >= MAX_REDIRECTS) throw new ToolError(`Too many redirects from ${start.href} (more than ${MAX_REDIRECTS}); stopped at ${current.href}.`, { url: start.href, at: current.href });
      const next = parseUrl(location, current);
      assertPublicUrl(next, ctx.blocked);
      // A short link that lands on a post: read the post the way fetch_source reads X.
      const post = xStatus(next);
      if (post) return { ...(await readPost(ctx, post)), url: start.href };
      current = next;
      continue;
    }
    if (!res.ok) {
      await discard(res);
      throw httpError(res.status, current);
    }
    return readBody(ctx, res, start, current, raw);
  }
}

async function readBody(ctx: Ctx, res: Response, start: URL, at: URL, raw: boolean): Promise<FetchedPage> {
  const header = res.headers.get("content-type");
  const type = mimeOf(header);
  if (type && !TEXT_TYPES.test(type)) {
    await discard(res);
    throw unreadable(at, type === "application/pdf" ? "a PDF" : type);
  }
  let read: { bytes: Uint8Array; truncated: boolean };
  try {
    read = await readCapped(res, ctx.maxBytes, ctx.signal);
  } catch (e) {
    throw networkError(ctx, at, e);
  }
  const { bytes, truncated } = read;
  if (!type) {
    if (String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") throw unreadable(at, "a PDF");
    if (bytes.subarray(0, 1024).includes(0)) throw unreadable(at, "binary data");
  }
  const sniff = String.fromCharCode(...bytes.subarray(0, 1024));
  const html = type === "text/html" || type === "application/xhtml+xml" || (!type && /^\s*(<!doctype html|<html)/i.test(sniff));
  const charset = charsetOf(header) ?? (html ? (sniff.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ?? null) : null);
  const body = decode(bytes, charset);
  const base = { url: start.href, finalUrl: at.href, status: res.status, via: "direct" as const };
  const note = truncated ? { truncated: true } : {};

  if (raw) return { ...base, title: null, published: null, text: body, ...(truncated ? { meta: note } : {}) };
  if (html) {
    const { title, published, meta } = htmlMetadata(body);
    const text = htmlToText(body);
    const warning = text.length < 200 ? { warning: `Little readable text: the page may be built by JavaScript or behind a bot check. ${MANUAL}` } : {};
    const all = { ...meta, ...note, ...warning };
    return { ...base, title, published, text, ...(Object.keys(all).length ? { meta: all } : {}) };
  }
  if (/xml$/.test(type)) {
    const title = body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
    return { ...base, title: oneLine(title && decodeEntities(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))), published: null, text: xmlToText(body), ...(truncated ? { meta: note } : {}) };
  }
  const heading = /markdown/.test(type) ? body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1] : undefined;
  return { ...base, title: oneLine(heading), published: null, text: body, ...(truncated ? { meta: note } : {}) };
}

// ---- Posts on X ----

type FxAuthor = { screen_name?: string; name?: string; followers?: number };
type FxPost = {
  text?: string;
  author?: FxAuthor;
  created_at?: string;
  created_timestamp?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  views?: number | null;
  bookmarks?: number;
  quote?: FxPost;
  article?: { title?: string; preview_text?: string; content?: { blocks?: { text?: string }[] } };
};

function mirrorError(url: string, why: string) {
  return new ToolError(`Couldn't read ${url} through the public X mirror (${why}). Use search_x instead: it reads posts through the X API and records them so they can be cited.`, { url });
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * A post read through the mirror, filed under its real author: the mirror finds a post by its id
 * whatever handle the link names, so x.com/<anyone>/status/<id> must not credit <anyone> with it.
 * The handle asked for, when it differs, is kept as meta.requestedHandle.
 */
async function readPost(ctx: Ctx, post: { user: string | null; id: string }): Promise<FetchedPage> {
  const asked = `https://x.com/${post.user ?? "i"}/status/${post.id}`;
  // x.com shows nothing to a reader that isn't signed in; this mirror returns the post as JSON.
  const api = new URL(`https://api.fxtwitter.com/${post.user ? `${post.user}/` : ""}status/${post.id}`);
  const failed = (e: unknown) => mirrorError(asked, ctx.signal.aborted ? `timed out after ${ctx.timeoutMs / 1000}s` : (e as Error).message);
  let res: Response;
  try {
    res = await send(ctx, api, "application/json");
  } catch (e) {
    throw failed(e);
  }
  if (!res.ok) {
    await discard(res);
    throw mirrorError(asked, `HTTP ${res.status}`);
  }
  let t: FxPost | undefined;
  try {
    const { bytes } = await readCapped(res, ctx.maxBytes, ctx.signal);
    t = (JSON.parse(new TextDecoder().decode(bytes)) as { tweet?: FxPost }).tweet;
  } catch (e) {
    throw failed(e);
  }
  if (!t || typeof t.text !== "string") throw mirrorError(asked, "no post in its answer");
  const author = typeof t.author?.screen_name === "string" && HANDLE.test(t.author.screen_name) ? t.author.screen_name : null;
  // Without an author from the mirror, nobody is credited: the post is filed as x.com/i/status/<id>.
  const url = `https://x.com/${author ?? "i"}/status/${post.id}`;
  const handle = `@${author ?? "unknown"}`;
  const parts = [t.text];
  if (t.quote?.text) parts.push(`Quoting @${t.quote.author?.screen_name ?? "unknown"}: ${t.quote.text}`);
  if (t.article) {
    const blocks = (t.article.content?.blocks ?? []).map((b) => b.text ?? "").filter(Boolean);
    parts.push([t.article.title, ...(blocks.length ? blocks : [t.article.preview_text])].filter(Boolean).join("\n"));
  }
  const published = t.created_timestamp ? new Date(t.created_timestamp * 1000).toISOString().slice(0, 10) : toDay(t.created_at ?? "");
  const metrics = { likes: t.likes, reposts: t.retweets, replies: t.replies, quotes: t.quotes, views: t.views ?? undefined, bookmarks: t.bookmarks };
  const requested = post.user && post.user.toLowerCase() !== author?.toLowerCase() ? { requestedHandle: `@${post.user}` } : {};
  return {
    url,
    finalUrl: url,
    status: 200,
    title: postTitle(handle, t.text),
    published,
    text: parts.join("\n\n"),
    via: "x-mirror",
    meta: { ...postMeta(handle, t.author?.followers, metrics), ...requested },
  };
}

// ---- HTML to text and metadata ----

const COMMENTS = /<!--[\s\S]*?(?:-->|$)/g;

/** Removes these elements and everything inside them (to the end when unclosed). */
const dropElements = (html: string, tags: string[]) =>
  html.replace(new RegExp(`<(${tags.join("|")})\\b[^>]*?(?:\\/>|>[\\s\\S]*?(?:<\\/\\1\\s*>|$))`, "gi"), " ");

const NAMED: Record<string, string> = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: '"', QUOT: '"', apos: "'", nbsp: "\u00a0", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009",
  zwnj: "\u200c", zwj: "\u200d", shy: "\u00ad", ndash: "–", mdash: "—", hyphen: "‐", minus: "−", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”",
  bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", prime: "′", Prime: "″", hellip: "…", middot: "·", bull: "•", dagger: "†", Dagger: "‡",
  sect: "§", para: "¶", deg: "°", plusmn: "±", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³", micro: "µ",
  permil: "‰", copy: "©", COPY: "©", reg: "®", REG: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", iexcl: "¡", iquest: "¿", aelig: "æ",
  AElig: "Æ", oelig: "œ", OElig: "Œ", oslash: "ø", Oslash: "Ø", szlig: "ß", eth: "ð", ETH: "Ð", thorn: "þ", THORN: "Þ", larr: "←", rarr: "→", uarr: "↑",
  darr: "↓", harr: "↔", lArr: "⇐", rArr: "⇒", le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", check: "✓", star: "☆", ast: "*", num: "#", percnt: "%",
  lpar: "(", rpar: ")", lsqb: "[", rsqb: "]", lcub: "{", rcub: "}", vert: "|", sol: "/", bsol: "\\", grave: "`", lowbar: "_", equals: "=", plus: "+",
  colon: ":", semi: ";", comma: ",", period: ".", excl: "!", quest: "?", commat: "@", dollar: "$", Tab: "\t", NewLine: "\n",
};
// Accented letters: &eacute; &Uuml; &ccedil; and the rest, from the base letter and its mark.
for (const [mark, combining] of Object.entries({ grave: "\u0300", acute: "\u0301", circ: "\u0302", tilde: "\u0303", uml: "\u0308", ring: "\u030a", cedil: "\u0327" }))
  for (const letter of "aceinouyACEINOUY") {
    const c = (letter + combining).normalize("NFC");
    if (c.length === 1) NAMED[letter + mark] ??= c;
  }

// What browsers show for these code points, which pages often mean as Windows-1252.
const CP1252: Record<number, number> = { 0x80: 0x20ac, 0x85: 0x2026, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x99: 0x2122 };

export const decodeEntities = (s: string) =>
  s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex!, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(CP1252[cp] ?? cp) : "\ufffd";
  });

const oneLine = (s: string | null | undefined) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

const BLOCK = /<\/?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|tr|table|thead|tbody|tfoot|caption|section|article|header|footer|main|nav|aside|blockquote|figure|figcaption|form|fieldset|details|summary|address|hr|center)\b[^>]*>/gi;
const TAG = /<\/?[A-Za-z][^>]*>|<[!?][^>]*>/g;

function flowText(html: string) {
  const text = html
    .replace(/\s+/g, " ")
    .replace(BLOCK, "\n")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/?t[dh]\b[^>]*>/gi, " ")
    .replace(TAG, "");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g, " ").trim())
    .join("\n");
}

const preText = (html: string) => `\n${decodeEntities(html.replace(/<br\b[^>]*>/gi, "\n").replace(TAG, "")).replace(/[ \t]+$/gm, "")}\n`;

/** Readable text: no scripts, styles or head; a line break per block; entities decoded; spaces collapsed; <pre> kept as is. */
export function htmlToText(html: string) {
  let h = dropElements(html.replace(COMMENTS, ""), ["script", "style", "noscript", "svg", "template", "iframe", "object", "canvas"]);
  // </head> is optional in HTML, so stop at <body> when it's missing.
  h = h.replace(/<head\b[^>]*>[\s\S]*?(?:<\/head\s*>|(?=<body\b))/i, " ").replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, " ");
  return h
    .split(/(<pre\b[^>]*>[\s\S]*?<\/pre\s*>)/i)
    .map((part, i) => (i % 2 ? preText(part) : flowText(part)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attributes(s: string) {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const VALID_DAY = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A date as YYYY-MM-DD: the calendar day as written when it starts with one, else parsed. */
export function toDay(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return VALID_DAY(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  // A date without a time ("October 21, 2026") parses as local midnight: keep its local day.
  if (!/\d:\d\d/.test(t)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return d.toISOString().slice(0, 10);
}

function findDatePublished(v: unknown, depth = 0): string | null {
  if (depth > 20 || !v || typeof v !== "object") return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const d = findDatePublished(x, depth + 1);
      if (d) return d;
    }
    return null;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.datePublished === "string" && toDay(o.datePublished)) return toDay(o.datePublished);
  for (const x of Object.values(o)) {
    const d = findDatePublished(x, depth + 1);
    if (d) return d;
  }
  return null;
}

function ldDatePublished(block: string) {
  try {
    return findDatePublished(JSON.parse(block.trim()));
  } catch {
    // Hand-written JSON-LD is often not quite JSON.
    const m = block.match(/"datePublished"\s*:\s*"([^"]+)"/);
    return m ? toDay(m[1]) : null;
  }
}

const PUBLISHED_META = ["article:published_time", "og:article:published_time", "date", "pubdate", "datepublished"];

/** Title (og:title, else <title>), published day (meta, JSON-LD, then the first <time datetime>), and og:site_name and og:type. */
export function htmlMetadata(html: string): { title: string | null; published: string | null; meta: Record<string, string> } {
  const clean = html.replace(COMMENTS, "");
  const ld = [...clean.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]);
  const doc = dropElements(clean, ["script", "style", "svg", "template"]);
  const meta = new Map<string, string>();
  for (const m of doc.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const a = attributes(m[1]);
    if (a.content === undefined) continue;
    for (const k of [a.property, a.name, a.itemprop]) if (k && !meta.has(k.toLowerCase())) meta.set(k.toLowerCase(), a.content.trim());
  }
  const titleTag = doc.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const title = oneLine(meta.get("og:title")) ?? oneLine(titleTag && decodeEntities(titleTag)) ?? oneLine(meta.get("twitter:title"));
  const time = doc.match(/<time\b[^>]*?\bdatetime\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const published =
    PUBLISHED_META.map((k) => toDay(meta.get(k) ?? "")).find(Boolean) ??
    ld.map(ldDatePublished).find(Boolean) ??
    (time ? toDay(decodeEntities(time[1] ?? time[2] ?? time[3] ?? "")) : null);
  const out: Record<string, string> = {};
  if (meta.get("og:site_name")) out.siteName = meta.get("og:site_name")!;
  if (meta.get("og:type")) out.type = meta.get("og:type")!;
  return { title, published: published ?? null, meta: out };
}

/** A feed or other XML as text: one element per line, CDATA and escaped HTML read as HTML. */
export function xmlToText(xml: string) {
  const html = xml
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part, i) => (i % 2 ? part.slice(9, -3) : decodeEntities(part.replace(/<[^>]*>/g, "<br>"))))
    .join("");
  return htmlToText(html);
}
