# Stackprints MCP servers: proposal

Status: proposal, 2026-10-22. Nothing here is built yet. Produced by a research and design workflow: four research agents, three independent architectures (static-first, Cloudflare-native, hybrid), two judges (a pragmatic CTO and a trust-and-safety reviewer), and a synthesis. Both judges picked the static-first design; this is that design with the best ideas from the others grafted on.

## Should users have accounts?

No. Do not build Stackprints accounts: no passwords, no email, no profiles, no upvotes, and no website login.

- Reading stays anonymous forever. That covers the site, the static JSON API and every read, graph, plan or validate tool on the public MCP. This keeps the public promises in lib/agent.ts true: "no accounts, no ads, no tracking" (line 183), no cookies (199), and "no API key, no rate-limit tiers" (218). A single fair-use limit that applies to everyone is not a tier, but the Pricing copy needs a one-line note when it ships.
- GitHub is the identity, and only when something writes. In v1 a user's agent calls prepare_stack_submission and gets back the file plus a pre-filled PR link, and the user opens the PR as themselves. The PR author is a GitHub-verified identity and Stackprints stores nothing.
- "Sign in with GitHub" through MCP OAuth comes only if the data shows agents cannot open PRs themselves (phase 4). It would store the numeric GitHub id and login only: no email and no kept GitHub token. A bot opens the PR with a Co-authored-by credit. The PRIVACY, About and Pricing copy change in the same PR that ships it.
- Never add email or magic links: they bring personal data, spam and deliverability work for an audience that already has GitHub. Never add upvotes or profiles: they invite vote fraud and clash with "costly signals beat cheap ones" and "never sponsored". The past.dev affiliation would make any vote-based ranking look self-serving.
- Saved stacks stay where they are today: localStorage, the #s= share links, and the user's agent.
- Vendors who want to correct or claim their page later prove domain ownership (a DNS TXT record or a /.well-known file), the way the MCP Registry and Glama do. That needs no account.
- Admin is not an accounts question. It is an allowlist of GitHub ids (you, plus an optional backup) on a separate server.

## Should everything run on Cloudflare?

Yes, for everything that runs. No for the content store and no for the research reasoning.

ON CLOUDFLARE (one Workers Paid account, $5/month):
- The static site on Workers Static Assets (not Pages). Asset hits are free and unlimited.
- The markdown negotiation that vercel.json describes today, ported to _headers plus about 60 lines of Worker code.
- The public MCP, on the same origin.
- The admin MCP Worker.
- workers-oauth-provider for admin auth. Its README (checked 2026-10-22) confirms MCP auth, CIMD and RFC 9728.
- KV for OAuth grants and the fetch-receipt cache.
- One small D1 database for operational state only: the change queue, link status, the audit log and later submission quotas.
- A daily Cron Trigger for the change detector, the rate-limit binding and the WAF rule.

There is nothing to migrate. stackprints.com does not resolve, github.com/stackprints/stackprints returns 404, and the local repo has no git remote. This is a first choice of host. On Vercel the site's `output: export` cannot serve the MCP route handlers, so it would need a second project, and Hobby forbids commercial use, so Pro at $20 per seat each month. Cloudflare is cheaper and runs everything in one place.

NOT ON CLOUDFLARE:
- Content stays as JSON in a public GitHub repo. The only way to publish is a reviewed, merged PR. The PR history is the audit trail that "never fabricate, every claim sourced" depends on. D1 never holds or renders content.
- Research reasoning stays in your Claude agents (a Claude Code cloud scheduled task, with claude-code-action in GitHub Actions as the fallback). Cloudflare runs no LLM in this design.

NOT USED IN V1: Pages, McpAgent or Durable Object sessions (deprecated), Workflows, Queues, R2, Browser Run, Workers AI or Vectorize, Cloudflare's own Markdown for Agents and WebMCP injection (we ship our own), and "Workers Caching" (it bills static cache hits). Cloudflare Access is deferred; see the admin auth notes.

GOTCHAS:
- Workers Paid is mandatory. On Free, routes matched by run_worker_first return 429 instead of falling back to assets once 100k requests a day is exceeded.
- Lock-in is limited to the negotiation Worker, KV/D1 bindings and the OAuth library. Content, the out/ build and the MCP tool code (standard Request/Response plus the MCP SDK) all port.

## Architecture

THREE PLACES, EACH WITH ONE JOB

1) GITHUB holds the truth. The repo is github.com/stackprints/stackprints (public).
- content/ stays exactly as it is.
- Two new reviewed files:
  - content/plan.json maps capabilities (voice, scheduled_tasks, long_term_memory, computer_use and so on) to layer ids, for plan_stack.
  - ops/watch.json holds manual change-detector overrides: extra RSS feeds and ignore rules.
- A ruleset on main requires a PR, 1 approval, and the "check" Action (`npm run check && npm run build`). Apps get no bypass, so a bot can open PRs but can never publish.
- Two GitHub Apps, each installed on this repo only with contents:write and pull_requests:write:
  - stackprints-bot, used by admin;
  - stackprints-submissions, phase 4 only.
  Both private keys live only in the admin Worker.

2) CLOUDFLARE is the runtime. One Workers Paid account, zone on the Free plan.

