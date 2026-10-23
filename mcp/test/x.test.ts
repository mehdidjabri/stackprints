import { describe, expect, it } from "vitest";
import type { XPost } from "../src/core/deps";
import { pageFor } from "../src/core/receipts";
import { MemoryState } from "../src/core/state";
import { ToolError } from "../src/core/tool";
import { createSearchX, postTitle, recordXPosts } from "../src/core/x";

const NOW = Date.parse("2026-10-22T12:00:00Z");

const SEARCH = {
  data: [
    { id: "1", text: "Small post about agents", author_id: "u1", created_at: "2026-10-20T08:00:00.000Z", lang: "en", public_metrics: { like_count: 5, retweet_count: 1, reply_count: 0, quote_count: 0, impression_count: 300, bookmark_count: 0 } },
    { id: "2", text: "Big launch thread", author_id: "u2", created_at: "2026-10-21T15:30:00.000Z", lang: "en", public_metrics: { like_count: 4000, retweet_count: 600, reply_count: 210, quote_count: 90, impression_count: 900000, bookmark_count: 700 } },
    { id: "3", text: "Middle one", author_id: "u1", created_at: "2026-10-19T23:59:59.000Z", public_metrics: { like_count: 50, retweet_count: 10, reply_count: 3, quote_count: 2, impression_count: 5000, bookmark_count: 4 } },
  ],
  includes: {
    users: [
      { id: "u1", username: "smallco", name: "Small Co", public_metrics: { followers_count: 800 } },
      { id: "u2", username: "bigco", name: "Big Co", public_metrics: { followers_count: 2500000 } },
    ],
  },
  meta: { result_count: 3 },
};

function fakeApi(response: () => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    return response();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function failure(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ToolError);
  return e as ToolError;
}

describe("search_x", () => {
  it("sends a recent search with the fields, author expansion, bearer and a 7-day window at most", async () => {
    const { fetch, calls } = fakeApi(() => Response.json(SEARCH));
    const search = createSearchX({ fetch, bearer: "test-bearer", now: () => NOW });
    await search({ query: "agents lang:en", maxResults: 500, sinceDays: 30 });
    const { url, init } = calls[0];
    expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets/search/recent");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "agents lang:en -is:retweet",
      max_results: "100",
      start_time: "2026-10-15T12:01:00Z",
      "tweet.fields": "created_at,public_metrics,author_id,lang",
      expansions: "author_id",
      "user.fields": "username,name,public_metrics",
    });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-bearer");

    await search({ query: "from:acme is:retweet", maxResults: 3, sinceDays: 2 });
    expect(calls[1].url.searchParams.get("query")).toBe("from:acme is:retweet");
    expect(calls[1].url.searchParams.get("max_results")).toBe("10");
    expect(calls[1].url.searchParams.get("start_time")).toBe("2026-10-20T12:00:00Z");

    await search({ query: "claude -is:retweet", maxResults: 42, sinceDays: 1 });
    expect(calls[2].url.searchParams.get("query")).toBe("claude -is:retweet");
    expect(calls[2].url.searchParams.get("max_results")).toBe("42");
  });

  it("maps posts with their authors and counts, most engaged first", async () => {
    const { fetch } = fakeApi(() => Response.json(SEARCH));
    const posts = await createSearchX({ fetch, bearer: "b", now: () => NOW })({ query: "agents", maxResults: 10, sinceDays: 7 });
    expect(posts.map((p) => p.url)).toEqual(["https://x.com/bigco/status/2", "https://x.com/smallco/status/3", "https://x.com/smallco/status/1"]);
    expect(posts[0]).toEqual({
      url: "https://x.com/bigco/status/2",
      author: "@bigco",
      text: "Big launch thread",
      date: "2026-10-21",
      metrics: { likes: 4000, reposts: 600, replies: 210, quotes: 90, views: 900000, bookmarks: 700 },
      authorFollowers: 2500000,
    });
  });

  it("returns nothing when nothing matched", async () => {
    const { fetch } = fakeApi(() => Response.json({ meta: { result_count: 0 } }));
    expect(await createSearchX({ fetch, bearer: "b", now: () => NOW })({ query: "zzzz", maxResults: 10, sinceDays: 1 })).toEqual([]);
  });

  it("explains 401, 403, 429 and other statuses", async () => {
    const run = (res: () => Response) => createSearchX({ fetch: fakeApi(res).fetch, bearer: "b", now: () => NOW })({ query: "a", maxResults: 10, sinceDays: 1 });

    const unauthorized = await failure(run(() => Response.json({ title: "Unauthorized", detail: "Unauthorized", status: 401 }, { status: 401 })));
    expect(unauthorized.message).toMatch(/bearer token \(401\).*invalid/);
    expect(unauthorized.data).toEqual({ status: 401, detail: "Unauthorized" });

    expect((await failure(run(() => Response.json({ detail: "client-not-enrolled" }, { status: 403 })))).message).toMatch(/403.*no access to recent search/);

    const reset = Math.floor(NOW / 1000) + 600;
    const limited = await failure(run(() => new Response("{}", { status: 429, headers: { "x-rate-limit-reset": String(reset) } })));
    expect(limited.message).toMatch(/rate limit.*429.*resets at 2026-10-22T12:10:00\.000Z \(in about 10 min\)/);
    expect(limited.data).toMatchObject({ resetsAt: "2026-10-22T12:10:00.000Z" });

    expect((await failure(run(() => new Response("{}", { status: 429 })))).message).toMatch(/\(429\)\. Wait a few minutes/);
    expect((await failure(run(() => new Response("oops", { status: 503 })))).message).toMatch(/HTTP 503/);
    expect((await failure(run(() => Response.json({ title: "Invalid Request" }, { status: 400 })))).message).toMatch(/query \(400\)/);
  });

  it("reports a network failure as a tool error", async () => {
    const fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof globalThis.fetch;
    expect((await failure(createSearchX({ fetch, bearer: "b", now: () => NOW })({ query: "a", maxResults: 10, sinceDays: 1 }))).message).toMatch(/Couldn't reach the X API: connect ECONNREFUSED/);
  });
});

describe("recordXPosts", () => {
  it("gives each post a receipt that pageFor finds, under x.com or twitter.com", async () => {
    const state = new MemoryState(() => NOW);
    const post: XPost = { url: "https://x.com/bigco/status/2", author: "@bigco", text: "Big launch thread", date: "2026-10-21", metrics: { likes: 4000, reposts: 600 }, authorFollowers: 2500000 };
    const pages = await recordXPosts(state, [post], NOW);
    expect(pages).toHaveLength(1);
    const p = await pageFor(state, "https://twitter.com/bigco/status/2?s=20", NOW);
    expect(p).toMatchObject({
      url: "https://x.com/bigco/status/2",
      finalUrl: "https://x.com/bigco/status/2",
      status: 200,
      title: "@bigco: Big launch thread",
      published: "2026-10-21",
      text: "Big launch thread",
      via: "x-api",
      meta: { author: "@bigco", followers: 2500000, likes: 4000, reposts: 600 },
      fetchedAt: "2026-10-22T12:00:00.000Z",
    });
    expect(await pageFor(state, "https://x.com/bigco/status/2", NOW + 15 * 864e5)).toBeNull();
  });

  it("titles a post with its first 100 characters on one line", () => {
    expect(postTitle("@a", `line one\n\n${"y".repeat(200)}`)).toBe(`@a: line one ${"y".repeat(91)}`);
  });
});
