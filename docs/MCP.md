# Stackprints MCP servers

Status, 2026-10-23: built and tested, not yet deployed. The code is in [`mcp/`](../mcp); how to set it up is in [mcp/README.md](../mcp/README.md). This page describes what is built and why. It replaces the proposal of 2026-10-22, which is in git history.

## What there is

- **The public MCP server** (`stackprints-mcp`, `mcp/src/servers/public.ts`). Anyone's agent, no sign-in, read-only, stores nothing. It reads the catalogue and prepares submissions that the user opens on GitHub as themselves. It answers from a bundle of the site's JSON API and content, built with the site at deploy, so it always agrees with the site. Served at `stackprints.com/mcp`.
- **The site Worker** (`stackprints`, `mcp/src/workers/site.ts`). The static export in `out/` as Workers Static Assets, with the rules `vercel.json` describes for other hosts: markdown twins for agents that ask, content types, discovery and canonical `Link` headers, markdown 404s. It hands `/mcp` to the public server through a service binding.
- **The admin MCP server** (`stackprints-admin`, `mcp/src/servers/admin.ts`). The maintainers' agents research and write content through it. Private: every call needs a GitHub sign-in or an API key. Every write is a commit to the content repository, which is the site's database. Served at `admin.stackprints.com/mcp`.
- **Local servers** (`mcp/src/local/`). Both servers over stdio for this machine. The local admin server writes to this checkout with git instead of GitHub's API.
- **Shared code.** `lib/validate.mjs` holds the content checks. `npm run check`, CI, the public `validate_stack` and the admin `validate_changeset` and `submit_changeset` all run it, so an agent's change passes exactly when CI would pass it. The read tools return the site's own JSON API, built by `lib/agent.ts`.

Both servers speak Streamable HTTP, MCP 2026-07-28, and still answer the 2025 handshake. They keep no sessions; the admin server builds each request's tools for its caller's scopes.

## Accounts

There are no Stackprints accounts. Reading stays anonymous: the site, the JSON API and every public MCP tool. A person who wants to add or fix something opens a pull request or an issue on GitHub as themselves; the public server only prepares it. GitHub is the only identity, and only the admin server uses it.

## Publishing

The repository is the database. A change an agent submits through the admin server is checked and committed:

- **Straight to `main`** when the caller holds `content:publish`, every check passes and no claim is marked manual. Every push to `main` deploys (`.github/workflows/deploy.yml`), so the change is live a few minutes later.
- **As a pull request** otherwise, or when the agent asks for one. It waits for a person to merge it.

The proposal had only the second lane: a bot could open pull requests but never publish. The direct lane exists because the hot list goes stale in a day and the news in a week, and one reviewer can't merge that often. It is guarded by the safeguards below, and every publish can be undone.

### Safeguards