Worker "stackprints" (stackprints.com):
- Static Assets from out/ (2,895 files; html_handling auto-trailing-slash; markdown 404).
- _headers carries the static half of vercel.json: content types, CORS on /api/* and /.well-known/*, the Link and X-Robots-Tag headers.
- A small fetch handler runs first on HTML routes only (run_worker_first excludes /_next/*, /api/*, *.md, *.json, *.txt and *.svg). When Accept is text/markdown or the User-Agent matches the AI-bot list, it serves the .md twin through env.ASSETS.fetch. It falls through to HTML when there is no twin, and sends Vary: Accept, User-Agent.
- It also serves /mcp, the public MCP:
  - built with createMcpHandler, stateless, MCP 2026-07-28, still answering the 2025 initialize handshake;
  - imports worker/generated/content.json, the 2.3 MB bundle emitted by the build from the same commit as the site.

Worker "stackprints-admin" (admin.stackprints.com/mcp):
- Its own workers-oauth-provider, with GitHub as the upstream IdP and an allowlist of GitHub ids.
- Bindings: KV (OAUTH_KV plus a 14-day fetch-receipt cache) and D1 "stackprints-ops" (changes, link_status, audit; later quotas and submissions).
- A daily Cron Trigger runs the change detector.
- noindex, no CORS, and never listed in ard.json, ai-catalog.json, llms.txt or any registry.

3) CLAUDE does the research. Your agents run as a Claude Code cloud scheduled task, with the admin MCP as their only connector, following a committed /refresh skill. The fallback is claude-code-action on a GitHub Actions cron.

SHARED CODE, SO NOTHING DRIFTS
- lib/validate.mjs: the scripts/check.mjs rules as pure functions. The CLI, CI, validate_stack and validate_changeset all call it.
- lib/tools.ts: tool names, descriptions and schemas. Both components/WebMcp.tsx and the remote MCP use it, keeping today's names (search_stackprints, list_stacks, get_stack, get_layer, get_option).
- scripts/mcp-bundle.mjs: writes the content bundle with data_version (git SHA plus build date), the search index and the MCP server card.

Every MCP answer carries data_version and the HTML page URL to cite. The site, the static API, the markdown twins, llms.txt, WebMCP and both MCPs all serve main from one build, so they cannot disagree.

DEPLOY AND DISCOVERY
- The check Action runs on every PR. On push to main, Actions (or Workers Builds) runs wrangler deploy for both Workers.
- Bot PRs are on in-repo branches, so they get a Workers preview URL, which is required before merge. Community PRs from forks get the CI check only, because previews would need secrets exposed to forks.
- Public discovery:
  - a server card at /mcp/server-card and /.well-known/mcp/server-card.json;
  - application/mcp-server-card+json entries in ard.json and ai-catalog.json;
  - the server named in llms.txt;
  - the MCP Registry as com.stackprints/stackprints, verified with /.well-known/mcp-registry-auth;
  - Smithery;
  - the Claude Connectors Directory (authless listings are allowed).

AUTH SUMMARY
- Public: anonymous in v1. Phase-4 writes would use lazy OAuth, answering 401 at the HTTP layer before the SDK runs, with a separate audience.
- Admin: OAuth (CIMD on, DCR as fallback, PKCE S256, RFC 9728 metadata) granting only to GitHub ids in ADMIN_GITHUB_IDS. Scopes:
  - content:read and content:propose for scheduled agents;
  - content:manage for close_changeset, granted only to a separate interactive connector entry.
  The library advertises scopes but does not enforce them, so every handler checks ctx.auth.scope and has a unit test for it.
- A hashed static bearer limited to read and propose exists only for the GitHub Actions fallback runner, sent through .mcp.json headers.
- Cloudflare Access with Managed OAuth was rejected for v1 for two reasons: its compatibility with claude.ai custom connectors is unverified, and the docs forbid running our own OAuth server behind it.

## Admin MCP (your agents only)

- **`get_freshness_report`**: the starting call for every run. Returns counts of stale news (older than 7 days), stale options and stacks (researched older than 90 days), open change-detector entries by kind, broken or redirected evidence links, open bot and community PRs, and the last detector run with its failures. (read)
- **`list_stale`**: items oldest first, using the same logic as scripts/news-stale.mjs. Kind is news, option or stack, with older_than_days, layer and limit filters and a cursor. Patterns are skipped for news. (read)
- **`list_changes`**: the change-detector queue from D1. Kinds: release (GitHub releases API), feed_item (RSS/Atom), price_changed (OpenRouter models API, with a suggested patch), link_broken or redirected (weekly link-rot pass), and correction (GitHub issues labelled correction). Each entry names the option or stack and, through the evidence map, the exact facts and stack layers that cite the changed URL. (read)
- **`get_item`**: the exact JSON of one option, news file or stack at main HEAD, with repo path, blob SHA (for optimistic concurrency), last commit date, open PRs touching it and open changes. (read)
- **`get_research_rules`**: the current docs/RESEARCH.md and docs/NEWS.md, also exposed as resources, so every run follows the rules on main rather than a stale prompt. (read)
- **`check_duplicate`**: fuzzy match on name, domain, repo and aliases across all layers. propose_option_create requires a clean result, which enforces RESEARCH.md rule 4. (read)
- **`fetch_source`**: SSRF-safe fetch of an https URL. Private, link-local and metadata ranges are blocked, IP literals and our own hostnames are refused, every redirect is re-checked (at most 5), and size and time are capped. Returns the final URL, status, title or og:title, the published date from page metadata, the page text as markdown wrapped as untrusted data, a sha256 and an HMAC receipt. Writes only its own 14-day KV cache, never content. Annotations: idempotent, not destructive. (read; writes cache only)
- **`validate_changeset`**: dry run. Applies a changeset to the bundle in memory and runs lib/validate.mjs across the whole catalogue plus the sourcing gate: receipts no older than 14 days, quote found on the page, title and date match for news, immutable fields untouched, '(vendor-reported)' present, banned-word lint. Returns errors, warnings and per-claim results. (read)
- **`list_proposals`**: open PRs (bot changesets, community submissions and correction issues) with labels, check status, preview URL, review state and age. (read)
- **`review_pull_request`**: pre-review of any PR. Parses the changed content files, runs the validator, re-fetches every new evidence URL and checks the quotes, flags unlabelled vendor numbers, marketing words and an author.github that does not match. Returns a report for comment_on_pull_request. (read)
- **`get_audit_log`**: append-only D1 rows for every admin tool call: time, GitHub id, client_id, tool, argument hash, result (including refused proposals and failed fetches) and traceparent. (read)
- **`open_changeset`**: starts a unit of work. Creates branch bot/<kind>/<date>-<rand> from main, pins base_sha, returns a changeset_id. Kind is news, option, stack or hot. Many subagents can write to one changeset, because the Worker serialises commits through the Git Data API. (write)
- **`propose_news`**: adds news items {date, title, url, source} for one option. Every URL needs a fetch_source receipt. The title must match the page title or og:title. The date must match datePublished or article:published_time, or it is flagged 'date unverified'. Canonical URLs are deduplicated and aggregator domains denylisted. The server applies the NEWS.md merge rule (5 newest plus everything from the last 30 days, newest first) and sets `updated`. items: [] records 'checked, nothing new'. (write)
- **`propose_option_update`**: field-level patch to one option (facts, model.*, links, summary, goodFor, watchOut, how, sources, evidence, researched). Every changed fact needs claims[] of {field, url, quote <=300 chars, vendor_reported}, with the quote found in a receipted fetch. A claim the server cannot machine-check (PDF, JS-only page, paywall, bot challenge) can be sent with verification:'manual' and a reason; it is flagged at the top of the PR. id, order, logo, name, affiliation and exclusive are rejected. (write)
- **`propose_option_create`**: new product, model or protocol file with profile, summary, facts, links, sources and evidence, under the same claim rules. Requires a clean check_duplicate result and creates the news file alongside. order, logo and affiliation are maintainer-only. (write)
- **`propose_stack`**: create or patch content/stacks/<slug>.json. Disclosure is required. Every pick on a non-example stack, every inUseUndisclosed layer and every supports entry needs receipted evidence, and notUsed only with a source. A version bump is refused unless the picks are re-cited in the same changeset. (write)
- **`get_hot_list`**: the current content/hot.json with each item resolved to its page, its age, and the previous list, so a run can see what moved. (read)
- **`search_x`**: X API v2 recent search (the last 7 days) and post lookup, with public metrics (likes, reposts, quotes, replies, views) and the author's follower count. Every post it returns gets a receipt, so propose_hot_list can cite it even though fetch_source cannot read x.com. The API key is a Worker secret. Capped per run. (read)
- **`propose_hot_list`**: replaces content/hot.json in a hot changeset. At most 8 items in rank order, each naming an existing option or stack, or one created in the same changeset with propose_option_create or propose_stack. `why` is at most 120 characters and passes the word lint. Each item has 1 to 4 sources, each with a receipt under 48 hours old (search_x for x.com posts, fetch_source for the rest), and at least one dated inside the window. The server sets `updated` to today and `from` to 7 days earlier, and runs the same checks as `npm run check`. (write)
- **`dismiss_change`**: closes a detector entry that needs no edit (cosmetic diff, irrelevant release), with a reason, so the same hash does not come back. D1 only, logged. (write)
- **`submit_changeset`**: re-checks base blob SHAs, then stackprints-bot opens the PR. One PR per news run, and one PR per option or stack for fact changes, capped per run. The body is a generated table: field, old and new value, source URL, quote, retrieved_at, hash, and any manual-verification flags. Commit trailers carry Agent, Client-Id, Changeset and traceparent. Returns the PR URL. It never merges. (write)
- **`comment_on_pull_request`**: posts a review note as the bot, usually the review_pull_request report. It cannot approve or merge. (write)
- **`close_changeset`**: abandons a changeset by closing its PR and deleting its bot/* branch. destructiveHint true. Needs the content:manage scope, which only the interactive connector entry holds, never the scheduled task. (write)

### The hot list

The cards under the tagline on the home page show what X is talking about this week ([HOT.md](HOT.md)). They go stale in days, so they get their own loop.

1) A separate cloud scheduled task runs twice a day, at about 07:00 and 19:00 UTC, with the same connector.
2) It calls get_hot_list, then sweeps for candidates: search_x for the conversation itself, plus web search for press, Hacker News, GitHub trending, Reddit and Product Hunt, each cited source fetched through fetch_source.
3) It ranks by conversation on X, corroborated by at least one other signal, and tries to refute each candidate before keeping it (HOT.md).
4) open_changeset (kind hot), propose_hot_list, and propose_option_create or propose_stack for any hot product without a page; validate_changeset; submit_changeset. The PR is titled 'hot: YYYY-MM-DD HH:00'.
5) MERGE. A list that waits half a day for review is already stale, so this is the one lane that may merge without you (a decision for you, below). A hot PR auto-merges only if:
- it touches content/hot.json and nothing else (a new option or stack always waits for you);
- validate_changeset passed and every source has a fresh receipt;
- every item points at a page that already exists on main.
Anything else waits for your merge like every other PR. A kill switch in KV stops auto-merge, and every merge can be reverted in one click.

### The update loop

PRINCIPLE: detection is cheap, deterministic and runs on Cloudflare; judgement comes from Claude and you. Nothing reaches main without receipts and your merge.

1) DETECT. Admin Worker Cron, daily at 03:00 UTC, plain fetch() only, no LLM.
- Watch targets are derived from content on every deploy:
  - each option's GitHub repo, through the releases API with ETag requests (about 107 repos);
  - its RSS/Atom feeds and changelogs;
  - model.openrouter ids, from the OpenRouter models API for price and context changes;
  - plus overrides in ops/watch.json.
- Each new release, feed item or price change writes a row to D1 `changes`, mapped through the evidence map to the exact fact or stack layer it affects.
- Weekly link-rot pass over every source and evidence URL already in content (about 3k, spread across nights). Dead and redirected citations become link_broken or redirected entries, because a dead citation is a sourcing failure.
- GitHub issues labelled 'correction' (filed through prepare_correction) are pulled in as correction entries.
- The fetcher sends an identifying User-Agent and obeys robots.txt. Blocked hosts are reported, never worked around.
- Page-hash diffing of pricing and docs pages, and Browser Run for JS-only pages, are deferred to phase 4 because of noise.

2) TRIGGER. A Claude Code cloud scheduled task at about 03:30, nightly, on your plan, replaces the desktop task.
- The repo is selected only so the /refresh skill loads.
- Its only connector is 'Stackprints Admin', granted content:read and content:propose.
- The prompt forbids git pushes, so every write goes through the MCP and appears as stackprints-bot. You can then approve the bot's PRs, since the ruleset prevents approving your own.
- Weekly, a second task does stack research and pre-reviews community PRs.

3) PICK WORK. The run calls get_freshness_report, then list_changes, which goes first, then list_stale(news, 7 days). That is about 26 options a night, so all 182 non-pattern options are still covered weekly, but changed items jump the queue and quiet items cost nothing extra.

4) RESEARCH. Subagents fan out by layer (up to 9), each reading get_research_rules first.
- They search the web with their own tools.
- Every page they intend to cite goes through fetch_source, which issues a receipt. That turns 'only use URLs you actually saw' into a rule the server enforces. The Worker does the fetch, so the cloud sandbox's network allowlist does not matter.
- A page the server cannot read can only be proposed with verification:'manual' and a reason. Otherwise it is listed under 'could not verify' in the run summary, never guessed.

5) PROPOSE AND CHECK.
- open_changeset;
- propose_news, propose_option_update, propose_option_create (after check_duplicate) and propose_stack, all with claims[];
- validate_changeset;
- submit_changeset.
The result is one PR per news run, titled 'news: refresh YYYY-MM-DD (N options, M new items)', plus one PR per option or stack for fact changes, with at most about 10 fact PRs per run. Every call is written to the D1 audit log, including refused proposals.

6) REVIEW. CI runs check and build, and the bot PR gets a Workers preview URL. You skim the generated table (old value, new value, source, quote, hash, manual flags), approve and merge on GitHub. There is no merge tool anywhere in the MCP. Merging deploys both Workers from that commit, so the site, API, markdown, llms.txt and both MCP bundles update together.

7) COMMUNITY PRs. The weekly task runs review_pull_request on new submission PRs and posts the report with comment_on_pull_request, so you review with the evidence already checked.

8) AUTO-MERGE: none in v1. The criteria are written down now, for an opt-in later. A PR qualifies only if:
- it touches content/news/** only;
- every item is receipted, with the title matched and the date taken from metadata;
- it cites only domains already present in merged history;
- it has 40 items or fewer;
- there have been about 6 clean weekly runs first.
You get a daily digest and one-click revert. Facts, stacks, new options and community submissions always need your merge.

9) CUTOVER AND FALLBACK.
- Run the new loop alongside the current desktop task for 2 to 3 runs and compare outputs before retiring the desktop task.
- In the first days of phase 2, test that a cloud scheduled task can actually load the custom admin connector; 2026 issue reports said it sometimes could not.
- The fallback is the same /refresh skill run by anthropics/claude-code-action on a GitHub Actions cron, using the hashed read+propose bearer.

## Public MCP (anyone's agent)

- **`search_stackprints`**: full-text search over stacks, layers and options, using the same index and ranking as /search.json and the existing WebMCP tool. Returns kind, title, the page URL to cite, the matched field and data_version. (read)
- **`list_layers`**: the 28 layers in 5 bands, with board designator, description and option count. Display names are accepted as input. The user's agent reads this to map its goal onto layers. (read)
- **`get_layer`**: one layer and its options summarised (profile, note, open or closed, affiliation sentence), with usage counted separately for real stacks and example stacks. (read)
- **`get_option`**: one datasheet: summary, facts with their citations and vendor-reported labels exactly as written, links, goodFor, watchOut, model fields, latest news, the affiliation sentence when present, and the stacks that use it, split into real and example. (read)
- **`list_stacks`**: every stack with kind, tagline, disclosure (open-source, documented, closed, example) and links. Filters: disclosure, kind, uses_option. Cursor pagination, ttlMs about 1 h, cacheScope public. (read)
- **`get_stack`**: one stack, layer by layer, in the /api/stacks/{slug}.json shape: picks with evidence URLs, supports, notDisclosed, inUseUndisclosed, notUsed, closedLayers, sources, version, author, researched, data_version. (read)
- **`compare_options`**: 2 to 5 options from one layer side by side. Fact rows are aligned and every cell keeps its citation. A missing value reads 'not researched' and is never inferred. Also shows open or closed, real versus example usage, and affiliation. (read)
- **`get_stack_graph`**: nodes (stacks, layers, options) and edges (picks with evidence URLs and the stack's disclosure, supports, co-occurrence). Scope is chosen stacks, a layer or one option's neighbourhood. Co-occurrence counts only open-source and documented stacks, never examples. Optional Mermaid text and a board_url (the existing #s= share link). (read)
- **`find_similar_stacks`**: given a draft (layer to option ids) or a set of options, the closest stacks by Jaccard similarity over picks, with overlapping and differing layers. Real stacks and examples are reported separately. (read)
- **`plan_stack`**: deterministic blueprint from a goal, capabilities[] (vocabulary from content/plan.json) and constraints (open_source_only, self_hostable, must_include, exclude, start_from). Returns the relevant layers and why, up to 5 cited candidates per layer, layer rules (exclusive, any-* only in supports), similar real stacks, explicit gaps (never invented options), a draft with disclosure 'example', its board_url, the validate_stack verdict and rankingMethod. No LLM on our side, and it saves nothing. (read)
- **`validate_stack`**: runs the shared lib/validate.mjs (the same code as `npm run check` and CI) on a draft against current content. Returns errors with how to fix them, warnings, layers missing evidence, options that moved or were dropped (normalizeDraft), and the normalised draft with its board_url. (read)
- **`prepare_stack_submission`**: validates, slugifies and checks for slug collisions. Returns the exact content/stacks/<slug>.json, a pre-filled GitHub new-file link (built by today's lib/github.ts newFileUrl) when the URL is short enough, a `gh` command sequence and the reviewer checklist. The user or their agent opens the PR as themselves. Nothing is stored. (read)
- **`prepare_option_submission`**: the same for content/options/<layer>/<id>.json. It runs check_duplicate first, refuses order, logo and affiliation, and requires https links and sources. (read)
- **`prepare_correction`**: 'this fact is wrong or stale'. Validates the target (option, fact, news item or stack pick), the proposed value and at least one https source, then returns a pre-filled GitHub issue link using the 'correction' template. The admin detector picks it up as a correction entry for your agents to research. Nothing is stored and nothing changes directly. (read)
- **`get_hot`**: the hot list: the products people on X talk about the most this week, most first, with why, sources and each one's page. The same data as /api/hot.json and the get_hot WebMCP tool. (read)
- **`get_submission_status`**: reads a submission PR or correction issue by number or branch from the public GitHub API (cached): open, merged or closed, check results, preview URL, review comments. (read)
- **`submit_stack`**: phase 4 only, if the data shows agents cannot open PRs. Needs GitHub sign-in with the stacks:submit scope. Validates, gets a confirmation (MRTR elicitation, or a second call with an HMAC confirm token bound to the user and the payload hash, valid 15 minutes), then hands off through a service binding to the admin Worker, whose stackprints-submissions App opens a PR with a Co-authored-by credit and a stamped author.github. Requires an idempotency key. destructiveHint false. It never publishes. (write)
- **`submit_option`**: phase 4 only, same flow for a new option, with check_duplicate and the same caps. (write)
- **`withdraw_submission`**: phase 4 only. The caller withdraws their own open submission: the PR is closed and the stored payload deleted. It is also the erasure path for unmerged content; merged content stays in public git history, as the privacy page already says. (write)

### Submissions

V1 (PHASES 1-3): ANONYMOUS, NOTHING STORED, THE USER OPENS THE PR
1. The user's agent explores (search, get_*, compare_options, get_stack_graph, find_similar_stacks) and drafts with plan_stack.
2. It calls validate_stack. That is the CI validator itself: on a real-product stack every picked layer needs sources and evidence, and an example's description must start with 'An example design for…'.
3. It calls prepare_stack_submission or prepare_option_submission. These return:
   - the exact file and path;
   - a pre-filled GitHub new-file link, or `gh` commands when the URL would be too long;
   - the reviewer checklist.
4. The user, or their agent with their own GitHub credentials, opens the PR. The PR author is GitHub-verified, and GitHub's own per-user open-PR caps throttle spam.
5. Errors are reported with prepare_correction, which returns a pre-filled 'correction' issue. Your admin agents research it and propose a fix.

REVIEW (ALL PHASES)
1. The required 'check' Action runs on the PR.
2. The weekly admin task runs review_pull_request: it re-fetches every evidence URL, checks quotes, flags unlabelled vendor numbers and marketing words, and posts the report.
3. You approve and merge. Merged is the only meaning of published, because the site, API and MCPs serve main only.

ATTRIBUTION
- Add an optional author.github field.
- A CI job checks that it equals the PR author, or the Co-authored-by login on bot PRs.
- This gives the LEADERBOARDS.md rule 'count authors, not stacks' a verified key. author.name stays free-text display.

PHASE 4: ONLY IF PREPARE CALLS FAR OUTNUMBER OPENED PRs (agents cannot open PRs)
- Add submit_stack, submit_option and withdraw_submission behind lazy 'Sign in with GitHub':
  - workers-oauth-provider in the public Worker, separate audience from admin;
  - CIMD, PKCE S256, one stacks:submit scope checked in the handler;
  - 401 with WWW-Authenticate at the HTTP layer, before the SDK runs.
- The public Worker holds no GitHub credential. It forwards through a service binding to the admin Worker, which alone holds the stackprints-submissions App key.
- Limits:
  - Atomic D1 quotas: 5 submissions a day and 3 open per GitHub id.
  - GitHub account at least 30 days old.
  - Global cap of 20 open submission PRs; the rest wait as queued.
  - Idempotency by content hash.
  - Payload of 64 KB or less and 20 sources or fewer.
  - Sources must be https; IP literals and our own hostnames are refused.
- The bot opens a PR on submit/<login>/<slug>-<hash8> with:
  - a Co-authored-by noreply trailer;
  - a stamped author.github;
  - the link-check results;
  - a banner marking the text as untrusted user content.
- It never publishes. Privacy, About and Pricing copy change in the same PR.

## Phases

1. PHASE 1, SHIPPABLE IN ABOUT 4-5 WORKING DAYS: live site plus a read-only public MCP.
(1) Create the GitHub org and the public repo stackprints/stackprints and push. lib/data.ts and the Submit/Publish links already point there and 404 today.
(2) Add the 'check' Action (npm run check && npm run build) and a ruleset on main: PR required, 1 approval, check required, no app bypass. Keep repo-admin bypass for now.
(3) Move the stackprints.com zone to Cloudflare and buy Workers Paid.
(4) Deploy the 'stackprints' Worker: Static Assets, _headers, and the negotiation handler.
(5) Run a curl conformance script covering every vercel.json rule. Check that /.well-known/* uploads (unverified). Then point DNS.
(6) Extract lib/validate.mjs from check.mjs and lib/tools.ts from WebMcp.tsx, and add scripts/mcp-bundle.mjs.
(7) Serve /mcp with createMcpHandler and 12 anonymous read tools: search_stackprints, list_layers, get_layer, get_option, list_stacks, get_stack, get_hot, validate_stack, prepare_stack_submission, prepare_option_submission, prepare_correction, get_submission_status. Each tool gets a title, explicit annotations, a self-contained outputSchema plus a text mirror, and data_version.
(8) Rate limiting: a binding keyed by IP and the one Free WAF rule, with 429, Retry-After and RateLimit headers. Validate Origin. Add a fair-use line to the Pricing copy.
(9) Test both protocol eras with MCP Inspector, Claude and Claude Code.
(10) Keep today's desktop news task, but have it push a branch and open a PR instead of committing to main.

2. PHASE 2, ADMIN MCP AND CHANGE DETECTION (about 1.5-2 weeks).
(1) Day 1-2 spike, before building the rest:
- Deploy stackprints-admin with workers-oauth-provider (GitHub upstream, ADMIN_GITHUB_IDS allowlist, CIMD, scope checks with unit tests).
- Add it as a claude.ai custom connector.
- Prove a Claude Code cloud scheduled task can call it. If not, switch the runner to claude-code-action with the hashed bearer.
(2) Create the stackprints-bot GitHub App and implement Git Data API commits.
(3) KV for OAuth and the fetch cache; D1 for changes, link_status and audit.
(4) Build the sourcing gate: path allowlist, immutable fields, receipts, quote, title and date checks, the vendor-reported rule, word lint, the manual-verification lane, base-SHA checks.
(5) Ship the 23 admin tools and the generated PR bodies.
(6) Daily Cron detector (GitHub releases, RSS/Atom, OpenRouter prices, correction issues) and the weekly link-rot pass.
(7) Commit the /refresh skill and rewrite docs/NEWS.md so agents write only through the admin MCP.
(8) Start the nightly cloud scheduled task, the twice-daily hot list task and the weekly stack and PR-review task. Make Workers preview URLs required on bot PRs.
(9) Run alongside the desktop task for 2-3 runs, then retire it and remove the repo-admin bypass.

3. PHASE 3, PUBLIC PLANNING TOOLS AND LISTINGS (about 1 week).
(1) Write content/plan.json (capabilities to layers) and review it by PR.
(2) Add compare_options, get_stack_graph, find_similar_stacks and plan_stack.
(3) Neutral ranking:
- match strength, then the number of distinct real stacks using the option, excluding examples and the vendor's own stacks, then alphabetical;
- never `order`, never affiliation;
- a unit test proving both are ignored;
- the rule published on /about and in the tool description.
(4) Add resource templates (stackprints://stack/{slug}, layer/{id}, option/{layer}/{id}), stackprints://rules/research and the design_agent_stack prompt.
(5) Discovery:
- a server card at /mcp/server-card and /.well-known/mcp/server-card.json;
- ard.json and ai-catalog.json entries;
- an llms.txt mention.
(6) Test with ChatGPT and Cursor as well. Then list on the MCP Registry (com.stackprints/stackprints through /.well-known/mcp-registry-auth), Smithery and the Claude Connectors Directory.

4. PHASE 4, ONLY WHEN A MEASURED SIGNAL JUSTIFIES IT. Each item is independent.
(a) GitHub sign-in plus submit_stack, submit_option and withdraw_submission through the admin-held submissions App, with D1 quotas and privacy copy changes. Do this only if prepare calls far outnumber opened PRs.
(b) A news-only auto-merge lane, under the pre-written criteria, after about 6 clean runs.
(c) Page-hash diffing of pricing and docs pages, plus Browser Run for JS-only pages, if releases and feeds miss real changes.
(d) A REST mirror (POST /api/v1/<tool> with Idempotency-Key) for agents without MCP.
(e) An MCP App (ui://) board viewer.
(f) Vendor claims by domain proof.
(g) A second admin on the allowlist, and Cloudflare Access if the admin team grows.

## Monthly cost

INFRASTRUCTURE: about $5/month, and about $10-15 in a bad month. This is an estimate, not a quote.

Cloudflare:
- Workers Paid: $5 fixed. Assume about 5k MCP calls a day plus about 500k HTML views a month through the negotiating Worker. That is roughly 0.7M requests against 10M included, and CPU inside the 30M ms included.
- KV for OAuth and the fetch cache: $0.
- D1 for the change queue, link status and audit: $0, far below 5 GB and 50M rows written.
- Cron, the rate-limit binding and the one WAF rule on the Free zone: $0.
- Browser Run, Workflows, Queues, R2 and Workers AI are not used in v1: $0. If phase 4 adds Browser Run, it is $0 within the 10 included browser-hours and about $5 at worst.

Other:
- GitHub (public repo, Actions minutes, two Apps): $0.
- Domain renewal at registrar cost, roughly $1/month (check your registrar).
- The X API behind search_x, only if you choose it for the hot list: a paid API tier, priced by X (check its current pricing). Not counted in the total above.
- Recheck after 2026-12-01, when Workers Logs moves to Observability pricing.
- Optional Pro zone, only for more WAF rate rules: +$20-25. Not recommended.

RESEARCH TOKENS, THE REAL VARIABLE
- On your existing Claude plan through cloud scheduled tasks: $0 marginal up to the plan's usage limits.
- At API rates through the claude-code-action fallback: a full weekly sweep of all options was estimated at about $55 per pass on Sonnet 5.5, roughly $230/month (unverified). Change-driven runs that research only changed or stale items should land around $50-80/month (unverified; it depends on how often vendors ship). Opus costs about 2x.

REALISTIC ALL-IN: about $5-6/month infrastructure plus $0 (subscription) to about $80 (API) for research.

For comparison: Vercel Pro would be $20 per seat each month, and the MCP would still need a separate project and an outside auth server.

## Risks

- You are the only reviewer, so 'constantly up to date' is capped by your review time. Mitigations:
- detection first, so agents research only what changed;
- about 26 options a night;
- one news PR per run, with fact PRs per item and capped;
- generated diff tables and required preview URLs;
- admin pre-review of community PRs.
The news-only auto-merge lane is pre-specified but stays off until about 6 clean runs.
- Prompt injection from fetched vendor pages, community submissions and correction issues, all of which your agents read. Mitigations:
- page and submission text is always returned as delimited untrusted data;
- propose_* can only write whitelisted fields under content/options, content/news and content/stacks;
- there is no merge or delete-content tool;
- the scheduled task's grant lacks content:manage;
- apps cannot bypass the ruleset.
The worst case is a bad PR, never a bad publish.
- The quote check is necessary but not sufficient: it proves the text is on the page, not that the fact was read correctly or that a number is vendor-reported. Pages the Worker cannot read (PDFs, JS-only pages, bot challenges) go through the flagged verification:'manual' lane, which is never auto-mergeable. Your merge stays the final gate.
- Claude Code cloud scheduled tasks are a research preview. 2026 issue reports said custom connectors sometimes failed to load in them. Whether web search works under the default 'Trusted' network is unverified; fetch_source sidesteps the fetch part. Mitigations:
- the spike on days 1-2 of phase 2;
- run alongside the desktop task;
- claude-code-action on GitHub Actions kept ready as the fallback runner.
- MCP 2026-07-28 is under 3 months old. Claude's support was announced as 'rolling out', CIMD support in ChatGPT and Cursor is unverified, and Cloudflare's docs do not state which revisions createMcpHandler serves. Mitigations:
- serve both eras from one endpoint;
- keep DCR as the admin fallback;
- pin SDK versions;
- run the client test matrix before every directory listing.
- workers-oauth-provider advertises scopes but does not enforce them, so one missed check leaks privileges. Every tool has a scope unit test, the admin server uses a separate host and audience from any public token, and CIMD needs the global_fetch_strictly_public compatibility flag.
- Neutrality: past.dev is built by the site's team and has order 5, first in Memory. If plan_stack, compare_options or the graph ever used `order`, affiliation or example stacks, the disclosure would become a credibility problem. Mitigations:
- the published adoption-based ranking rule;
- examples and the vendor's own stacks excluded from usage counts;
- the affiliation sentence on every result;
- a unit test.
- Promise drift: the rate-limit note now, and GitHub sign-in in phase 4, both touch the 'no accounts, no API key, no rate-limit tiers' copy in lib/agent.ts (PRIVACY, About, Pricing). The copy has to change in the same PR that ships each feature.
- Unmet prerequisites: the repo returns 404 and the domain does not resolve today, so even the current Submit and Publish links are broken until phase 1. On the Workers Free plan, run_worker_first routes return 429 past quota, so Paid is mandatory from day 1. Whether wrangler uploads the /.well-known dot-directory is unverified. Pre-filled new-file URLs can exceed length limits for large stacks; the gh-command fallback handles that.
- A leaked GitHub App key lets an attacker push branches and open PRs, but not merge. Mitigations:
- the keys live only in the admin Worker, and the public Worker holds no GitHub credential;
- one App per purpose, each scoped to this one repo;
- key rotation;
- the D1 audit log.
- Vendor sites that block Cloudflare egress, or noisy feeds, can leave items as 'could not verify' or flood the change queue. Mitigations:
- blocked hosts are shown in get_freshness_report;
- dismiss_change with a reason suppresses a hash;
- ignore rules in ops/watch.json;
- page diffing deferred to phase 4.

## Decisions for the owner

- Make github.com/stackprints/stackprints a public repo now, under a new GitHub org, and confirm you control stackprints.com so its DNS can move to Cloudflare. Everything else, including today's Submit and Publish links, depends on this.
- Who pays for research: your Claude subscription through a Claude Code cloud scheduled task (the default, $0 marginal, research preview), or an API key through claude-code-action on GitHub Actions (a hard dollar budget and the most auditable, about $50-80/month change-driven).
- Your review budget and cadence: a small bot PR every night (recommended) or one larger weekly batch. Also whether you pre-commit to the news-only auto-merge criteria after about 6 clean runs, or keep merging every PR yourself.
- Approve the neutral ranking rule for plan_stack and compare_options: adoption in real, non-example, non-vendor stacks, never `order` and never affiliation, published on /about. It puts past.dev wherever the data puts it.
- Approve the copy changes: a fair-use rate-limit line on Pricing now. Decide whether you would ever accept GitHub sign-in for direct submissions in phase 4, which ends the unqualified 'no accounts' promise. If not, the PR-only flow is permanent.
- How the hot list reads X: the X API behind search_x (reliable, measures engagement, a paid API tier), or web search for x.com posts only (free, undercounts smaller conversations). The first list was built without the API.
- Whether hot-only PRs may merge themselves under the criteria in "The hot list" (recommended: the list is stale within a day), or wait for your merge twice a day.
- Name a backup admin (a GitHub id for the admin allowlist and a second approver on main), or accept the bus factor of one.
- Which to build first after phase 1: the admin MCP for your agents (recommended, phase 2) or the public planning tools and directory listings.

## How the designs scored

| Judge | Static-first | Cloudflare-native | Hybrid |
| --- | --- | --- | --- |
| CTO | R8 H9 C9 S9 O9 U7 | R6 H8 C7 S3 O4 U8 | R7 H8 C8 S5 O5 U8 |
| Trust & safety | R8 H9 C9 S9 O8 U7 | R6 H7 C8 S4 O5 U9 | R6 H8 C8 S5 O6 U9 |

R reliability · H honesty · C cost · S simplicity · O ops · U user value (1–10).

## Research sources

- **cloudflare**: https://developers.cloudflare.com/workers/static-assets/, https://developers.cloudflare.com/workers/static-assets/compatibility-matrix/, https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/, https://developers.cloudflare.com/workers/static-assets/headers/, https://developers.cloudflare.com/workers/static-assets/redirects/, https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/, https://developers.cloudflare.com/workers/static-assets/migrate-from-pages/, https://developers.cloudflare.com/workers/platform/limits/
- **alternatives**: https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel, https://vercel.com/docs/functions/limitations, https://vercel.com/docs/workflows/pricing, https://vercel.com/blog/a-new-programming-model-for-durable-execution, https://vercel.com/docs/queues/pricing, https://mcpservers.org/agent-skills/openai/vercel-queues, https://vercel.com/docs/cron-jobs/usage-and-pricing, https://vercel.com/docs/sandbox/pricing
- **mcp-practice**: https://modelcontextprotocol.io/specification/versioning, https://modelcontextprotocol.io/specification/2026-07-28/changelog, https://modelcontextprotocol.io/specification/2026-07-28/basic/transports, https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization, https://modelcontextprotocol.io/specification/2026-07-28/server/discover, https://modelcontextprotocol.io/specification/2026-07-28/server/tools, https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- **accounts**: /Users/mehdidjabri/Work/agenticstack/lib/share.ts, /Users/mehdidjabri/Work/agenticstack/lib/github.ts, /Users/mehdidjabri/Work/agenticstack/lib/agent.ts (PRIVACY line 199, About line 183, Pricing line 218), /Users/mehdidjabri/Work/agenticstack/lib/types.ts (author field, line 102), /Users/mehdidjabri/Work/agenticstack/scripts/check.mjs (line 112), /Users/mehdidjabri/Work/agenticstack/components/Editor.tsx, /Users/mehdidjabri/Work/agenticstack/components/SubmitForm.tsx, /Users/mehdidjabri/Work/agenticstack/components/Mine.tsx
