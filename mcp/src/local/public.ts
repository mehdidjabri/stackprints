// The public MCP server over stdio, answering from this checkout: the catalogue tools read the API
// `npm run build` wrote to out/, and validation and submissions read content/ and docs/ from the
// working tree (uncommitted drafts included), or from the last commit with STACKPRINTS_FILES=head.
// stdout carries the protocol, so everything else goes to stderr.
//
//   claude mcp add stackprints -- node /path/to/stackprints/mcp/dist/public.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { PublicDeps } from "../core/deps";
import { createPublicServer } from "../servers/public";
import { FsStore, runCommand } from "../stores/fs";
import { DirApi, findRoot, githubUrl, isMain, worktreeFiles } from "./dir-api";

const log = (message: string) => console.error(`stackprints: ${message}`);

export async function localPublicDeps(env: NodeJS.ProcessEnv = process.env): Promise<PublicDeps & { root: string; source: "worktree" | "head" }> {
  const root = findRoot([process.cwd(), path.dirname(fileURLToPath(import.meta.url))], env.STACKPRINTS_ROOT);
  const source = env.STACKPRINTS_FILES === "head" ? "head" : "worktree";
  const remote = await runCommand("git", ["remote", "get-url", "origin"], root).then(
    (b) => githubUrl(b.toString("utf8")),
    () => undefined,
  );
  const store = source === "head" ? new FsStore({ root, log }) : undefined;
  return {
    root,
    source,
    api: new DirApi(path.join(root, "out")),
    files: () => (store ? store.files() : worktreeFiles(root)),
    now: Date.now,
    siteUrl: (env.STACKPRINTS_SITE_URL || "https://stackprints.com").replace(/\/$/, ""),
    repo: remote ?? "https://github.com/mehdidjabri/stackprints",
    fetch: globalThis.fetch,
  };
}

async function main() {
  const deps = await localPublicDeps();
  const api = deps.api as DirApi;
  log(`serving ${deps.root}, content from ${deps.source === "head" ? "the last commit" : "the working tree"}`);
  if (!api.exists()) log(`no ${api.outDir}/api: the catalogue tools return nothing until \`npm run build\` at the repo root`);
  serveStdio(() => createPublicServer(deps), { onerror: (e) => log(`error: ${e.message}`) });
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    log((e as Error).message);
    process.exit(1);
  });
}
