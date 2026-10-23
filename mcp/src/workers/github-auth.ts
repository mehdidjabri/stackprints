// Signing in to the admin Worker from claude.ai or any other OAuth client: our consent page first,
// then GitHub as the identity, then a grant for allowlisted GitHub accounts only, by numeric id (a
// login can be renamed and then claimed by someone else; an id never changes). The flow follows
// workers-oauth-provider's docs/consent-page.md and docs/upstream-sign-in.md: the consent form can't
// be framed or forged (a handle bound to the browser), GitHub's `state` exists only after consent and
// is bound to the same browser, and the authorization request is always recovered from storage.
// GitHub's token is used once, to learn who signed in, and revoked; nothing of it is kept.
import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import { SCOPES, type Scope } from "../core/types";

export type AuthEnv = {
  /** Set by OAuthProvider before it calls the default handler. */
  OAUTH_PROVIDER?: OAuthHelpers;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  /** Comma-separated numeric GitHub user ids allowed to sign in. */
  ADMIN_GITHUB_IDS: string;
};

export const SCOPE_TEXT: Record<Scope | "offline_access", string> = {
  "content:read": "Read all content and the audit log, fetch sources and search X",
  "content:write": "Open changesets and propose changes, submitted as pull requests",
  "content:publish": "Publish checked changes straight to main, and revert them",
  "keys:manage": "Create, list and revoke API keys for other agents",
  offline_access: "Stay connected without signing in again (up to 30 days)",
};

/** Everything the consent page may grant. */
export const GRANTABLE = [...SCOPES, "offline_access"] as const;
type Grantable = (typeof GRANTABLE)[number];

/**
 * What a client is told to ask for (the 401 challenge and the resource metadata) and what the consent
 * page offers even when it wasn't asked. claude.ai asks for exactly these, so they are what the
 * owner's connector can get: with reading alone it could research but never write. keys:manage is not
 * among them: a client gets it only by asking for it, and the owner ticking it.
 */
export const REQUIRED_SCOPES: Scope[] = ["content:read", "content:write", "content:publish"];

/** The numeric ids in a comma-separated list; anything else in it (a login, say) lets nobody in. */
export const allowedIds = (list: string | undefined) =>
  new Set(
    (list ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => /^\d+$/.test(l)),
  );

/** An empty allowlist lets nobody in. */
export const isAllowedId = (id: number | string | undefined, list: string | undefined) => id !== undefined && allowedIds(list).has(String(id).trim());

/** The scopes a consent grants: what was ticked, within what the client asked for or REQUIRED_SCOPES offers; reading always. */
export function grantedScopes(ticked: Iterable<string>, requested: Iterable<string>): Grantable[] {
  const t = new Set(ticked);
  const offered = new Set<string>([...requested, ...REQUIRED_SCOPES]);
  return GRANTABLE.filter((s) => s === "content:read" || (t.has(s) && offered.has(s)));
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string, status = 200, headers = new Headers()) => {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#111;background:#fff}label{display:block;margin:.4rem 0}small{color:#555}button{font:inherit;padding:.4rem 1rem;margin-right:.5rem}@media(prefers-color-scheme:dark){body{color:#eee;background:#111}small{color:#aaa}}</style>${body}`,
    { status, headers },
  );
};

const problem = (message: string, status = 400) => page("Sign-in problem", `<h1>Sign-in problem</h1><p>${escape(message)}</p><p>Start again from your app.</p>`, status);

/** What the user is asked: which app, where the access goes, and which scopes, every client-sent string escaped. */
export function consentPage(details: ConsentDescription, handle: string) {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  // Shown: what the client asked for, plus REQUIRED_SCOPES (so keys:manage and offline_access only
  // when asked for). Ticked: only what it asked for, and never keys:manage.
  const asked = new Set(details.scope);
  const shown = GRANTABLE.filter((s) => asked.has(s) || (REQUIRED_SCOPES as string[]).includes(s));
  const rows = shown.map((s) =>
    s === "content:read"
      ? `<input type="hidden" name="scope" value="content:read"><label><input type="checkbox" checked disabled> ${escape(s)} <small>${escape(SCOPE_TEXT[s])} (always)</small></label>`
      : `<label><input type="checkbox" name="scope" value="${escape(s)}"${asked.has(s) && s !== "keys:manage" ? " checked" : ""}> ${escape(s)} <small>${escape(SCOPE_TEXT[s])}</small></label>`,
  );
  return `<h1>Allow ${name} to use Stackprints admin?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>" : ""}
<p>Next you sign in with GitHub. Only the GitHub accounts this server allows can finish.</p>
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
${rows.join("\n")}
<p><button name="decision" value="approve">Allow and sign in with GitHub</button><button name="decision" value="deny">Deny</button></p>
</form>`;
}