- **The server fetches every source itself.** `fetch_source` reads the page and keeps a receipt: its text, a SHA-256 and the time. A URL the content doesn't already cite can only go into a proposal with a receipt from the last 14 days, or 48 hours for the hot list. `search_x` gives each post it returns a receipt too. "Only cite pages you opened" is a rule the server enforces, not one it trusts.
- **The fetch is safe to expose.** Public https pages only: no IP literals, internal names, other ports or private addresses, checked again on every redirect (at most 5), with time and size capped and our own hosts refused. Each key or account may fetch 2,000 pages and run 300 X searches a day.
- **Quotes are checked.** Every fact a proposal adds or changes needs a claim: the field, a URL and a quote of 8 to 300 characters, which must appear in the text the server fetched. Verified claims become the fact's citation. News titles and dates are compared with the page, a published prompt must appear on its source page, and a post on X must be credited to its real author.
- **Manual claims force a pull request.** A fact no machine can check (a PDF, a paywall, a script-only page) goes in the proposal's `manual` list with a reason. It is named in the commit message as `MANUAL CHECK`, and its changeset can only become a pull request.
- **The shared validator.** `validate_changeset` and `submit_changeset` run `lib/validate.mjs` on `main` with the changes on top. Errors already on `main` are reported apart and don't block. Logos are held to a strict allowlist of elements and attributes, one colour, under 8,000 bytes, with no stylesheet, class, script or outside link; the rules are in the validator, so CI enforces them on every logo too.
- **Only content can change.** A changeset can write `content/layers.json`, `content/hot.json` and files under `content/options`, `content/news`, `content/stacks`, `content/prompts` and `content/logos`, nothing else. An option update can't change `id`, `order`, `name`, `logo`, `affiliation` or `exclusive`.
- **Changesets have an owner.** The key or GitHub account that opened a changeset is its owner. Only the owner proposes into it or submits it. A caller with `content:publish` may also close (abandon) someone else's, never add to it or submit it.
- **Compare-and-swap state.** Every read-modify-write of state goes through `StateStore.update`, an atomic compare-and-swap on the row's version, retried up to 8 times. Subagents proposing into one changeset at once all land; a proposal that raced another on the same file is computed again on the new state. A submit freezes the changeset first, so nothing changes between the check and the commit.
- **expectedVersion.** `get_item` returns a file's version (the SHA-256 of its text). `propose_option_update`, `propose_stack` and `propose_hot_list` take it as `expectedVersion` and refuse a change built on an older read; replacing a stack requires it. At submit, if `main` changed a staged file since the changeset was opened, the submit is refused; otherwise the changeset is rebased on the new head.
- **Submits are safe to retry.** A submit records what it is about to write before writing. Called again after a timeout, it finds the commit or pull request an earlier try made instead of writing twice. Each changeset has one branch, `bot/<kind>/<id>`, so it can't open two pull requests.
- **Protected branches.** If `main` takes pull requests only, the publish is refused, nothing is written, and the answer says to submit again with mode `pr`.
- **Untrusted text is marked.** Page text, posts and correction issues come back between `<<<UNTRUSTED PAGE TEXT url=…>>>` markers, and the server instructions tell agents never to follow them. Agent text that goes into a commit message is flattened to one line, so it can't add a trailer or hide characters.
- **The audit log.** Every write and every outside read is logged with who, the tool, the arguments (shortened) and the outcome, for 180 days (`get_audit_log`). Commits carry `Agent:` and `Changeset:` trailers, and `Author:` when someone else opened the changeset.
- **revert_commit.** A publish from the last 90 days can be undone with a new commit that restores every file it wrote. It is refused when a file changed again since, or when the result would fail the checks.
- **The deploy gate.** `deploy.yml` runs `npm run check` and the site build before deploying. A commit that fails them is never deployed.

