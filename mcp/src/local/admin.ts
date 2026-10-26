// The admin MCP server on the maintainer's own machine, over stdio: the same tools as the admin
// Worker, writing to this checkout with git instead of GitHub's API. A publish is a commit on the
// checked-out branch (push it yourself); a pull request is a pushed bot/* branch and `gh pr create`.
// stdout carries the protocol, so everything else goes to stderr.
//
//   claude mcp add stackprints-admin -- node /path/to/stackprints/mcp/dist/admin.mjs
//
// Environment: STACKPRINTS_ROOT (the checkout; default: found from the working directory or this
// file), STACKPRINTS_SCOPES (comma-separated; default content:read, content:write and content:publish;
// keys:manage does nothing here, since no server reads keys from this machine), STACKPRINTS_STATE (the
// state file; default <root>/.stackprints/admin-state.json), STACKPRINTS_SITE_URL, X_BEARER_TOKEN
// (for search_x).
import dns from "node:dns/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { parseScopes } from "../core/auth";
import type { AdminDeps } from "../core/deps";
import { createFetchPage } from "../core/fetch-source";
import { FileState } from "../core/file-state";
import type { Principal, Scope } from "../core/types";
import { createSearchX } from "../core/x";
import { createAdminServer } from "../servers/admin";
import { FsStore, runCommand } from "../stores/fs";
import { DirApi, findRoot, githubUrl, isMain } from "./dir-api";

const DEFAULT_SITE = "https://stackprints.com";
const DEFAULT_REPO = "https://github.com/mehdidjabri/stackprints";
/** API keys minted here would live in this machine's state file, which no server reads keys from. */
const DEFAULT_SCOPES: Scope[] = ["content:read", "content:write", "content:publish"];

const log = (message: string) => console.error(`stackprints-admin: ${message}`);

async function git(root: string, args: string[]) {
  try {
    return (await runCommand("git", args, root)).toString("utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function localAdminDeps(env: NodeJS.ProcessEnv = process.env): Promise<AdminDeps & { root: string; hasOrigin: boolean; remoteUrl?: string }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findRoot([process.cwd(), here], env.STACKPRINTS_ROOT);
  const origin = await git(root, ["remote", "get-url", "origin"]);
  const remoteUrl = githubUrl(origin ?? "");
  const user = (await git(root, ["config", "user.name"])) ?? os.userInfo().username;
  const scopes = env.STACKPRINTS_SCOPES ? parseScopes(env.STACKPRINTS_SCOPES.split(",").map((s) => s.trim()).filter(Boolean)) : [...DEFAULT_SCOPES];
  const principal: Principal = { name: `local:${user}`, kind: "local", scopes };
  const siteUrl = (env.STACKPRINTS_SITE_URL || DEFAULT_SITE).replace(/\/$/, "");
  const store = new FsStore({ root, remoteUrl, log });
  const state = new FileState(env.STACKPRINTS_STATE || path.join(root, ".stackprints", "admin-state.json"));
  return {
    root,
    hasOrigin: origin !== undefined,
    ...(remoteUrl ? { remoteUrl } : {}),
    api: new DirApi(path.join(root, "out")),
    files: () => store.files(),
    now: Date.now,
    siteUrl,
    repo: remoteUrl ?? DEFAULT_REPO,
    fetch: globalThis.fetch,
    store,
    state,
    principal,
    fetchPage: createFetchPage({
      fetch: globalThis.fetch,
      // Node has no global_fetch_strictly_public: refuse names that resolve to private addresses here.
      resolveHost: async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address),
      blockHosts: [new URL(siteUrl).hostname],
    }),
    searchX: env.X_BEARER_TOKEN ? createSearchX({ fetch: globalThis.fetch, bearer: env.X_BEARER_TOKEN }) : undefined,
  };
}

async function main() {
  const deps = await localAdminDeps();
  const api = deps.api as DirApi;
  log(`serving ${deps.root} as ${deps.principal.name} with ${deps.principal.scopes.join(", ") || "no scopes"}`);
  if (deps.principal.scopes.includes("keys:manage")) log("keys:manage does nothing here: API keys are minted on the admin Worker, which is what reads them");
  log(`publishes commits to the checked-out branch (now at ${(await deps.store.head()).slice(0, 7)})`);
  if (deps.hasOrigin) log(`pull requests: pushed to origin and opened with gh${deps.remoteUrl ? ` on ${deps.remoteUrl}` : " (origin is not on GitHub, so gh may refuse)"}`);
  else log("no origin remote: submitting with mode pr keeps a bot/* branch here and opens no pull request");
  if (!api.exists()) log(`no ${api.outDir}/api: the catalogue tools (search_stackprints, get_layer…) return nothing until \`npm run build\` at the repo root`);
  if (!deps.searchX) log("search_x is off: set X_BEARER_TOKEN to measure conversation on X");
  serveStdio(() => createAdminServer(deps), { onerror: (e) => log(`error: ${e.message}`) });
}

// Only when run as a program, so tests can import localAdminDeps.
if (isMain(import.meta.url)) {
  main().catch((e) => {
    log((e as Error).message);
    process.exit(1);
  });
}
