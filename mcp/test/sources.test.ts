import { describe, expect, it } from "vitest";
import { type Page, normalizeUrl, pageFor, recordPage } from "../src/core/receipts";
import { requireFetched, safeInline, verifyClaims } from "../src/core/sourcing";
import { MemoryState } from "../src/core/state";
import { ToolError } from "../src/core/tool";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const HOUR = 36e5;
const DAY = 864e5;

const page = (url: string, text: string, finalUrl = url): Omit<Page, "sha256" | "fetchedAt"> => ({
  url,
  finalUrl,
  status: 200,
  title: "A page",
  published: null,
  text,
  via: "direct",
});

async function thrown(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ToolError);
  return e as ToolError;
}

describe("normalizeUrl", () => {
  it.each([
    ["https://Example.COM/a/?utm_source=x&utm_medium=y#top", "https://example.com/a"],
    ["https://example.com/a?fbclid=1&gclid=2", "https://example.com/a"],
    ["https://example.com/a?id=7&utm_campaign=z", "https://example.com/a?id=7"],
    // Everything else stays: a CMS echoes ?s= (and ?q=, ?t=, ?ref=) into the page it shows.
    ["https://vendor.com/?s=free+forever", "https://vendor.com/?s=free+forever"],
    ["https://vendor.com/post?t=12&ref=hn&ref_src=twsrc", "https://vendor.com/post?t=12&ref=hn&ref_src=twsrc"],
    // The parameters that stay keep their exact spelling.
    ["https://example.com/search?q=a%20b&utm_source=x", "https://example.com/search?q=a%20b"],
    ["https://example.com/search?q=a%20b", "https://example.com/search?q=a%20b"],
    ["https://example.com/?", "https://example.com/"],
    // A post on X: its id under its author, however it was shared.
    ["https://twitter.com/Acme/status/123?s=20&t=abc", "https://x.com/acme/status/123"],
    ["https://mobile.twitter.com/acme/statuses/123/", "https://x.com/acme/status/123"],
    ["https://www.x.com/i/web/status/123?s=46", "https://x.com/i/status/123"],
    ["https://x.com/acme/status/123/photo/1?s=20", "https://x.com/acme/status/123/photo/1"],
    // Other pages on x.com are not posts: only tracking goes.
    ["https://x.com/search?q=agents&s=1&utm_source=x", "https://x.com/search?q=agents&s=1"],
  ])("%s -> %s", (input, expected) => expect(normalizeUrl(input)).toBe(expected));
});