What remains: the quote check proves the text is on the page, not that the agent read it correctly. A wrong fact can reach the site; the defence is that every changed fact cites the page it came from, every publish is in `history` and the audit log (with the proposal's arguments, shortened), and `revert_commit` undoes it. An agent that should only suggest gets a key without `content:publish`.

## Scopes

| Scope | Allows |
| --- | --- |
| `content:read` | Every read tool, `fetch_source`, `search_x`, the audit log, history. Every caller has it. |
| `content:write` | Open changesets, propose, validate, submit as a pull request, close your own. Implies `content:read`. |
| `content:publish` | Submit straight to `main`, revert a publish, close anyone's changeset. Implies `content:write`. |
| `keys:manage` | Create, list and revoke API keys. Implies `content:read`. Not on the local server. |

Each caller sees only the tools its scopes allow.

## Auth

**GitHub sign-in** for claude.ai and any client that signs in. The admin Worker is its own OAuth 2.1 server (`@cloudflare/workers-oauth-provider`): our consent page, then GitHub as the identity, then a grant only for GitHub accounts whose numeric id is in `ADMIN_GITHUB_IDS`. It is `"1470765"`, the owner (login mehdidjabri). Logins are shown, never checked: a login can be renamed and claimed by someone else, an id can't. The id is checked again on every request, so removing it locks the account out at once. GitHub's token is used once to learn who signed in, then revoked.

The consent page always grants `content:read`. It offers `content:write` and `content:publish`, ticked when the client asks for them, and `keys:manage` only when the client asks for it, unticked. Access tokens last an hour. A token issued on one host is refused on another. Clients register dynamically (claude.ai does) or with a Client ID Metadata Document.

**API keys** for agents that don't sign in. A key (`spk_…`) is shown once; the server keeps its SHA-256, name, scopes and who minted it.

- A caller can only mint or revoke keys whose scopes it holds itself.
- Revoking a key also revokes every key it minted, down the chain.
- Keys minted by a GitHub account, directly or through other keys, stop working when that id leaves `ADMIN_GITHUB_IDS`.
- `list_api_keys` shows when each key was last used, to the hour.

**The bootstrap key.** The `BOOTSTRAP_KEY` secret (32 characters or more) acts as the owner with every scope, only while no API key exists. It mints the first key; then it stops working and should be deleted.

**Limits.** On the admin Worker, sign-in, token and registration requests are limited to 30 a minute per address, and so are failed authentications on `/mcp`, after which the address is refused for a minute. A client registration is capped at 8 KB and 5 redirect URIs. The public server allows 600 requests a minute per address (an IPv6 /64 counts as one) and answers past it with 429, `Retry-After` and `RateLimit` headers.

**The local admin server** has no auth: it is the person at this machine, named `local:<git user>`, with the scopes in `STACKPRINTS_SCOPES` (default read, write and publish). It has no key tools, since no server reads keys from this machine.

## State

The content lives in git. The admin server keeps a little state besides it:

| What | Key | Kept |
| --- | --- | --- |
| Changesets | `changeset:<id>` | 14 days untouched while open; 90 days once submitted or closed |
| Fetched pages (receipts) | `page:<hash of the URL>` | 14 days |
| API keys | `apikey:…`, `apikey-id:…`, `apikey-used:…` | until revoked |
| Revoked keys | `apikey-revoked:<hash>` | 400 days |
| Audit log | `audit:<time>` | 180 days |
| Daily allowances | `quota:<day>:<tool>:<caller>` | 2 days |
| Published commits | `published:<sha>` | 90 days, for `revert_commit` |
| Last write | `last-write` | kept |

On the Worker this is one D1 table, `state` (`mcp/migrations/0001_state.sql`): a key, a JSON value, a version that changes on every write, and an expiry. D1 rather than KV because KV is eventually consistent: a value written there may not be read back for a minute, and a missing key can stay missing for as long. The fetch-then-cite loop needs a receipt the moment after the fetch, and parallel subagents need atomic updates. Expired rows are invisible and swept a few at a time.

KV holds only `OAUTH_KV`, which the OAuth library needs, and the optional `CACHE_KV`, which keeps each commit's files by sha (they never change). The local admin server keeps its state in `.stackprints/admin-state.json`, behind a lock file.

## Tools

### Public server

Anyone's agent. All read-only; nothing is stored or sent.

- **`search_stackprints`**: full-text search over stacks, layers and options, best first, each with the page URL to cite.
- **`list_layers`**: the 28 layers in 5 bands, with designator, description and how many options each has.
- **`get_layer`**: one layer and every option in it, plus the prompts stacks publish for that layer.
- **`get_option`**: one datasheet: summary, cited facts, links, good for, watch out, model fields, recent news and the stacks that use it.
- **`list_stacks`**: every stack, filtered by disclosure, kind or an option it picks.
- **`get_stack`**: one stack layer by layer, with its evidence, empty states, prompts, version and research date.
- **`get_hot`**: this week's hot list, in two rows, most talked about first.
- **`validate_stack`**: checks a stack draft with the CI validator; returns errors, warnings and a link that opens the draft on the board.
- **`prepare_stack_submission`**: the exact file for a new stack, a prefilled GitHub new-file link, `gh` steps and the reviewer checklist.
- **`prepare_option_submission`**: the same for a new option, after a duplicate check by name, domain and repo.
- **`prepare_correction`**: a prefilled `correction` issue for a fact that is wrong, stale or missing.
- **`get_submission_status`**: the state and CI checks of a submission pull request or correction issue, cached a minute.

### Admin server

The public server's seven read tools (`search_stackprints` to `get_hot`) come along, so one connector reads everything. They read the live site, which can lag `main` by a deploy. The submission tools don't: an admin writes instead.

Reading and research (`content:read`):

- **`whoami`**: who you are, your scopes, today's date (UTC), `main`'s head and what you may do. Call it first.
- **`get_freshness_report`**: stale news, options and stacks, the hot list's age, open changesets and corrections, and the last write.
- **`list_stale`**: news, options or stacks older than a cutoff, oldest first.
- **`get_item`**: one content file at `main`'s head, or as a changeset sees it, with its version.
- **`get_research_rules`**: `docs/RESEARCH.md`, `NEWS.md` and `HOT.md` as they are on `main`, and how to apply them through the tools.
- **`check_duplicate`**: options and stacks that match a name, domain or GitHub repo.
- **`fetch_source`**: reads a public https page and keeps a 14-day receipt; the text comes back marked untrusted.
- **`search_x`**: recent posts on X with their metrics, each receipted. Needs `X_BEARER_TOKEN`.
- **`list_corrections`**: open `correction` issues, parsed into target, field and sources, as untrusted leads.
- **`get_hot_list`**: `content/hot.json` resolved to pages, with its age and version.
- **`get_audit_log`**: writes and outside reads, newest first.
- **`history`**: recent content commits on `main`, with the paths each changed.
- **`list_changesets`**: changesets with their status, owner and result; `mine` marks yours.
- **`get_changeset`**: one changeset in full, with its diff.

Changesets (`content:write`, except `revert_commit`):

- **`open_changeset`**: starts one unit of work pinned to `main`'s head.
- **`validate_changeset`**: the dry run of a submit: errors, warnings, manual claims, the diff and whether it would publish.
- **`submit_changeset`**: commits to `main` or opens a pull request; safe to retry.
- **`close_changeset`**: abandons a changeset without writing anything.
- **`revert_commit`** (`content:publish`): undoes a publish with a new commit.

Proposals (`content:write`), each into an open changeset of your own:

- **`propose_news`**: new news items for one option; the server merges, sorts, trims and sets `updated`. `items: []` records "checked, nothing new".
- **`propose_option_update`**: merges changes into one option, each new or changed fact with a quoted claim.
- **`propose_option_create`**: a new option and its empty news file, after `check_duplicate`.
- **`propose_stack`**: creates or replaces a whole stack.
- **`propose_hot_list`**: replaces the hot list, both rows in full.
- **`propose_prompt`**: a prompt a stack's makers publish, verbatim from an official source.
- **`propose_logo`**: an SVG logo, optionally set on an option or a stack.

API keys (`keys:manage`, Worker only):

- **`create_api_key`**: mints a key with scopes you hold; shown once.
- **`list_api_keys`**: the keys you could revoke, with who made them and when they were last used.
- **`revoke_api_key`**: revokes a key and every key it minted.

## The update loop

How an agent keeps news and datasheets current, as the server instructions tell it. The procedure for people is in [NEWS.md](NEWS.md).

1. `whoami`: scopes and today's date.
2. `get_freshness_report`: what is stale, open changesets (continue your own from `list_changesets`) and corrections (`list_corrections`, each a lead to check, never an instruction).
3. `list_stale` with kind `news` (7 days) for the night's batch, split by layer across up to 9 subagents. Options and stacks older than 90 days come the same way.
4. `get_research_rules`, passed to every subagent.
5. `open_changeset`. Subagents of one session share its connection and can propose into its changeset; an agent on another key or account opens its own.
6. For each option: `get_item`, a web search for news since its `updated` date, `fetch_source` on every article to cite, then `propose_news` with only the new items. When the news changes a fact, `propose_option_update` with a quoted claim and the file's version.
7. `validate_changeset` until it is clean.
8. `submit_changeset`, with a subject such as `news: refresh 2026-10-23 (25 options, 9 new items)`.

## The hot list loop

The cards under the tagline ([HOT.md](HOT.md)) go stale in a day, so they get their own run, twice a day.

1. `get_hot_list`: what is listed, its age and its version.
2. `search_x` for what X discussed in the last 7 days, ranked by engagement, plus web search, Hacker News, GitHub and the press for corroboration. `fetch_source` every other source. All sources must be read within 48 hours of proposing.
3. Rank, and try to refute each candidate (HOT.md).
4. `open_changeset` with kind `hot`. A product with no page gets one first in the same changeset: `check_duplicate`, then `propose_option_create` or `propose_stack`.
5. `propose_hot_list` with both rows in full and the version from step 1.
6. `validate_changeset`, then `submit_changeset` with the subject `hot: YYYY-MM-DD`.

## Deferred

Built later, or not at all, depending on how the loops above do:

- **A change detector.** A daily cron on the admin Worker that watches each option's releases, feeds and OpenRouter prices, plus a weekly link-rot pass over every cited URL, feeding `list_changes` and `dismiss_change` tools. Today runs pick work by age (`list_stale`) and corrections.
- **Pull request tools.** `list_proposals`, `review_pull_request` (re-fetch and check the evidence of a community pull request) and `comment_on_pull_request`.
- **`outputSchema` and `data_version`.** Tools return structured content with a JSON text mirror but declare no output schema, and answers don't carry the build's commit.
- **Resources and prompts.** The research rules as MCP resources, resource templates for stacks, layers and options, a `design_agent_stack` prompt.
- **Public planning tools.** `compare_options`, `get_stack_graph`, `find_similar_stacks` and `plan_stack`, with a published neutral ranking rule.
- **Discovery.** A server card, entries in `ard.json`, `ai-catalog.json` and `llms.txt`, and the MCP Registry, Smithery and the Claude connectors directory.
- **Signed-in public submissions** (`submit_stack` and the like), only if prepared submissions far outnumber opened pull requests.

The X API is optional. Without `X_BEARER_TOKEN`, `search_x` says so and agents find posts with web search; `fetch_source` reads x.com posts through a public mirror.

## Known limits

- **Commits from forks.** GitHub serves a commit from anywhere in a repository's fork network under the original repository's URL. A prompt cited as `github.com/<vendor>/<repo>/blob/<sha>/…` could therefore come from someone's fork. The server checks the text against that URL but not that the commit is the vendor's own; that needs a GitHub API call per prompt and is left for later. Review prompts from unfamiliar commits by hand.
- **DNS on this machine.** The local admin server checks that a page's host resolves to a public address, then fetches it, which resolves the name again. A host that answers differently the second time could reach a private address. Only port 443 is allowed and TLS must verify, so little can be reached that way. The Workers runtime doesn't have this gap (`global_fetch_strictly_public`).
- **X through a mirror.** Without an X API key, posts are read through the public api.fxtwitter.com mirror, so their receipts depend on it.

## Costs

About $5 a month for the infrastructure, more in a busy month. An estimate, not a quote.

- **Cloudflare Workers Paid**: $5 a month, required. It includes 10 million requests a month. The site Worker runs first on every request, assets included (`run_worker_first: true`), so every asset counts. At 500,000 page views a month and a few uncached assets each, that is a few million requests.
- **D1**: within what Workers Paid includes. A night's run writes a few hundred rows.
- **KV**: OAuth grants, and one cached copy of the content per commit read. Within what is included.
- **The rate-limiting binding**: no charge.
- **GitHub**: $0 for a public repository and its Actions minutes.
- **The X API**: only if you turn on `search_x`. A paid tier; check X's current pricing.
- **The domain**: the registrar's price.
- **Research tokens**, the real variable: $0 extra on a Claude plan within its limits, through claude.ai or Claude Code; at API rates, roughly $50 to $80 a month for runs that research only what is stale (unverified).

## Decisions for the owner

- **Publish the repository and the domain.** Push to `github.com/mehdidjabri/stackprints`, create the `correction` label, move `stackprints.com` to Cloudflare. Everything else waits on this.
- **Protect `main` or not.** No ruleset: agents with `content:publish` publish. A ruleset requiring pull requests with a bypass for the `GITHUB_TOKEN`'s account: agents publish, people use pull requests. A ruleset without a bypass: every submit becomes a pull request, as in the proposal.
- **Which agents publish.** Give scheduled agents `content:publish`, or `content:write` only so their work waits for your merge. A middle way: the hot list run publishes, the news run opens pull requests until a few clean runs.
- **Whose name is on the commits.** A bot account for `GITHUB_TOKEN`, or your own with `GIT_COMMITTER` naming the bot.
- **The X API.** Pay for `search_x` (measures engagement reliably) or rely on web search (free, undercounts smaller conversations).
- **`run_worker_first`.** Keep it on for every request (simple, every asset is a billed request), or limit it to HTML routes (cheaper, one more thing to keep in step).
- **Who runs the research, and who pays.** A Claude Code scheduled task or claude.ai on your plan, or an API key in GitHub Actions with a hard budget. Whether a cloud scheduled task can load the custom admin connector is unverified: test it first.
- **A backup admin.** A second GitHub id in `ADMIN_GITHUB_IDS`, or a bus factor of one.
- **The site copy.** `lib/agent.ts` still says the site is static, that a weekly job refreshes the news, and "no rate-limit tiers"; the public MCP has a fair-use limit and isn't listed in `llms.txt` yet.
- **What to build next** from the deferred list. The change detector would let runs follow what changed instead of age.
