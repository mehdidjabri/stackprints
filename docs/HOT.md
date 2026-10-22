# Hot right now

The cards under the tagline on the home page show the AI agent products people on X talk about the most right now. They come from `content/hot.json`, which a research agent rewrites. The same list is published at `/api/hot.json`, in the home page's markdown twin and as the `get_hot` WebMCP tool.

## Format

```json
{
  "updated": "2026-10-22",
  "from": "2026-10-15",
  "items": [
    {
      "option": "model/claude-opus-5-5",
      "why": "Released Oct 20; side-by-side coding demos and benchmark threads all week.",
      "since": "2026-10-20",
      "sources": [
        { "title": "@someone: first words of the post", "url": "https://x.com/someone/status/123", "date": "2026-10-20" },
        { "title": "Announcement title", "url": "https://vendor.com/news/launch", "date": "2026-10-20" }
      ]
    },
    { "stack": "poke", "why": "…", "since": "2026-10-18", "sources": [ … ] }
  ]
}
```

- `items` are in rank order, most talked about first: 1 to 8 of them. A quiet week can have fewer; never pad the list.
- Each item names exactly one page: `option` as `layer/id`, or `stack` as a slug. Every card links to a page on the site, so a hot product with no page gets one first (an option or a stack, following [RESEARCH.md](RESEARCH.md)), in the same change.
- `why` is one plain sentence, at most 120 characters: what happened and why people are talking. No hype words.
- `since` is when the conversation started: the launch, release or post behind it.
- `sources` are 1 to 4 pages you opened, each dated, at least one inside the window. Put an x.com post first when there is one, then the official announcement, then the strongest coverage.
- `updated` is the day the list was checked. `from` is the start of the window, 7 days earlier.

`npm run check` enforces all of this, and warns when the list is more than 3 days old.

## What counts

- **In scope:** AI agent products and the parts agents are built from: models, agent apps, coding agents, harnesses and frameworks, and agent infrastructure (sandboxes, memory, browsers, gateways…). Out of scope: image and video generators agents don't use, people, policy news, and companies with no product.
- **The measure is X.** Rank by how much the product was discussed on X in the window: posts with real engagement, notable accounts talking about it, quote and reply volume. Confirm with at least one other signal: press coverage, Hacker News points, GitHub stars, Reddit threads, Product Hunt.
- **A vendor talking about itself is not conversation.** A launch tweet with no wider pickup doesn't make the list.
- **Neutral.** No paid placement. A product the maintainers make (one with an `affiliation`) appears only when the evidence ranks it, like anything else, and its card says "affiliated".

## Run

Until the admin MCP exists, this runs as a Claude Code task in this repo.

1. **Sweep.** Look for candidates from the last 7 days in several places at once: X itself (posts and replies from the accounts that drive AI conversation), tech press and newsletters, Hacker News (the Algolia API, by points), GitHub trending and Product Hunt, Reddit, and the site's own `content/news` from the window.
2. **Rank.** Merge duplicates, drop anything out of scope or older than the window, and rank by conversation on X, with the other signals as corroboration.
3. **Verify.** For each candidate, open every source and keep only those dated in the window and about the product. Separately, try to show it was *not* among the most-discussed products on X that week; cut it if you can.
4. **Map.** Point each survivor at its option or stack. Add a page for any that has none.
5. **Write** `content/hot.json`, then run `npm run check && npm run build`.
6. **Commit** as `hot: YYYY-MM-DD`.

## With the admin MCP

The agent reads the current list with `get_hot_list`, searches X with `search_x`, fetches every other source through `fetch_source` for a receipt, and writes with `propose_hot_list`. See [MCP.md](MCP.md#the-hot-list). The target cadence is twice a day.

## Reading X

X shows little to logged-out readers, so how the agent sees it matters most for this list:

- **The X API** (recent search over the last 7 days, with public metrics such as likes, reposts, quotes and views) is the reliable way to measure conversation. It needs a paid API tier; check X's current pricing. With the admin MCP, the key stays in the admin Worker behind `search_x`.
- **Without the API**, the agent finds x.com posts through web search and judges the conversation from the posts it can open and from coverage of them. That works for big moments but undercounts smaller ones.
