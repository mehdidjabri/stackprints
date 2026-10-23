// Posts on X: recent search through the X API v2 (search_x), and the receipts that let a post it
// found be cited, since fetch_source can't open x.com itself.
import type { AdminDeps, XPost } from "./deps";
import { type Page, recordPage } from "./receipts";
import type { StateStore } from "./state";
import { ToolError } from "./tool";

const SEARCH = "https://api.x.com/2/tweets/search/recent";
const DAY = 864e5;

/** "@user: the first 100 characters of the post", the title a post's receipt carries. */
export const postTitle = (author: string, text: string) => `${author}: ${[...text.replace(/\s+/g, " ").trim()].slice(0, 100).join("")}`;

/** A post's author and counts as kept on its receipt, without the ones nobody reported. */
export function postMeta(author: string, followers: number | undefined, metrics: XPost["metrics"]): Record<string, unknown> {
  const all: Record<string, unknown> = { author, followers, ...metrics };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
}

type ApiUser = { id: string; username: string; name?: string; public_metrics?: { followers_count?: number } };
type ApiPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number; impression_count?: number; bookmark_count?: number };
};
type SearchResponse = { data?: ApiPost[]; includes?: { users?: ApiUser[] } };

const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** The X API takes seconds, not milliseconds. */
const isoSeconds = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

export function searchUrl(q: { query: string; maxResults: number; sinceDays: number }, now: number) {
  const query = /\bis:retweet\b/i.test(q.query) ? q.query : `${q.query.trim()} -is:retweet`;
  const days = clamp(q.sinceDays, 1 / 24, 7, 7);
  // Recent search refuses a start_time older than 7 days, and a request takes a moment to arrive.
  const start = now - days * DAY + (days === 7 ? 60_000 : 0);
  const url = new URL(SEARCH);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.round(clamp(q.maxResults, 10, 100, 10))));
  url.searchParams.set("start_time", isoSeconds(start));
  url.searchParams.set("tweet.fields", "created_at,public_metrics,author_id,lang");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name,public_metrics");
  return url.toString();
}

async function apiError(res: Response, now: number) {
  const body = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
  const data = { status: res.status, ...(body?.detail || body?.title ? { detail: body.detail ?? body.title } : {}) };
  if (res.status === 401) return new ToolError("The X API rejected the bearer token (401): it is invalid or was revoked. search_x needs a working X API key.", data);
  if (res.status === 403)
    return new ToolError("The X API refused the search (403): this key's plan has no access to recent search. Look for posts with web search instead.", data);
  if (res.status === 429) {
    const reset = Number(res.headers.get("x-rate-limit-reset"));
    const when = Number.isFinite(reset) && reset > 0 ? ` It resets at ${new Date(reset * 1000).toISOString()} (in about ${Math.max(1, Math.ceil((reset * 1000 - now) / 60_000))} min).` : "";
    return new ToolError(`The X API rate limit is used up (429).${when} Wait ${when ? "until then" : "a few minutes"}, or look for posts with web search meanwhile.`, {
      ...data,
      ...(when ? { resetsAt: new Date(reset * 1000).toISOString() } : {}),
    });
  }
  if (res.status === 400) return new ToolError("The X API refused the query (400): check the search syntax.", data);
  return new ToolError(`The X API answered HTTP ${res.status}. Try again later.`, data);
}

export function toPosts(body: SearchResponse): XPost[] {
  const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u]));
  const posts = (body.data ?? []).map((p): XPost => {
    const user = p.author_id ? users.get(p.author_id) : undefined;
    const m = p.public_metrics ?? {};
    const metrics = Object.fromEntries(
      Object.entries({ likes: m.like_count, reposts: m.retweet_count, replies: m.reply_count, quotes: m.quote_count, views: m.impression_count, bookmarks: m.bookmark_count }).filter(([, v]) => typeof v === "number"),
    ) as XPost["metrics"];
    const followers = user?.public_metrics?.followers_count;
    return {
      url: user ? `https://x.com/${user.username}/status/${p.id}` : `https://x.com/i/status/${p.id}`,
      author: user ? `@${user.username}` : `@${p.author_id ?? "unknown"}`,
      text: p.text,
      date: (p.created_at ?? "").slice(0, 10),
      metrics,
      ...(typeof followers === "number" ? { authorFollowers: followers } : {}),
    };
  });
  const reach = (p: XPost) => (p.metrics.likes ?? 0) + (p.metrics.reposts ?? 0) + (p.metrics.quotes ?? 0);
  return posts.sort((a, b) => reach(b) - reach(a));
}

/** Recent posts (the last 7 days at most) matching an X search query, most liked, reposted and quoted first. */
export function createSearchX(opts: { fetch: typeof fetch; bearer: string; now?: () => number }): NonNullable<AdminDeps["searchX"]> {
  // Kept unbound: Workers refuse a fetch called with another object as `this`.
  const get = opts.fetch;
  const now = opts.now ?? Date.now;
  return async (q) => {
    let res: Response;
    try {
      res = await get(searchUrl(q, now()), { headers: { authorization: `Bearer ${opts.bearer}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ToolError(`Couldn't reach the X API: ${(e as Error).message}. Try again later.`);
    }
    if (!res.ok) throw await apiError(res, now());
    return toPosts((await res.json()) as SearchResponse);
  };
}

/** Gives every post a 14-day receipt, as if fetch_source had read it, so it can be cited. */
export async function recordXPosts(state: StateStore, posts: XPost[], now: number): Promise<Page[]> {
  return Promise.all(
    posts.map((p) =>
      recordPage(
        state,
        { url: p.url, finalUrl: p.url, status: 200, title: postTitle(p.author, p.text), published: p.date || null, text: p.text, via: "x-api", meta: postMeta(p.author, p.authorFollowers, p.metrics) },
        now,
      ),
    ),
  );
}