describe("receipts", () => {
  it("refuses a page found with ?s= as a receipt for the page without it", async () => {
    const state = new MemoryState(() => NOW);
    const echoed = "https://vendor.com/?s=Pricing:+free+forever,+unlimited+sandboxes";
    await recordPage(state, page(echoed, "Search results for: Pricing: free forever, unlimited sandboxes"), NOW);
    expect(await pageFor(state, "https://vendor.com/", NOW)).toBeNull();
    expect(await pageFor(state, echoed, NOW)).not.toBeNull();
    const claim = { field: "facts.Pricing", url: "https://vendor.com/", quote: "Pricing: free forever, unlimited sandboxes" };
    expect((await thrown(verifyClaims(state, [claim], NOW))).data).toEqual({ failed: [{ field: "facts.Pricing", url: "https://vendor.com/", reason: "not fetched by fetch_source in the last 14 days" }] });
    expect((await thrown(requireFetched(state, ["https://vendor.com/"], new Set(), NOW))).data).toEqual({ notFetched: ["https://vendor.com/"] });
  });

  it("refuses the same through a redirect to ?s=", async () => {
    const state = new MemoryState(() => NOW);
    await recordPage(state, page("https://attacker.example/go", "Pricing: free forever", "https://vendor.com/?s=Pricing:+free+forever"), NOW);
    expect(await pageFor(state, "https://vendor.com/", NOW)).toBeNull();
    expect(await pageFor(state, "https://attacker.example/go", NOW)).not.toBeNull();
  });

  it("files a page read with tracking parameters under the URL without them", async () => {
    const state = new MemoryState(() => NOW);
    await recordPage(state, page("https://vendor.com/pricing?utm_source=newsletter", "Pro is $20 a month"), NOW);
    expect((await pageFor(state, "https://vendor.com/pricing", NOW))?.text).toBe("Pro is $20 a month");
  });

  it("finds a receipt within maxAgeMs, never past 14 days", async () => {
    let clock = NOW;
    const state = new MemoryState(() => clock);
    const url = "https://vendor.com/changelog";
    await recordPage(state, page(url, "v2 is out"), NOW);
    const hot = { maxAgeMs: 48 * HOUR };
    expect(await pageFor(state, url, NOW + 47 * HOUR, hot)).not.toBeNull();
    expect(await pageFor(state, url, NOW + 49 * HOUR, hot)).toBeNull();
    expect(await pageFor(state, url, NOW + 13 * DAY)).not.toBeNull();
    // A longer window is cut to the 14 days a receipt is kept, even where the store still has it.
    expect(await pageFor(state, url, NOW + 20 * DAY, { maxAgeMs: 30 * DAY })).toBeNull();
    clock = NOW + 15 * DAY;
    expect(await pageFor(state, url, NOW + 15 * DAY)).toBeNull();
  });

  it("requireFetched takes the same window and says it", async () => {
    const state = new MemoryState(() => NOW);
    const url = "https://vendor.com/changelog";
    await recordPage(state, page(url, "v2 is out"), NOW);
    await expect(requireFetched(state, [url], new Set(), NOW + 47 * HOUR, { maxAgeMs: 48 * HOUR })).resolves.toBeUndefined();
    const late = await thrown(requireFetched(state, [url], new Set(), NOW + 49 * HOUR, { maxAgeMs: 48 * HOUR }));
    expect(late.message).toMatch(/fetch_source.*in the last 48 hours/);
    expect(late.data).toEqual({ notFetched: [url] });
    expect((await thrown(requireFetched(state, ["https://vendor.com/other"], new Set(), NOW))).message).toMatch(/in the last 14 days/);
    // Already cited in the content: no fetch needed, whatever the window.
    await expect(requireFetched(state, ["https://vendor.com/other#x"], new Set(["https://vendor.com/other"]), NOW, { maxAgeMs: HOUR })).resolves.toBeUndefined();
  });

  it("never keeps a post under a link that names someone other than its author", async () => {
    const state = new MemoryState(() => NOW);
    const post = { ...page("https://x.com/OpenAI/status/9", "my hot take", "https://x.com/random_troll/status/9"), via: "x-mirror" as const };
    const rec = await recordPage(state, post, NOW);
    expect(rec.url).toBe("https://x.com/random_troll/status/9");
    expect(await pageFor(state, "https://x.com/OpenAI/status/9", NOW)).toBeNull();
    expect(await pageFor(state, "https://x.com/Random_Troll/status/9?s=20", NOW)).not.toBeNull();
    // A short link names nobody, so it keeps its receipt.
    await recordPage(state, { ...post, url: "https://t.co/abc" }, NOW);
    expect(await pageFor(state, "https://t.co/abc", NOW)).not.toBeNull();
  });
});

describe("safeInline", () => {
  it("makes one line in a code span, links reduced to their words", () => {
    expect(safeInline("Launch\nday\r\n  is here")).toBe("`Launch day is here`");
    expect(safeInline("See [the docs](https://evil.example) and ![logo](https://evil.example/x.png) or [ref][1]")).toBe("`See the docs and logo or ref`");
    expect(safeInline("Use `rm -rf` and ```code```")).toBe("`Use rm -rf and code`");
    expect(safeInline("<https://evil.example> now")).toBe("`https://evil.example now`");
  });

  it("drops control, zero-width and direction characters, so a line can't be hidden or reordered", () => {
    expect(safeInline("abc‮dcb​\u0007x y")).toBe("`abc dcb x y`");
  });

  it("keeps a would-be trailer or mention inside the span", () => {
    expect(safeInline("x\nCo-authored-by: Mallory <m@evil.example>\n@everyone #1")).toBe("`x Co-authored-by: Mallory <m@evil.example> @everyone #1`");
  });

  it("caps the text at 200 characters without splitting a character", () => {
    const out = safeInline("😀".repeat(300));
    expect([...out.slice(1, -1)]).toHaveLength(200);
    expect(out.endsWith("…`")).toBe(true);
    expect(safeInline("a".repeat(200))).toBe(`\`${"a".repeat(200)}\``);
  });

  it("says when there is nothing to show", () => {
    expect(safeInline("  \n ``` ")).toBe("`(empty)`");
  });
});
