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
- `date` is the article's original publish date (the byline date, or `datePublished` / `article:published_time` in the page metadata). Never use an 'Updated on' date or the day you found it.
- Use real articles, official blog posts, changelogs or release notes. No SEO spam, no aggregators when the original exists, and no social posts unless they are the primary announcement.
- Only include a URL you saw in search results or opened. Prefer the original source.
- If you find nothing, write `"items": []` with today's date. That records that the option was checked.
- Products, models and protocols get a news file; patterns don't.

## Refreshing news

See [NEWS.md](NEWS.md).

## Researching a stack

A stack (`content/stacks/<slug>.json`) claims how a real product or project is built, so every pick needs a source. When a closed product doesn't say, the honest answer is "not disclosed", and the board shows that.

### Disclosure

Set `disclosure`. It decides what an **empty** slot means:

| value | use for | an empty slot reads |
| --- | --- | --- |
| `open-source` | the code is public (OpenClaw, Pi, Hermes Agent…) | not used (you can check the code) |
| `documented` | closed, but the vendor documents its architecture in depth (e.g. Claude Code) | not documented |
| `closed` | closed product; only announcements and press | not disclosed |
| `example` | an illustrative stack we designed, not a real product | not used |

### Fields

```jsonc
{
  "disclosure": "closed",
  "sources": [
    { "title": "Introducing dots (OpenAI)", "url": "https://openai.com/index/introducing-dots/" }
  ],
  "layers": { "channels": ["slack", "microsoft-teams"], "model": "gpt-6-astra" },
  "evidence": {                       // for every picked layer: the source URL(s) that back it up
    "channels": ["https://openai.com/index/introducing-dots/"],
    "model": ["https://help.openai.com/en/articles/20001530-getting-started-with-your-dot"]
  },
  "notUsed": ["voice"],               // only layers a source confirms are absent
  "researched": "2026-10-21"
}
```

### Rules

1. **Every pick needs evidence**: a URL you opened or saw in search results, preferably first-party (docs, repo, official blog), else reputable press. No evidence means no pick. Remove existing picks you can't back up.
2. **Don't guess.** "It must use some model" is not a reason to pick one. Leave the layer out, and on a closed stack it shows as "not disclosed".
3. For **open-source** stacks the repo is the source. Check the README, docs, config and dependencies. Use `notUsed` only when the docs or code clearly show something is absent (for example "no built-in memory").
4. **Use existing options.** If a documented component has no option yet, add one in `content/options/<layer>/<id>.json` per the rules above. Check it doesn't already exist under another name first.
5. Keep the `description` neutral and say what's public: "OpenAI hasn't published the model routing…" is fine.
6. `npm run check` must pass.
