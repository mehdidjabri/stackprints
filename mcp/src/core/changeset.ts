// A changeset collects one unit of work (a news run, a new option, this week's hot list) before it
// is checked and written. It lives in state until it is submitted or closed, and belongs to whoever
// opened it: only they add to it or submit it. Every change to it is one atomic state.update, so
// subagents proposing at once each land, and a proposal that raced another on the same file is
// refused and recomputed instead of overwriting it.
import { validateContent } from "../../../lib/validate.mjs";
import { sha256Hex } from "./auth";
import type { StateStore } from "./state";
import { type Changes, WRITABLE } from "./store";
import { ToolError } from "./tool";
import { type Files, type Principal, can, principalId } from "./types";

export type ChangesetKind = "news" | "option" | "stack" | "hot" | "prompt" | "logo" | "mixed";

/** A claim that could not be checked by machine (PDF, paywall, script-only page): it is named in the commit and forces a pull request. */
export type ManualClaim = { field: string; url: string; reason: string };
/** A manual claim filed under the file whose change it backs: proposing that file again replaces it. */
export type ManualEntry = ManualClaim & { path: string };
/** A note the checks raised that doesn't block (a title that differs from the page), under its file. */
export type Note = { path: string; text: string };

export type SubmitMode = "publish" | "pr";

export type SubmitResult = {
  mode: SubmitMode;
  sha: string;
  url: string;
  number?: number;
  branch?: string;
  /** false when a pull request branch was kept but no pull request opened (the local store without a remote). */
  pushed?: boolean;
  note?: string;
  /** The commit the changes were written on top of: what revert_commit restores. */
  parentSha: string;
  /** Exactly the paths the commit wrote. */
  paths: string[];
  at: string;
};

export type Changeset = {
  id: string;
  kind: ChangesetKind;
  title: string;
  /** principalId of who opened it: only they propose into it or submit it. */
  owner: string;
  /** As shown in commits and lists. */
  author: { name: string; kind: Principal["kind"] };
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  /** submitting: frozen while a submit runs, and left so when it ended without an answer (submit again to finish). */
  status: "open" | "submitting" | "submitted" | "closed";
  /** Path to new text, or null to delete. */
  changes: Changes;
  /** One line per proposal, in order: what changed and from which sources. */
  log: string[];
  manual: ManualEntry[];
  warnings: Note[];
  /**
   * The submit in progress: `token` names the call running it; mode, base, paths and branch are what
   * it is about to write, recorded before the store is called, so a retry can find what landed.
   */
  submitting?: { token: string; startedAt: string; mode?: SubmitMode; branch?: string; base?: string; paths?: string[] };
  result?: SubmitResult;
  /** The commit that undid this one's publish. */
  revertedBy?: string;
};

const KEY = (id: string) => `changeset:${id}`;
const PUBLISHED = (sha: string) => `published:${sha}`;
const LAST_WRITE = "last-write";
/** An open changeset nobody touches for 14 days is dropped. */
export const OPEN_TTL = 14 * 86400;
/** Submitted and closed ones are kept 90 days, for list_changesets and revert_commit. */
export const KEPT_TTL = 90 * 86400;
const MAX = 9_999_999_999_999;
const PAGE = 100;

const iso = (t: number) => new Date(t).toISOString();

