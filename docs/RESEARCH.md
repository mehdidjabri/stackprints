# Research brief for options

This is how an option file in `content/options/<layer>/<id>.json` is researched and how its news is kept fresh. Humans and agents both follow it.

## Hard rules

1. **Never invent anything.** Every fact, date, price and URL must come from a page you actually opened or a search result you can cite. If you can't verify something, leave the field out. Missing data is fine; wrong data is not.
2. **Never change** `id`, `order`, `logo` or `name`. Change `url` or `note` only if they are wrong; a note stays under 60 characters.
3. **Stay neutral.** Write descriptions, not marketing. Avoid words like "best", "leading", "revolutionary" or "seamless".
4. **Mark vendor claims.** A benchmark or number the vendor publishes about itself is written as "vendor-reported", for example `["LongMemEval", "92% (vendor-reported)"]`.
5. Write **valid JSON** with 2-space indentation and a trailing newline. Run `npm run check` before you finish.

## Profiles

Each option gets a `profile`, which decides the layout of its page.

| profile | use for | extra fields |
| --- | --- | --- |
| `model` | an LLM or model family | `model` |
| `product` | a company's product, a service or an open-source project | none required |
| `protocol` | an open standard or spec (MCP, A2A, AGENTS.md, x402, llms.txt…) | none required |
| `pattern` | a technique or design choice with no vendor (Heartbeat, MEMORY.md, Subagents, YOLO, Host machine…) | `how` |

## Fields to add

```jsonc
{
  // existing: order, id, name, url, note, logo, open (unchanged)
  "profile": "product",
  "summary": "Two or three neutral sentences: what it is, how it works, who it's for.",
  "facts": [                        // 4–8 datasheet rows, verified only, most useful first
    ["Company", "E2B (San Francisco)"],
    ["License", "Apache-2.0"],
    ["Isolation", "Firecracker microVMs"],
    ["Pricing", "Usage-based, free tier"]
  ],
  "links": {                        // full https URLs, only ones you checked
    "site": "https://e2b.dev",
    "docs": "https://e2b.dev/docs",
    "repo": "https://github.com/e2b-dev/E2B",
    "pricing": "https://e2b.dev/pricing",
    "changelog": "https://…",
    "x": "https://x.com/…"
  },
  "goodFor": ["Short phrase", "Short phrase"],       // at most 3
  "watchOut": ["Short honest caveat"],               // at most 3
  "researched": "2026-10-21"
}
```

**Model**, all fields optional and verified:

```jsonc
"model": {
  "lab": "Anthropic",
  "released": "2026-09-22",
  "context": "1M tokens",
  "priceIn": "$4 / 1M tokens",
  "priceOut": "$20 / 1M tokens",
  "modalities": ["text", "image"],
  "weights": "closed",           // or "open"
  "openrouter": "anthropic/claude-opus-5.5"
}
```

OpenRouter's model API (`https://openrouter.ai/api/v1/models`, no key needed) is a good source for context and price.

**Pattern:**

```jsonc
"how": ["Step one in one line", "Step two", "Step three"],   // 3–5 steps
"facts": [["Used by", "OpenClaw, Hermes Agent"], ["Trade-off", "Simple but grows without bound"]]
```

Patterns need no news and need no `links` unless there is a canonical write-up.

**Good datasheet rows by layer** (choose what applies):
- **Routers:** models available, pricing model (markup or not), BYOK, self-hostable.
- **Harnesses:** language, license, stars or adoption, MCP support, memory, subagents, sandboxing.
- **Memory and retrieval:** storage model (vector, graph, files), hosted or self-hosted, benchmarks (marked vendor-reported).
- **Sandboxes and browser use:** isolation technology, cold start, persistence, pricing.
- **Channels:** official or unofficial API, cost, approval required.
- **Observability:** open source, self-hostable, OpenTelemetry support.
- **Payments and identity:** standards supported, who issues credentials.

## News

News lives apart from the option, in `content/news/<layer>/<id>.json`, so refreshing it never touches the option file:

```json
{
  "updated": "2026-10-21",
  "items": [
    { "date": "2026-10-14", "title": "Headline as published", "url": "https://…", "source": "techcrunch.com" }
  ]
}
```

- At most 5 items, newest first, from the last 12 months only.
- Use real articles, official blog posts, changelogs or release notes. No SEO spam, no aggregators when the original exists, and no social posts unless they are the primary announcement.
- Only include a URL you saw in search results or opened. Prefer the original source.
- If you find nothing, write `"items": []` with today's date. That records that the option was checked.
- Products, models and protocols get a news file; patterns don't.

## Refreshing news

See [NEWS.md](NEWS.md).
