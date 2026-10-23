// Pages the server fetched itself. A URL can only be cited in a change if fetch_source (or
// search_x, for posts on X) read it in the last 14 days, so "only cite pages you opened" is a rule
// the server enforces, and quotes can be checked against the text it saw.
import { sha256Hex } from "./auth";
import type { StateStore } from "./state";

export type Page = {
  /** The URL as asked for. */
  url: string;
  /** Where it ended up after redirects. */
  finalUrl: string;
  status: number;
  title: string | null;
  /** From page metadata (article:published_time, datePublished, a post's date), YYYY-MM-DD. */
  published: string | null;
  /** Readable text, capped (see MAX_TEXT). */
  text: string;
  sha256: string;
  fetchedAt: string;
  /** How it was read: the page itself, a public X mirror, or the X API. */
  via: "direct" | "x-mirror" | "x-api";
  /** Anything else worth keeping: a post's author and counts, a page's og:site_name. */
  meta?: Record<string, unknown>;
};

export const RECEIPT_DAYS = 14;
export const RECEIPT_MS = RECEIPT_DAYS * 864e5;
export const MAX_TEXT = 400_000;
/** A receipt is one D1 row, which holds at most 2 MB: keep its text well under that once stored as JSON. */
const MAX_STORED_BYTES = 1_200_000;

const storedBytes = (s: string) => new TextEncoder().encode(JSON.stringify(s)).length;

/** The text cut to MAX_TEXT characters, then shorter still if escapes or wide characters make it too big to store. */
function capText(text: string) {
  let t = text.slice(0, MAX_TEXT);
  for (let bytes = storedBytes(t); bytes > MAX_STORED_BYTES; bytes = storedBytes(t)) t = t.slice(0, Math.floor((t.length * MAX_STORED_BYTES) / bytes) - 1);
  return t;
}

const X_POST = /^\/(?:i\/web|([A-Za-z0-9_]{1,15}))\/status(?:es)?\/(\d+)(\/.*)?$/;

/** A post on X: its author's handle in lower case ("i" when the link names none) and its id. */
function xPost(url: URL) {
  if (url.hostname !== "x.com") return null;
  const m = url.pathname.match(X_POST);
  return m ? { handle: (m[1] ?? "i").toLowerCase(), id: m[2], rest: m[3] ?? "" } : null;
}

/** The query keys that only say how someone arrived. Only these: a CMS echoes ?s=, ?q= and the like into the page. */
const TRACKING = /^(utm_.*|fbclid|gclid)$/;

function withoutTracking(search: string) {
  const kept = search
    .slice(1)
    .split("&")
    .filter((pair) => {
      if (!pair) return false;
      const k = pair.split("=")[0];
      try {
        return !TRACKING.test(decodeURIComponent(k.replace(/\+/g, " ")));
      } catch {
        return true;
      }
    });
  // Rejoined by hand, so the parameters that stay keep their exact spelling.
  return kept.length ? `?${kept.join("&")}` : "";
}

/**
 * One spelling per page: no fragment, no utm_*, fbclid or gclid, no trailing slash, lower-case
 * host, twitter.com as x.com. A post on X is its id under its author's handle (handles ignore
 * case), so its whole query (?s=20&t=…, how it was shared) goes.
 */
export function normalizeUrl(u: string) {
  const url = new URL(u);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^(www\.|mobile\.)?twitter\.com$/, "x.com").replace(/^(www\.|mobile\.)x\.com$/, "x.com");
  const post = xPost(url);
  if (post) {
    url.pathname = `/${post.handle}/status/${post.id}${post.rest}`;
    url.search = "";
  } else url.search = withoutTracking(url.search);
  let s = url.toString();
  if (url.pathname !== "/" && s.endsWith("/") && !url.search) s = s.slice(0, -1);
  return s;
}

const key = async (u: string) => `page:${await sha256Hex(normalizeUrl(u))}`;

/** True when `asked` names a post's author and the page read is not that author's post. */
function misattributed(asked: string, final: string) {
  let a: ReturnType<typeof xPost>;
  let f: ReturnType<typeof xPost>;
  try {
    a = xPost(new URL(normalizeUrl(asked)));
    f = xPost(new URL(normalizeUrl(final)));
  } catch {
    return false;
  }
  if (!a || a.handle === "i") return false;
  return !f || f.handle !== a.handle || f.id !== a.id;
}

/**
 * Keeps a page for 14 days, under its asked-for URL and its final URL. A post on X is never kept
 * under a link that names someone other than its author: x.com/<anyone>/status/<id> resolves by id
 * alone, so that link would credit them with a stranger's words.
 */
export async function recordPage(state: StateStore, page: Omit<Page, "sha256" | "fetchedAt" | "text"> & { text: string }, now: number): Promise<Page> {
  const text = capText(page.text);
  const url = misattributed(page.url, page.finalUrl) ? page.finalUrl : page.url;
  const full: Page = { ...page, url, text, sha256: await sha256Hex(text), fetchedAt: new Date(now).toISOString() };
  const ttlSeconds = RECEIPT_DAYS * 86400;
  await state.put(await key(full.url), full, { ttlSeconds });
  if (normalizeUrl(full.finalUrl) !== normalizeUrl(full.url)) await state.put(await key(full.finalUrl), full, { ttlSeconds });
  return full;
}

/** "14 days", "48 hours": a receipt window as the error messages say it. */
export const windowText = (ms: number) => (ms >= 3 * 864e5 && ms % 864e5 === 0 ? `${ms / 864e5} days` : `${Math.round(ms / 36e5)} hours`);

/** The page fetched at this URL within `maxAgeMs` (14 days, the longest a receipt is kept), or null. */
export async function pageFor(state: StateStore, url: string, now: number, options?: { maxAgeMs?: number }) {
  const maxAge = Math.min(options?.maxAgeMs ?? RECEIPT_MS, RECEIPT_MS);
  let p: Page | null;
  try {
    p = await state.get<Page>(await key(url));
  } catch {
    return null;
  }
  if (!p || now - Date.parse(p.fetchedAt) > maxAge) return null;
  return p;
}

/** Text compared loosely: case, whitespace, quote marks, dashes and markdown emphasis don't matter. */
export const looseText = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const containsQuote = (text: string, quote: string) => looseText(quote).length > 0 && looseText(text).includes(looseText(quote));

/** A title "matches" when one contains the other once loosened, so "Release v2 · org/repo" matches "Release v2". */
export function titleMatches(pageTitle: string | null, title: string) {
  if (!pageTitle) return false;
  const a = looseText(pageTitle);
  const b = looseText(title);
  return a.includes(b) || b.includes(a);
}
