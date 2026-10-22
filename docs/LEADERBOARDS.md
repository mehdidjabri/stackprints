# Leaderboards: proposal

Status: proposal, October 2026. Nothing here is built yet.

## What we learned from the best leaderboards

- **OpenRouter rankings** work because they show revealed preference: tokens people actually pay for, not opinions. Every chart is dated ("data through …"), there are day/week/month windows, open vs closed share, and cross-links (model ↔ the apps that use it). The data is an open CC BY 4.0 API.
- **Ora's agent-readiness leaderboard** works because the score is fully automated against public URLs, with no self-reporting. It has a public check catalog, layer weights, letter grades (A+ to F) and a scan date on every row. Anyone can trigger a rescan, so vendors compete to fix their grade.
- **Artificial Analysis and LMArena** earn trust with a versioned methodology, sample sizes and confidence intervals. **Product Hunt and GitHub trending** bring people back with dated URLs and "today / this week" views. **npmtrends** gets search traffic from `x-vs-y` pages.

## Rules for every board

1. **Separate the axes, never blend them.** Show Adoption (what people use), Momentum (how fast that changes) and Quality (measured: benchmarks, readiness checks) side by side. Don't merge them into one opaque number.
2. **Every number has a source, a date and a sample size.** Each figure links to where it came from and when it was fetched. Each board shows `n`, its snapshot date and a link to the methodology.
3. **No score without data.** Where no good public signal exists (channels, persona, payments, hosting, guardrails…), show "used in N stacks by M authors", not a rank.
4. **Self-reported benchmarks are shown but never counted.** Memory benchmarks are the clearest case: vendors publish conflicting numbers on the same test, and no independent leaderboard exists. They get a "vendor-reported" badge and weight 0.
5. **Costly signals beat cheap ones.** Paid tokens, downloads and dependents count for more than GitHub stars. Stars can be bought, so star spikes with no matching fork or contributor growth get flagged and frozen.
6. **Count authors, not stacks.** A vendor publishing ten stacks with its own product counts once. An option's own maintainers don't count toward it.
7. **Never sponsored.** Rankings can't be bought, and the page says so.

## Signals by layer

| Layer | Adoption | Quality |
| --- | --- | --- |
| Model | OpenRouter token share, Hugging Face downloads (open weights) | Artificial Analysis index, SWE-bench, Terminal-Bench, price per quality |
| Router, inference host | GitHub and package downloads (open source), OpenRouter provider share | Artificial Analysis speed, time-to-first-token, price; incident-minutes from status pages |
| Harness | OpenRouter app token share, npm/PyPI CLI downloads, GitHub momentum | Terminal-Bench (it records the harness), SWE-bench |
| Memory, retrieval, sandbox, durable, observability, multi-agent, tools | GitHub contributors and commits, npm/PyPI/Docker downloads | Independent benchmarks only; MTEB for embedders |
| Browser use | GitHub, downloads | OSWorld-Verified, official WebArena entries |
| Voice | Downloads, Artificial Analysis TTS/STT arena | Latency, price |
| Connectors | Smithery usage (check its terms), GitHub | — |
| Agent readiness | — | Our own crawl, Ora-style grade |
| Channels, interface, devices, persona, proactivity, payments, hosting, state, guardrails | Used in N stacks / M authors | None; no rank |

**Scoring.** Log-scale the counts, then rank each option as a percentile within its layer. Weights live in `content/signals/weights.json` and change only by pull request. An option is "Unranked" when it has less than half the signals, and a layer needs at least 5 options before it is ranked. Each option shows High / Medium / Low confidence. A signal that is out of date has its weight halved and is labelled "stale".

## Pipeline, still fully static

A nightly GitHub Action runs one job per source. Each job writes `content/signals/raw/<source>.json` and fails softly, keeping the last good value. A compute job then scores everything into `content/signals/latest/<option>.json` and appends history to `content/signals/history/<YYYY-MM>.jsonl` (about 30 MB a year). It opens a bot pull request, and merging that rebuilds the site.

Each option file gets identifiers so the job knows what to fetch:

```json
"signals": { "github": "e2b-dev/E2B", "npm": ["@e2b/sdk"], "pypi": ["e2b"], "hf": null, "openrouter": null, "statuspage": "https://status.e2b.dev" }
```

Each number is stored as `{ value, unit, source, url, fetched_at, license, status, flags }`. OpenRouter and Artificial Analysis figures carry their required attribution.

## Boards

**Phase 1** (data we have, or can fetch for free):

1. **Best {layer} for AI agents** at `/leaderboard/<layer>/`: 27 pages that stay useful over time. The board is shown as a heat map, where a chip's brightness is its share, with silkscreen ranks R1–R10, Adoption / Momentum / Quality columns and confidence badges.
2. **Default Stack of 2026** at `/leaderboard/default-stack/`: the most common pick in every layer, lit up on one motherboard, with the runner-up as a ghost outline. It also says that no single real stack may actually contain all of them. Monthly archive pages.
3. **Agent readiness of the vendors themselves** at `/leaderboard/agent-readiness/`: our own nightly crawl for llms.txt, an MCP endpoint, OpenAPI, markdown docs, rules for AI crawlers and machine-readable pricing. The rubric is public, results are A–F grades stamped on the chips, and vendors can ask for a rescan.
4. **Movers** at `/leaderboard/movers/2026-w43/`: weekly ▲▼ rank changes, only for options whose signals were stable. A newly added signal can't create a fake jump.
5. **Compare and pairs** at `/compare/mem0-vs-zep/` and `/option/pi/pairs/`: head-to-head spec sheets, and "what goes with Pi?" from how often options appear in the same stack. Only pairs above a minimum adoption level get a page.

**Phase 2:** benchmark boards (independent results only, each tagged with its date and source), a price × speed frontier for models, inference and sandboxes, an open vs closed share per layer, how settled each layer is (a diversity index), the most-remixed stacks, retention, and rising new vendors.

## Information architecture

```
/leaderboard/                         hub: default stack, movers strip, layer grid
/leaderboard/<layer>/                 canonical; "Best <layer> for AI agents (Oct 2026)"
/leaderboard/<layer>/benchmarks/
/leaderboard/default-stack/[YYYY-MM/]
/leaderboard/movers/[YYYY-wWW/]
/leaderboard/agent-readiness/
/leaderboard/methodology/             versioned, with a changelog
/compare/<a>-vs-<b>/                  alphabetical order is canonical
/data/leaderboards/*.json             CC BY, like OpenRouter
```

## Open questions

- Confirm the terms of use for Smithery, Glama and Ora before republishing their numbers. Our own readiness crawl avoids depending on Ora.
- Confirm the Artificial Analysis and OpenRouter Data API endpoints and limits.
- Our own "used in stacks" data is tiny at launch: 21 presets, most of them picked by the maintainers. Until real authors publish stacks, presets are shown separately and don't count toward rankings.