const helpers = (env: AuthEnv) => {
  if (!env.OAUTH_PROVIDER) throw new Error("OAUTH_PROVIDER is missing: the default handler must run behind OAuthProvider");
  return env.OAUTH_PROVIDER;
};

/** Where GitHub sends the browser back: registered as the OAuth App's callback URL. */
export const callbackUrl = (request: Request) => new URL("/callback", request.url).href;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function s256(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** GET /authorize shows the consent page; POST /authorize takes the decision and hands over to GitHub. */
export async function authorize(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = helpers(env);
  try {
    if (request.method === "GET") {
      const auth = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(auth); // first: a failed lookup leaves nothing in KV
      const consent = await oauth.beginConsent(auth);
      return page(`Authorize ${details.clientName}`, consentPage(details, consent.handle), 200, consent.headers);
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });

    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    // Approved as requested, then narrowed: the stored request is the only trustworthy record of what was asked.
    const approved = await oauth.approveConsent(request, handle);
    const scope = grantedScopes(form.getAll("scope").map(String), approved.request.scope);
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const { state, headers } = await oauth.beginUpstream({ ...approved.request, scope }, { data: { verifier }, headers: approved.headers });
    const github = new URL("https://github.com/login/oauth/authorize");
    github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    github.searchParams.set("redirect_uri", callbackUrl(request));
    // No scope: the public profile is all it reads.
    github.searchParams.set("scope", "");
    github.searchParams.set("state", state);
    github.searchParams.set("code_challenge", await s256(verifier));
    github.searchParams.set("code_challenge_method", "S256");
    github.searchParams.set("allow_signup", "false");
    headers.set("Location", github.href);
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return authError(e);
  }
}

/** GET /callback: GitHub's answer. Recovers the approved request, learns who signed in, and grants it if their id is allowed. */
export async function callback(request: Request, env: AuthEnv, doFetch: typeof fetch = (i, init) => fetch(i, init)): Promise<Response> {
  const oauth = helpers(env);
  try {
    const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
    const back = (code: "access_denied" | "server_error", description: string) => {
      headers.set("Location", authorizationErrorRedirect(original, code, description));
      return new Response(null, { status: 302, headers });
    };
    const params = new URL(request.url).searchParams;
    if (params.get("error")) return back("access_denied", "GitHub sign-in was declined");
    const code = params.get("code");
    if (!code) return back("access_denied", "GitHub sent no code");

    let user: { id: number; login: string };
    try {
      const token = await exchangeCode(doFetch, env, code, data.verifier, callbackUrl(request));
      user = await githubUser(doFetch, token);
      await revoke(doFetch, env, token);
    } catch (e) {
      return back("server_error", `GitHub sign-in failed: ${(e as Error).message}`);
    }
    if (!isAllowedId(user.id, env.ADMIN_GITHUB_IDS)) return back("access_denied", `GitHub user ${user.login} (id ${user.id}) is not allowed on this server`);

    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      // The numeric id survives a login rename; the login is what commits and the audit log show.
      userId: `github-${user.id}`,
      metadata: { login: user.login },
      scope: original.scope,
      props: { name: user.login, kind: "github", login: user.login, githubId: user.id, scopes: [...SCOPES] },
    });
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return authError(e);
  }
}

function authError(e: unknown) {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError) return problem(e.description || "This sign-in expired, was already used, or was opened in another browser.");
  if (e instanceof CimdFetchError) return problem("This app could not be verified.");
  throw e;
}

async function exchangeCode(doFetch: typeof fetch, env: AuthEnv, code: string, verifier: string, redirectUri: string) {
  const res = await doFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "stackprints-admin" },
    body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri, code_verifier: verifier }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.error || `token exchange answered ${res.status}`);
  return body.access_token;
}

async function githubUser(doFetch: typeof fetch, token: string) {
  const res = await doFetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "stackprints-admin" },
  });
  const user = (await res.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
  if (!res.ok || typeof user.id !== "number" || typeof user.login !== "string") throw new Error(`reading the GitHub user answered ${res.status}`);
  return { id: user.id, login: user.login };
}

/** Best effort: the token did its one job. */
async function revoke(doFetch: typeof fetch, env: AuthEnv, token: string) {
  await doFetch(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/token`, {
    method: "DELETE",
    headers: {
      authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "stackprints-admin",
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => {});
}