/** Ids sort newest first (the time counts down, as audit keys do), so a listing starts with the latest. */
export function newId(now: number) {
  const r = crypto.getRandomValues(new Uint8Array(4));
  return `${(MAX - now).toString(36).padStart(9, "0")}-${[...r].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function openChangeset(state: StateStore, input: { kind: ChangesetKind; title: string; principal: Principal; baseSha: string; now: number }) {
  const at = iso(input.now);
  const cs: Changeset = {
    id: newId(input.now),
    kind: input.kind,
    title: input.title,
    owner: principalId(input.principal),
    author: { name: input.principal.name, kind: input.principal.kind },
    baseSha: input.baseSha,
    createdAt: at,
    updatedAt: at,
    status: "open",
    changes: {},
    log: [],
    manual: [],
    warnings: [],
  };
  await state.put(KEY(cs.id), cs, { ttlSeconds: OPEN_TTL });
  return cs;
}

export const loadChangeset = (state: StateStore, id: string) => state.get<Changeset>(KEY(id));

export const isOwner = (cs: Pick<Changeset, "owner">, p: Principal) => cs.owner === principalId(p);

const MISSING = (id: string) =>
  new ToolError(`No changeset "${id}": it may have expired (an open changeset nobody touches for 14 days is dropped). Open one with open_changeset; list_changesets shows the open ones.`);

/**
 * Who may do what: the owner proposes and submits; closing (abandoning) is also open to a
 * content:publish principal, which never adds to or submits another's changeset.
 */
export function checkAccess(cs: Changeset, p: Principal, access: "owner" | "close" = "owner") {
  if (isOwner(cs, p) || (access === "close" && can(p, "content:publish"))) return;
  const who = `${cs.author.name} (${cs.author.kind})`;
  throw new ToolError(
    access === "close"
      ? `Only ${who}, who opened changeset ${cs.id}, or a principal with content:publish can close it.`
      : `Changeset ${cs.id} belongs to ${who}: only its owner adds to it or submits it. Open your own with open_changeset.`,
  );
}

/** Why a changeset in the wrong status can't take what was asked, and what to do instead. */
export function statusError(cs: Pick<Changeset, "id" | "status" | "result">) {
  const where = cs.result ? ` (${cs.result.url})` : "";
  const hint = cs.status === "submitting" ? "a submit of it started and did not finish: call submit_changeset again to finish it, or close_changeset" : "open a new one with open_changeset";
  return new ToolError(`Changeset ${cs.id} is ${cs.status}${where}: ${hint}.`);
}

export type MutateOptions = {
  /** The statuses the change may start from; default open only. */
  status?: Changeset["status"][];
  access?: "owner" | "close";
  /** How long the result is kept: OPEN_TTL (the default) for an open changeset, KEPT_TTL once it leaves open. */
  ttlSeconds?: number;
  now?: number;
};

/**
 * Changes a changeset in one atomic step, after checking it exists, is open (or in `status`) and the
 * caller may change it. `fn` edits the changeset in place (or returns a replacement) and may throw
 * to change nothing; it can run more than once when another write lands in between. Returns the
 * changeset as written.
 */
/** A changeset is one D1 row (2 MB at most), staged files and all. */
const MAX_BYTES = 1_500_000;

export async function mutate(state: StateStore, id: string, principal: Principal, fn: (cs: Changeset) => Changeset | void, options: MutateOptions = {}) {
  const allowed = options.status ?? ["open"];
  const written = await state.update<Changeset>(
    KEY(id),
    (cur) => {
      if (!cur) throw MISSING(id);
      if (!allowed.includes(cur.status)) throw statusError(cur);
      checkAccess(cur, principal, options.access);
      const next = fn(cur) ?? cur;
      next.updatedAt = iso(options.now ?? Date.now());
      if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_BYTES)
        throw new ToolError(`Changeset ${id} would grow past ${MAX_BYTES / 1e6} MB: submit it, then open another for the rest.`);
      return next;
    },
    { ttlSeconds: options.ttlSeconds ?? OPEN_TTL },
  );
  return written as Changeset;
}

/** A page of changesets, newest first, read in pages of entries (one query each), with a status filter. */
export async function listChangesets(state: StateStore, options: { status?: Changeset["status"]; limit?: number; cursor?: string } = {}) {
  const limit = Math.max(1, options.limit ?? 50);
  const out: Changeset[] = [];
  let cursor = options.cursor;
  for (;;) {
    const page = await state.entries<Changeset>("changeset:", { limit: PAGE, cursor });
    for (const [i, [k, cs]] of page.entries.entries()) {
      if (!options.status || cs.status === options.status) out.push(cs);
      if (out.length === limit) {
        const more = i < page.entries.length - 1 || page.cursor !== undefined;
        return { changesets: out, ...(more ? { cursor: k } : {}) };
      }
    }
    if (!page.cursor) return { changesets: out };
    cursor = page.cursor;
  }
}

/** The repository's files with a changeset's changes on top. */
export function overlay(base: Files, changes: Changes): Files {
  const out = new Map(base);
  for (const [p, t] of Object.entries(changes)) {
    if (t === null) out.delete(p);
    else out.set(p, t);
  }
  return out;
}

/** Records a file change in an open changeset. Only content paths can be written. */
export function stage(cs: Changeset, path: string, text: string | null) {
  if (cs.status !== "open") throw statusError(cs);
  if (!WRITABLE.test(path)) throw new ToolError(`${path} is not a content path this server may write.`);
  cs.changes[path] = text;
}

/** A file's version as get_item reports it and expectedVersion names it: the SHA-256 of its text, or "absent". */
export const versionOf = async (text: string | null | undefined) => (text == null ? "absent" : sha256Hex(text));

export type DiffRow = { path: string; change: "added" | "modified" | "deleted" | "unchanged" };

export function diff(base: Files, changes: Changes): DiffRow[] {
  return Object.entries(changes)
    .map(([path, t]): DiffRow => ({
      path,
      change: t === null ? (base.has(path) ? "deleted" : "unchanged") : !base.has(path) ? "added" : base.get(path) === t ? "unchanged" : "modified",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The same checks as `npm run check`, on the repository with the changes applied.
 * Errors already present on the base are reported apart, so a changeset is judged by what it adds;
 * but content the validator can't read at all is never ok, since then nothing else was checked.
 */
export function check(base: Files, changes: Changes, now: number) {
  const run = (files: Files) => {
    try {
      return validateContent(files, { now });
    } catch (e) {
      return { errors: [`content could not be read, so nothing else was checked: ${(e as Error).message}`], warnings: [], counts: null };
    }
  };
  const before = run(base);
  const after = run(overlay(base, changes));
  if (after.counts === null) return { ok: false, errors: after.errors, preexisting: [], warnings: after.warnings, counts: null };
  const had = new Set(before.errors);
  return {
    ok: after.errors.every((e) => had.has(e)),
    errors: after.errors.filter((e) => !had.has(e)),
    preexisting: after.errors.filter((e) => had.has(e)),
    warnings: after.warnings,
    counts: after.counts,
  };
}

// ---- what a submit leaves behind ------------------------------------------------------------------

/** Marks a published changeset as undone by `sha`, whoever reverted it. */
export async function markReverted(state: StateStore, id: string, sha: string, now: number) {
  await state.update<Changeset>(KEY(id), (cs) => (cs ? { ...cs, revertedBy: sha, updatedAt: iso(now) } : null), { ttlSeconds: KEPT_TTL });
}

/** Which changeset a publish came from, so revert_commit finds it by sha (a prefix works too). */
export const recordPublished = (state: StateStore, sha: string, id: string) => state.put(PUBLISHED(sha), id, { ttlSeconds: KEPT_TTL });

/** The changeset ids published as commits whose sha starts with `sha`: one, or several for a short prefix. */
export async function publishedBy(state: StateStore, sha: string) {
  const { entries } = await state.entries<string>(PUBLISHED(sha.toLowerCase()), { limit: 2 });
  return entries.map(([k, id]) => ({ sha: k.slice(PUBLISHED("").length), id }));
}

export type LastWrite = { at: string; tool: string; who: string; mode: SubmitMode; sha: string; url: string; changeset?: string };

/** Notes the newest write, so the freshness report reads one key instead of scanning the audit log. */
export async function recordLastWrite(state: StateStore, w: LastWrite) {
  await state.update<LastWrite>(LAST_WRITE, (cur) => (cur && cur.at > w.at ? cur : w)).catch(() => {});
}

export const lastWrite = (state: StateStore) => state.get<LastWrite>(LAST_WRITE);
