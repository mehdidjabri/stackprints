# Stackprints MCP servers: setup

This folder holds two MCP servers and the Worker that serves the site. What they do and why is in [docs/MCP.md](../docs/MCP.md); this page is how to run them.

| Worker | Config | What it is |
| --- | --- | --- |
| `stackprints-mcp` | `wrangler.public.jsonc` | The public MCP server: anonymous and read-only. Served at `stackprints.com/mcp`. |
| `stackprints` | `wrangler.site.jsonc` | The site: the static export in `../out`, with `/mcp` handed to `stackprints-mcp`. |
| `stackprints-admin` | `wrangler.admin.jsonc` | The admin MCP server: the maintainers' agents write content through it. Served at `admin.stackprints.com/mcp`. |

There are also two local servers over stdio for this machine (step 9).

You need Node 22 or newer (CI uses 24), git, a GitHub account and a Cloudflare account. The GitHub CLI (`gh`) is optional but saves clicks. Step 1 runs at the repository root; from step 2 on, commands run in `mcp/`, and the few that need the root say `(cd .. && …)`.

## 1. Put the repository on GitHub

The servers read and write content in a GitHub repository, and every push to `main` deploys. The configs assume `github.com/stackprints/stackprints`.

1. Commit everything first. `git status` should be clean: the Workers deploy from what is on `main`.
2. Create the organization once at https://github.com/organizations/new (or use your own account).
3. Create the repository and push:

   ```bash
   gh auth login
   gh repo create stackprints/stackprints --public --source . --remote origin --push
   ```

   Without `gh`: create an empty public repository on github.com (no README), then:

   ```bash
   git remote add origin https://github.com/stackprints/stackprints.git
   git push -u origin main
   ```

4. Create the `correction` label. The correction issue form applies it, and `list_corrections` reads issues by it, but GitHub only applies labels that already exist:

   ```bash
   gh label create correction --description "A fact on the site is wrong, stale or missing" --repo stackprints/stackprints
   ```

**If the repository has another name**, change it in three places:

- `mcp/wrangler.admin.jsonc`: `vars.GITHUB_REPO`, as `owner/name`.
- `mcp/wrangler.public.jsonc`: `vars.REPO_URL`, as `https://github.com/owner/name`.
- `lib/data.ts`: `repo`, which the site's submit, publish and contribute links use.

The defaults in `src/workers/public.ts` and `src/local/*.ts` only apply when those are unset; the local servers read the `origin` remote.

## 2. Cloudflare account and wrangler

1. Sign up at https://dash.cloudflare.com/sign-up.
2. Buy **Workers Paid** ($5 a month): Workers & Pages, Plans. The site Worker runs on every request, and on the Free plan those requests fail with 429 once the daily allowance is used up.
3. Open Workers & Pages once and pick your `workers.dev` subdomain. Until you add custom domains (step 7), the Workers answer at `https://<worker>.<subdomain>.workers.dev`.
4. Install the dependencies and sign wrangler in:

   ```bash
   npm ci              # at the repository root
   cd mcp
   npm ci
   npx wrangler login
   npx wrangler whoami
   ```

   `whoami` prints your **account ID**; keep it for step 6.

## 3. Database and KV namespaces

The admin Worker keeps changesets, fetched pages, API keys and the audit log in a D1 database, and OAuth grants in a KV namespace. A second KV namespace, `CACHE_KV`, is optional: it keeps each commit's files between requests.

```bash
npx wrangler d1 create stackprints-admin
npx wrangler kv namespace create OAUTH_KV -c wrangler.admin.jsonc
npx wrangler kv namespace create CACHE_KV -c wrangler.admin.jsonc
```

Each command prints an id. Paste them into `mcp/wrangler.admin.jsonc`, replacing the zeros and ones:

- the D1 id into `d1_databases[0].database_id`;
- the `OAUTH_KV` id into the `kv_namespaces` entry with `"binding": "OAUTH_KV"`;
- the `CACHE_KV` id into the entry with `"binding": "CACHE_KV"`. If you skip `CACHE_KV`, delete that entry instead: a placeholder id fails the deploy.

If wrangler offers to add a binding to the config for you, decline: the bindings are there and only need the ids.

Then create the table:

```bash
npx wrangler d1 migrations apply stackprints-admin --remote -c wrangler.admin.jsonc
```

