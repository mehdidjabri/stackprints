# Hot right now

The cards under the tagline on the home page show what people on X talk about the most right now, in two rows: **Stacks**, the agent products (OpenClaw, Claude Code, Poke…), and **Layers**, the components agents are built from (a model, a sandbox, a memory service…). They come from `content/hot.json`, which a research agent rewrites. The same list is published at `/api/hot.json`, in the home page's markdown twin and as the `get_hot` WebMCP tool.

## Format

```json
{
  "updated": "2026-10-22",
  "from": "2026-10-15",
  "stacks": [
    {
      "stack": "openclaw",
      "why": "New beta ships nodes for phones; demo clips of it running a house spread all week.",
      "since": "2026-10-18",
      "sources": [
        { "title": "@someone: first words of the post", "url": "https://x.com/someone/status/123", "date": "2026-10-18" },
        { "title": "Release notes", "url": "https://github.com/…/releases/tag/…", "date": "2026-10-18" }
      ]
    }
  ],
  "options": [
    { "option": "model/claude-opus-5-5", "why": "Released Oct 20; side-by-side coding demos and benchmark threads all week.", "since": "2026-10-20", "sources": [ … ] }
  ]
}
```

- Each row is in rank order, most talked about first, with at most 6 items. A quiet week can have fewer; never pad a row.
- `stacks` name a stack by slug; `options` name a component as `layer/id`. An agent product people use goes in `stacks`, a part others build with goes in `options`.
- Every card links to a page on the site, so a hot product with no page gets one first (a stack or an option, following [RESEARCH.md](RESEARCH.md)), in the same change.
- `why` is one plain sentence, at most 120 characters: what happened and why people are talking. No hype words.
- `since` is when the conversation started: the launch, release or post behind it.
- `sources` are 1 to 4 pages you opened, each dated, at least one inside the window. Put an x.com post first when there is one, then the official announcement, then the strongest coverage.
- `updated` is the day the list was checked. `from` is the start of the window, 7 days earlier.

The checks enforce all of this (`validate_changeset` on the admin MCP, `npm run check` in a local checkout), and warn when the list is more than 3 days old.

## What counts

- **In scope:** AI agent products and the parts agents are built from: models, agent apps, coding agents, harnesses and frameworks, and agent infrastructure (sandboxes, memory, browsers, gateways…). Out of scope: image and video generators agents don't use, people, policy news, and companies with no product.
- **The measure is X.** Rank by how much the product was discussed on X in the window: posts with real engagement, notable accounts talking about it, quote and reply volume. Confirm with at least one other signal: press coverage, Hacker News points, GitHub stars, Reddit threads, Product Hunt.
- **A vendor talking about itself is not conversation.** A launch tweet with no wider pickup doesn't make the list.
- **Neutral.** No paid placement. A product the maintainers make (one with an `affiliation`) appears only when the evidence ranks it, like anything else, and its card says "affiliated".

## Run

A run goes through the admin MCP server ([MCP.md](MCP.md#the-hot-list-loop)), twice a day. You never edit `content/hot.json`, run `npm run check` or commit: the tools do each step, with the same checks.

1. **`whoami`.** Check the scopes (`content:write` to propose, `content:publish` to publish straight to `main`) and use its `today` for every date.
2. **`get_hot_list`.** What is listed now, how old it is, and its `version`.
3. **`get_research_rules`.** This file as it is on `main`, with RESEARCH.md for any page you add.
4. **Sweep.** Look for candidates from the last 7 days in several places at once: `search_x` for the conversation on X itself (posts with their engagement, ranked by it), web search for tech press and newsletters, Hacker News (the Algolia API, by points), GitHub trending and Product Hunt, Reddit, and the site's own news from the window.
5. **Rank.** Merge duplicates, drop anything out of scope or older than the window, and rank by conversation on X, with the other signals as corroboration.
6. **Verify.** For each candidate, read every source you will cite: posts on X through `search_x`, everything else through `fetch_source`, all within 48 hours of proposing, even pages the content already cites. Keep only sources dated in the window and about the product. Separately, try to show it was *not* among the most-discussed products on X that week; cut it if you can.
7. **`open_changeset`** with kind `hot`.
8. **Map.** Put each survivor in its row: agent products as stacks, components as options. A product with no page gets one first, in the same changeset: `check_duplicate`, then `propose_stack` or `propose_option_create`, following RESEARCH.md.
9. **`propose_hot_list`** with both rows in full, in rank order, and the `version` from step 2 as `expectedVersion`. A post's source title credits its own author, as its receipt names them: `@author: its first words`. The server sets `updated` and `from`.
10. **`validate_changeset`**, fixing every error with another `propose_*` call, then **`submit_changeset`** with the message `hot: YYYY-MM-DD`.

### Without the MCP

In a local checkout: sweep, rank, verify and map as above with your own search and browsing tools, write `content/hot.json` by hand (`updated` today, `from` 7 days earlier), run `npm run check && npm run build`, and commit as `hot: YYYY-MM-DD`. The local admin server (`mcp/dist/admin.mjs`, see [mcp/README.md](../mcp/README.md#9-the-local-servers-on-this-machine)) runs the MCP procedure against the checkout instead.

## Reading X

X shows little to logged-out readers, so how the agent sees it matters most for this list:

- **The X API** (recent search over the last 7 days, with public metrics such as likes, reposts, quotes and views) is the reliable way to measure conversation. It needs a paid API tier; check X's current pricing. The key stays in the admin Worker, behind `search_x`, which also gives every post it returns a receipt so it can be cited.
- **Without the API**, `search_x` says so. The agent finds x.com posts through web search, reads each with `fetch_source` (which reads posts through a public mirror), and judges the conversation from the posts it can open and from coverage of them. That works for big moments but undercounts smaller ones.
