// Shapes shared by both MCP servers. Content types come from the site, so a field added there is
// a field the servers see.
export type { Hot, HotItem, Layer, News, NewsItem, Option, Prompt, Stack } from "../../../lib/types";

/** Repo-relative path ("content/layers.json", "docs/RESEARCH.md") to its text. */
export type Files = Map<string, string>;

/**
 * What a caller may do on the admin server:
 * - content:read: every read tool, fetch_source and search_x;
 * - content:write: open changesets and propose changes, submitted as a pull request;
 * - content:publish: submit straight to main once every check passes, and revert;
 * - keys:manage: mint, list and revoke API keys for other agents.
 */
export type Scope = "content:read" | "content:write" | "content:publish" | "keys:manage";
export const SCOPES: Scope[] = ["content:read", "content:write", "content:publish", "keys:manage"];

/** Who is calling: signed in with GitHub, holding an API key, or the local server on this machine. */
export type Principal = {
  /** Shown in commits and the audit log: a GitHub login or an API key's name. */
  name: string;
  kind: "github" | "apikey" | "local";
  login?: string;
  /** GitHub's numeric user id: logins can be renamed and re-registered, ids can't. */
  githubId?: number;
  keyId?: string;
  scopes: Scope[];
};

export const can = (p: Principal, scope: Scope) => p.scopes.includes(scope);

/** A stable id for whoever is calling: what changesets and API keys record as their owner. */
export const principalId = (p: Principal) =>
  p.kind === "apikey" ? `key:${p.keyId}` : p.kind === "github" ? `github:${p.githubId ?? p.login}` : `local:${p.name}`;