Run this again before deploying any change that adds a file to `migrations/`. The deploy workflow does not apply migrations.

The `ratelimits` entries need nothing: `namespace_id` is any number unique to your account.

## 4. GitHub credentials

The admin Worker needs two things from GitHub: a token to read and write the repository, and an OAuth App for signing in.

**The token** (`GITHUB_TOKEN`). Commits and pull requests appear as the token's account, so a separate bot account is cleaner, but your own works.

1. GitHub, Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token.
2. Resource owner: the organization that owns the repository. If it isn't offered, allow fine-grained tokens in the organization's settings (Personal access tokens), and approve the request if it asks.
3. Repository access: **Only select repositories**, the content repository.
4. Repository permissions:
   - **Contents**: Read and write.
   - **Pull requests**: Read and write.
   - **Issues**: Read-only (for `list_corrections`).
   - Metadata: Read-only, added automatically.
5. Pick an expiration and put a reminder in your calendar: when it expires, submits fail until you set a new one (step 5).

**Protected `main`.** A publish pushes straight to `main`. If a ruleset or branch protection makes `main` take pull requests only, every publish is refused, nothing is written, and the agent has to submit again as a pull request. To keep publishing, give the token's account a bypass in the ruleset, or leave `main` unprotected. [docs/MCP.md](../docs/MCP.md#decisions-for-the-owner) lists this as a decision.

**The OAuth App** (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`). claude.ai and other clients sign in through it.

1. GitHub, Settings, Developer settings, **OAuth Apps**, New OAuth App (under the organization's settings if you prefer it there).
2. Application name: `Stackprints admin`.
3. Homepage URL: the admin Worker's origin, `https://admin.stackprints.com`, or `https://stackprints-admin.<subdomain>.workers.dev` until step 7.
4. Authorization callback URL: that origin plus `/callback`, for example `https://stackprints-admin.<subdomain>.workers.dev/callback`.
5. Leave device flow off. Register, copy the **Client ID**, then Generate a new client secret and copy it.

An OAuth App has one callback host. When you move the admin Worker to `admin.stackprints.com`, edit both URLs. For `npm run dev:admin`, make a second OAuth App with `http://localhost:8787/callback`.

**Who may sign in** is `vars.ADMIN_GITHUB_IDS` in `wrangler.admin.jsonc`: numeric GitHub user ids, comma-separated. It ships as `"1470765"` (mehdidjabri). Logins are never checked, since a login can be renamed and claimed by someone else. To find an id:

```bash
gh api users/<login> --jq .id
```

## 5. Secrets

Set each secret on the admin Worker. Each command asks for the value. If wrangler says the Worker doesn't exist yet and offers to create it, answer yes.

```bash
npx wrangler secret put GITHUB_TOKEN -c wrangler.admin.jsonc
npx wrangler secret put GITHUB_CLIENT_ID -c wrangler.admin.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET -c wrangler.admin.jsonc
```

Optional:

```bash
# Turns on search_x (step 10).
npx wrangler secret put X_BEARER_TOKEN -c wrangler.admin.jsonc
# "Name <email>" for the commits the server writes; default the GITHUB_TOKEN's account.
npx wrangler secret put GIT_COMMITTER -c wrangler.admin.jsonc
# On the public Worker: a fine-grained token with read access to public repositories only, so
# get_submission_status isn't held to GitHub's 60 anonymous reads an hour.
npx wrangler secret put GITHUB_READ_TOKEN -c wrangler.public.jsonc
```

`BOOTSTRAP_KEY` comes in step 8. `npx wrangler secret list -c wrangler.admin.jsonc` shows what is set.

## 6. First deploy, then automatic deploys

Deploy in this order: the public MCP Worker first (the site binds to it for `/mcp`), then the site, then the admin Worker. The public Worker embeds the built site's JSON, so build the site first.

```bash
(cd .. && npm run build)
npm run deploy:public
npx wrangler deploy -c wrangler.site.jsonc
npm run deploy:admin
```

Each deploy prints its `workers.dev` URL.

Until `stackprints.com` points at the site Worker (step 7), the admin Worker's catalogue tools can't read the site. Set `vars.SITE_URL` in `wrangler.admin.jsonc` to the site's `workers.dev` URL meanwhile, and set it back once the domain is live.

**Automatic deploys.** `.github/workflows/deploy.yml` runs on every push to `main`: `npm run check`, the site build and the MCP typecheck, then the three deploys in the same order. It needs two repository secrets.

1. Cloudflare dashboard, My Profile, API Tokens, Create Token, the **Edit Cloudflare Workers** template.
   - Account Resources: your account.
   - Zone Resources: the `stackprints.com` zone (or all zones), for the custom domains.
   - Add a permission: Account, **D1**, Edit (the admin Worker is bound to a D1 database).
   - Create it and copy the token.
2. Add both secrets to the repository (Settings, Secrets and variables, Actions), or:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo stackprints/stackprints
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo stackprints/stackprints --body <account id from step 2>
   ```

Without `CLOUDFLARE_API_TOKEN` the workflow skips the deploy and says so. You can also start it by hand: Actions, deploy, Run workflow. `.github/workflows/check.yml` runs the content check, the site build, the typecheck and the MCP tests on every pull request and every push to another branch.

## 7. Domains

The `workers.dev` URLs work as they are. To serve the site on `stackprints.com` and the admin server on `admin.stackprints.com`:

1. Cloudflare dashboard, Add a domain, `stackprints.com`, Free plan. Change the nameservers at your registrar to the two Cloudflare gives you, and wait until the zone is active.
2. In `mcp/wrangler.site.jsonc`, uncomment:

   ```jsonc
   "routes": [{ "pattern": "stackprints.com", "custom_domain": true }],
   ```

3. In `mcp/wrangler.admin.jsonc`, uncomment the `routes` line and add a comma after the closing brace of `vars` before it:

   ```jsonc
   "routes": [{ "pattern": "admin.stackprints.com", "custom_domain": true }]
   ```

4. Commit and push (or deploy by hand as in step 6). Cloudflare creates the DNS records and certificates.
5. Edit the OAuth App: Homepage URL `https://admin.stackprints.com`, callback URL `https://admin.stackprints.com/callback`.
6. Set `vars.SITE_URL` in `wrangler.admin.jsonc` back to `https://stackprints.com` if you changed it.

The public MCP Worker needs no domain: the site forwards `stackprints.com/mcp` to it. `wrangler.public.jsonc` shows how to give it a host of its own, such as `mcp.stackprints.com`.

Sign-ins are tied to the host: a token issued on the `workers.dev` URL is refused on `admin.stackprints.com`. Reconnect your clients after moving.

## 8. Connect your agents

The admin endpoint is `https://admin.stackprints.com/mcp` (or the `workers.dev` URL plus `/mcp`). `GET /` on the admin Worker prints these instructions too.

**claude.ai and Claude Desktop** sign in with GitHub:

1. Settings, Connectors, Add custom connector. Name: `Stackprints admin`. URL: the admin endpoint.
2. Connect. The server's own consent page shows what the connector asks for: `content:read` (always), `content:write` and `content:publish`. Untick `content:publish` if this connector should only open pull requests.
3. Allow and sign in with GitHub. Only accounts on `ADMIN_GITHUB_IDS` get through.

claude.ai doesn't ask for `keys:manage`, so API keys are minted with an API key (below).

**The first API key.** Agents without a sign-in, such as Claude Code with a header or a scheduled job, use API keys (`spk_…`). The first one is minted with a one-time bootstrap secret, which works only while no API key exists:

```bash
openssl rand -hex 32          # copy the output
npx wrangler secret put BOOTSTRAP_KEY -c wrangler.admin.jsonc    # paste it
claude mcp add --scope user --transport http stackprints-bootstrap https://admin.stackprints.com/mcp \
  --header "Authorization: Bearer <the value you pasted>"
```

In Claude Code, ask it to call `whoami` (it should say you are signed in with the bootstrap key), then `create_api_key` with a name such as `claude-code on my Mac` and the scopes `content:publish` and `keys:manage` (publishing implies writing and reading). The key is shown once: copy it. Then remove the bootstrap path:

```bash
claude mcp remove stackprints-bootstrap --scope user
npx wrangler secret delete BOOTSTRAP_KEY -c wrangler.admin.jsonc
```

The secret stops working the moment a key exists, but delete it anyway.

**Claude Code** with an API key (`--scope user` makes it available in every project; leave it out for this project only):

```bash
claude mcp add --scope user --transport http stackprints-admin https://admin.stackprints.com/mcp \
  --header "Authorization: Bearer spk_..."
```

To share the setup in a repository without sharing the key, put this in `.mcp.json` and set `STACKPRINTS_ADMIN_KEY` in each machine's environment:

```json
{
  "mcpServers": {
    "stackprints-admin": {
      "type": "http",
      "url": "https://admin.stackprints.com/mcp",
      "headers": { "Authorization": "Bearer ${STACKPRINTS_ADMIN_KEY}" }
    }
  }
}
```

Claude Code can also sign in with GitHub instead: add the server without `--header`, then run `/mcp` and choose to authenticate.

**More keys.** From an agent holding `keys:manage`, call `create_api_key` with a name and the narrowest scopes the agent needs: `content:read` for research only, `content:write` to submit pull requests, `content:publish` to publish straight to `main`. A key can only grant scopes its creator holds. `list_api_keys` shows them with when each was last used, and `revoke_api_key` revokes one along with every key it minted.

**Any other MCP client**: Streamable HTTP at the endpoint above, with `Authorization: Bearer spk_…` on every request, or OAuth 2.1 sign-in. The OAuth metadata is at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`; clients register dynamically at `/oauth/register` or with a Client ID Metadata Document.

**The public server** needs no setup on the client's side:

```bash
claude mcp add --transport http stackprints https://stackprints.com/mcp
```

## 9. The local servers on this machine

Both servers also run over stdio from this checkout, with no Cloudflare and no keys.

```bash
(cd .. && npm run build)   # the catalogue tools read out/api
npm ci
npm run build:local        # writes dist/admin.mjs and dist/public.mjs
```

Add them to Claude Code with `.mcp.json` at the repository root (paths are relative to where Claude Code starts; use absolute paths if your client starts elsewhere):

```json
{
  "mcpServers": {
    "stackprints": { "command": "node", "args": ["mcp/dist/public.mjs"] },
    "stackprints-admin": { "command": "node", "args": ["mcp/dist/admin.mjs"] }
  }
}
```

Or: `claude mcp add stackprints-admin -- node /path/to/stackprints/mcp/dist/admin.mjs`.

What the local admin server does:

- The same tools as the admin Worker, except the API key tools.
- It reads and writes this checkout with git. A publish is a commit on the checked-out branch; push it yourself. A pull request is a `bot/…` branch pushed to `origin` and opened with `gh pr create`; without an `origin` the branch stays local and the answer says what to run.
- It never overwrites a file you are editing, and a commit you make meanwhile is never lost: the publish lands on top of it.
- `list_corrections` reads issues through `gh`.
- Its state (changesets, receipts, the audit log) is in `.stackprints/admin-state.json`, which git ignores. There are no daily limits.
- Environment: `STACKPRINTS_ROOT` (the checkout; found from the working directory by default), `STACKPRINTS_SCOPES` (comma-separated; default `content:read,content:write,content:publish`), `STACKPRINTS_STATE`, `STACKPRINTS_SITE_URL`, `X_BEARER_TOKEN`.

The local public server answers from `out/` and from the working tree, uncommitted drafts included; set `STACKPRINTS_FILES=head` to read the last commit instead. Rebuild with `npm run build:local` after pulling changes to `mcp/`.

## 10. The X API (optional)

`search_x` measures how much X talks about a product, for the hot list ([docs/HOT.md](../docs/HOT.md)). It calls the X API's recent search, which needs a paid access tier; check X's current pricing.

1. https://developer.x.com, create a project and an app, and copy its **Bearer Token**.
2. `npx wrangler secret put X_BEARER_TOKEN -c wrangler.admin.jsonc`. For the local server, set `X_BEARER_TOKEN` in its environment (the `env` field of its `.mcp.json` entry).

Without it, `search_x` says so and agents fall back to web search: `fetch_source` reads x.com posts through a public mirror.

## 11. Check that it works

```bash
curl -s https://admin.stackprints.com/                     # markdown: what the server is and how to connect
curl -si -X POST https://admin.stackprints.com/mcp | head -1   # HTTP/2 401: a credential is needed
curl -s https://admin.stackprints.com/.well-known/oauth-protected-resource/mcp
curl -si https://stackprints.com/ -H 'Accept: text/markdown' | head -5   # the site's markdown twin
```

Then, in an agent connected to the admin server, a dry run that writes nothing to the repository:

1. `whoami`: your name, scopes, today's date and `main`'s head.
2. `get_freshness_report`, then `list_stale` with kind `news` and limit 1.
3. `open_changeset` with kind `news` and title `dry run`.
4. `fetch_source` on a recent article about that option.
5. `propose_news` for that option, with the article as an item (or `items: []`).
6. `validate_changeset`: `ok` should be true and `willPublish` should match your scopes.
7. `close_changeset` with reason `dry run`. Nothing was committed.
8. `get_audit_log` shows each step.

And in an agent connected to the public server: ask it to search Stackprints for "sandbox".

## 12. Troubleshooting

**401 on `/mcp`.** The request has no credential or a bad one. Check the `Authorization: Bearer` header, and that the key wasn't revoked, directly or through the key that minted it. Keys a GitHub account minted stop working when its id leaves `ADMIN_GITHUB_IDS`. `BOOTSTRAP_KEY` is ignored when shorter than 32 characters and refused once any key exists. `npx wrangler tail -c wrangler.admin.jsonc` shows the Worker's warnings live.

**403 "no longer grants access".** The GitHub account behind a sign-in is no longer on `ADMIN_GITHUB_IDS`. Removing an id locks it out at once, whatever tokens its clients hold.

**429.** Too many sign-ins, token requests or failed authentications from one address (30 a minute). Wait a minute.

**Sign-in ends on GitHub with a redirect_uri error.** The OAuth App's callback URL must be exactly `<admin origin>/callback` for the host you connected to. Sign-in that comes back "not allowed on this server" names the account and its id: add the id to `ADMIN_GITHUB_IDS` and deploy.

**The deploy fails on a KV or D1 id.** An id in `wrangler.admin.jsonc` is still a placeholder, or belongs to another account. `npx wrangler kv namespace list` and `npx wrangler d1 list` show the real ones.

**"no such table: state".** The migration wasn't applied to the remote database: `npx wrangler d1 migrations apply stackprints-admin --remote -c wrangler.admin.jsonc`.

**Submits don't publish.** A caller without `content:publish` (`whoami` shows its scopes), or a changeset with a claim marked manual, opens a pull request instead. When `main` is protected, a publish is refused and the answer says to submit again with mode `pr`: give the token's account a bypass in the ruleset, or keep reviewing pull requests.

**Submits fail with a GitHub 401 or 403.** The `GITHUB_TOKEN` expired or lacks a permission from step 4. Make a new one and `npx wrangler secret put GITHUB_TOKEN -c wrangler.admin.jsonc`. A failed submit can be retried as it is: it finds what an earlier try wrote.

**The deploy didn't run.** Check the Actions tab. The deploy step prints "No CLOUDFLARE_API_TOKEN secret: skipping deploy." without the secret. A newer push cancels an older deploy, so only the last commit deploys. `npm run check` gates the deploy: a commit that fails it isn't deployed, so fix it with another commit (or `revert_commit`). An "Authentication error" from wrangler means the API token lacks a permission from step 6.

**`stackprints.com/mcp` answers 404.** The site Worker has no `MCP` service binding: deploy `stackprints-mcp` first, then the site again.

**The catalogue tools show old data.** On the admin server they read the live site, which changes when a deploy finishes. `get_item` reads `main` itself.

## Develop

```bash
npm run typecheck
npm test                 # vitest; CI also runs npm run bundle first, after npm run build at the root
cp .dev.vars.example .dev.vars    # then fill it in
npx wrangler d1 migrations apply stackprints-admin --local -c wrangler.admin.jsonc
npm run dev:admin        # http://localhost:8787
npm run dev:public -- --port 8788
```

## How a change reaches the site

1. An agent opens a changeset, reads its sources with `fetch_source`, proposes changes and runs `validate_changeset`. Nothing is in the repository yet.
2. `submit_changeset` runs the checks again on `main` with the changes on top.
   - With `content:publish` and no claim marked manual, it writes one commit on `main` through GitHub's API. The message names the agent and the changeset.
   - Otherwise it pushes a `bot/<kind>/<changeset>` branch and opens a pull request. `check.yml` runs on it, and you merge it on GitHub.
3. The push to `main` starts `deploy.yml`: `npm run check`, the site build, the typecheck, then the public MCP Worker (with a fresh bundle of the content), the site and the admin Worker. The change is live a few minutes after the commit.
4. `history` lists what was published, and `revert_commit` undoes a publish with a new commit, which deploys the same way.
