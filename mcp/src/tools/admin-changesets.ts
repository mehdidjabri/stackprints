// The admin server's write path: open a changeset, check it, and submit it, straight to main for a
// principal holding content:publish (the repository is the database) or as a pull request. Also
// reverts what this server published, and the API keys that let the owner's other agents in.
import { z } from "zod";
import { BOOTSTRAP_KEY_ID, canManageKey, listKeys, mintKey, parseScopes, revokeKey } from "../core/auth";
import {
  type Changeset,
  type ChangesetKind,
  KEPT_TTL,
  type ManualEntry,
  type Note,
  type SubmitMode,
  type SubmitResult,
  check,
  checkAccess,
  diff,
  isOwner,
  listChangesets,
  loadChangeset,
  markReverted,
  mutate,
  openChangeset,
  publishedBy,
  recordLastWrite,
  recordPublished,
  statusError,
} from "../core/changeset";
import type { AdminDeps } from "../core/deps";
import { manualLine } from "../core/sourcing";
import { type CommitResult, ConflictError, ProtectedBranchError, WRITABLE, WrongBranchError } from "../core/store";
import { READ_ONLY, ToolError, type ToolSpec, WRITE, tool } from "../core/tool";
import { type Files, type Principal, SCOPES, can } from "../core/types";

const KINDS = ["news", "option", "stack", "hot", "prompt", "logo", "mixed"] as const satisfies readonly ChangesetKind[];

const SUBJECT_MAX = 100;
/** How far back a retried publish looks on main for the commit an earlier try may have written. */
const RECOVER_DEPTH = 30;
// Control characters (newlines included) and bidi overrides: an agent's text must not add lines
// to a commit message, where it could pass for a trailer, or hide what it says.
const CONTROL = /[\p{Cc}​-‏‪-‮⁦-⁩]/gu;

export const oneLine = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const trailers = (p: Principal, extra: string[]) => [`Agent: ${oneLine(p.name)} (${p.kind})`, ...extra].join("\n");
const noteText = (n: Note) => `${n.path}: ${n.text}`;
const iso = (t: number) => new Date(t).toISOString();

type MessageSource = Pick<Changeset, "id" | "kind" | "title" | "log"> & { manual: ManualEntry[]; warnings: Note[]; author?: Changeset["author"] };

/**
 * The commit message for a changeset: the subject ('<kind>: <title>', or the first line of `message`),
 * then what was done (the log, claims a human must check, notes), then trailers naming the agent that
 * submitted it, its author when that is someone else, and the changeset. The body doubles as the pull
 * request description.
 */
export function commitMessage(cs: MessageSource, submitter: Principal, message?: string) {
  const [first = "", ...rest] = (message ?? "").split(/\r\n|\r|\n/);
  const subject = cut(oneLine(first) || `${cs.kind}: ${oneLine(cs.title)}`, SUBJECT_MAX);
  const paragraphs = [
    rest.map(oneLine).filter(Boolean),
    [...cs.log.map((l) => `- ${oneLine(l)}`), ...cs.manual.map((m) => oneLine(manualLine(m))), ...cs.warnings.map((w) => `Note: ${oneLine(noteText(w))}`)],
  ]
    .filter((lines) => lines.length)
    .map((lines) => lines.join("\n"));
  const author = cs.author && (cs.author.name !== submitter.name || cs.author.kind !== submitter.kind) ? [`Author: ${oneLine(cs.author.name)} (${cs.author.kind})`] : [];
  const body = [...paragraphs, trailers(submitter, [...author, `Changeset: ${cs.id}`])].join("\n\n");
  return { subject, body, full: `${subject}\n\n${body}` };
}

/** The staged paths whose text on main moved away from the base since, to something other than what the changeset proposes. */
export function movedPaths(then: Files, now: Files, changes: Changeset["changes"]) {
  return Object.entries(changes)
    .filter(([p, t]) => {
      const before = then.get(p) ?? null;
      const after = now.get(p) ?? null;
      return before !== after && after !== t;
    })
    .map(([p]) => p)
    .sort();
}

/** Whether a commit message's trailers name this changeset. */
const fromChangeset = (message: string, id: string) => (message.trim().split(/\n\s*\n/).at(-1) ?? "").split("\n").some((l) => l.trim() === `Changeset: ${id}`);

const MOVED = "main changed these files since the changeset was opened: close it, re-read with get_item and propose again";

/** What an agent should make of a submit's result. */
function outcome(r: SubmitResult) {
  if (r.mode === "publish") return "live on the site after the next deploy (a few minutes)";
  if (r.pushed === false) return r.note ?? `no pull request was opened: the branch ${r.branch} was kept locally`;
  return "waiting for review";
}

const answer = (r: SubmitResult) => ({
  mode: r.mode,
  url: r.url,
  sha: r.sha,
  ...(r.mode === "pr" ? { number: r.number, branch: r.branch, ...(r.pushed === false ? { pushed: false } : {}) } : {}),
  files: r.paths,
  note: outcome(r),
});

export function adminChangesetTools(deps: AdminDeps): ToolSpec[] {
  const { store, state, principal } = deps;
  const publisher = can(principal, "content:publish");

  const load = async (id: string) => {
    const cs = await loadChangeset(state, id);
    if (!cs) throw new ToolError(`No changeset ${id}: it may have expired (open changesets last 14 days untouched). list_changesets shows the open ones.`);
    return cs;
  };
  const loadOpen = async (id: string) => {
    const cs = await load(id);
    if (cs.status !== "open") throw statusError(cs);
    return cs;
  };

  // Where the changeset would land now: on main's head when nothing it touches moved there, else on
  // the commit it was opened on, together with the paths main changed under it.
  const landing = async (cs: Changeset) => {
    const head = await store.head();
    if (head === cs.baseSha) return { base: head, files: await store.files(head), moved: [] as string[] };
    const [then, now] = await Promise.all([store.files(cs.baseSha), store.files(head)]);
    const moved = movedPaths(then, now, cs.changes);
    return moved.length ? { base: cs.baseSha, files: then, moved } : { base: head, files: now, moved };
  };

  // The checks a submit runs, judged by what the changeset adds; staging nothing new is not ok.
  // Claims and notes on a file that ends up unchanged no longer say anything, so they drop out.
  const evaluate = (cs: Changeset, files: Files) => {
    const rows = diff(files, cs.changes);
    const r = check(files, cs.changes, deps.now());
    const changed = rows.filter((d) => d.change !== "unchanged").map((d) => d.path);
    const empty = Object.keys(cs.changes).length
      ? "nothing staged: every staged file already matches main"
      : "nothing staged: add changes with the propose_* tools first";
    return {
      ok: r.ok && changed.length > 0,
      errors: changed.length ? r.errors : [empty, ...r.errors],
      preexisting: r.preexisting,
      warnings: r.warnings,
      notes: cs.warnings.filter((n) => changed.includes(n.path)),
      manual: cs.manual.filter((m) => changed.includes(m.path)),
      diff: rows,
      changed,
    };
  };

  /** The commit on main an earlier try of this changeset's publish wrote, if one did. */
  const findPublished = async (id: string) => (await store.history(RECOVER_DEPTH)).find((c) => fromChangeset(c.message, id));

  /** Records a submit that went through: the changeset's result, the published index and the last write. */
  const finalize = async (id: string, record: SubmitResult, access: "owner" | "close" = "owner") => {
    if (record.mode === "publish") await recordPublished(state, record.sha, id);
    const cs = await mutate(
      state,
      id,
      principal,
      (c) => {
        c.status = "submitted";
        c.result = record;
        delete c.submitting;
      },
      { status: ["open", "submitting"], access, ttlSeconds: KEPT_TTL, now: deps.now() },
    );
    await recordLastWrite(state, { at: record.at, tool: "submit_changeset", who: principal.name, mode: record.mode, sha: record.sha, url: record.url, changeset: id });
    return cs;
  };

  /** A publish an earlier, unanswered submit wrote, recorded now; null when none landed. */
  const recover = async (cs: Changeset, access: "owner" | "close" = "owner") => {
    const s = cs.submitting;
    if (s?.mode !== "publish" || !s.base || !s.paths) return null;
    const landed = await findPublished(cs.id);
    if (!landed) return null;
    return finalize(cs.id, { mode: "publish", sha: landed.sha, url: landed.url, parentSha: s.base, paths: s.paths, at: iso(deps.now()) }, access);
  };

  const keyTools: ToolSpec[] = [
    tool({
      name: "create_api_key",
      title: "Create an API key",
      description:
        "Mints an API key for another of the owner's agents, with the scopes it may use: content:read (read tools), content:write (changesets, submitted as pull requests), content:publish (submit straight to main, revert), keys:manage (these key tools). " +
        "Writing implies reading and publishing implies writing. You can only grant scopes you hold. The key records who minted it: revoking your key revokes the keys it minted. The key is returned once and never again: hand it to the agent now.",
      input: z.object({
        name: z.string().trim().min(2).max(60).describe("Who will use it, e.g. 'news-run on the Mac mini'; shown in commits and the audit log"),
        scopes: z.array(z.enum(SCOPES)).min(1).describe("Scopes to grant"),
      }),
      scope: "keys:manage",
      annotations: WRITE,
      run: async ({ name, scopes }) => {
        let wanted: ReturnType<typeof parseScopes>;
        try {
          wanted = parseScopes(scopes);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const beyond = wanted.filter((s) => !can(principal, s));
        if (!canManageKey(principal, { scopes: wanted })) throw new ToolError(`You can't grant scopes you don't hold: ${beyond.join(", ")}.`, { held: principal.scopes });
        let made: Awaited<ReturnType<typeof mintKey>>;
        try {
          made = await mintKey(state, { name: oneLine(name), scopes: wanted, creator: principal, now: deps.now() });
        } catch (e) {
          throw new ToolError(`The key wasn't minted: ${(e as Error).message}.`);
        }
        const { key, record } = made;
        return {
          key,
          shownOnce: "This is the only time the key is shown; the server keeps its hash. Store it in the agent's secrets now.",
          id: record.id,
          name: record.name,
          scopes: record.scopes,
          how: "send it as Authorization: Bearer <key> to the admin MCP URL",
        };
      },
    }),

    tool({
      name: "list_api_keys",
      title: "List API keys",
      description:
        "Lists the API keys whose scopes you hold (the ones you could revoke): id, name, scopes, who created it and when, the key that minted it, and when it was last used (to the hour). The keys themselves are never shown. Also says whether the BOOTSTRAP_KEY secret still works (only while no key exists). revoke_api_key takes the id.",
      input: z.object({}),
      scope: "keys:manage",
      annotations: READ_ONLY,
      run: async () => {
        const all = await listKeys(state);
        const mine = all.filter((k) => canManageKey(principal, k));
        return {
          keys: mine.map((k) => ({
            id: k.id,
            name: k.name,
            scopes: k.scopes,
            createdAt: k.createdAt,
            createdBy: k.createdBy,
            ...(k.parentKeyId ? { mintedByKey: k.parentKeyId } : {}),
            ...(k.lastUsedAt ? { lastUsedAt: k.lastUsedAt } : {}),
          })),
          ...(all.length > mine.length ? { notShown: `${all.length - mine.length} keys with scopes you don't hold` } : {}),
          bootstrapKey: all.length
            ? "refused: API keys exist, so the BOOTSTRAP_KEY secret no longer works (delete it if it is still set)"
            : "accepted if the BOOTSTRAP_KEY secret is set, until the first key is minted: mint one, then delete the secret",
          ...(principal.keyId === BOOTSTRAP_KEY_ID ? { you: "you are signed in with the bootstrap key" } : {}),
        };
      },
    }),

    tool({
      name: "revoke_api_key",
      title: "Revoke an API key",
      description:
        "Revokes an API key by its id (from list_api_keys), and every key it minted, down the chain: the agents holding them lose access on their next call. You can only revoke keys whose scopes you hold. Returns the revoked id and name, and the keys revoked with it.",
      input: z.object({ id: z.string().min(1).describe("The key's id from list_api_keys") }),
      scope: "keys:manage",
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      run: async ({ id }) => {
        let r: Awaited<ReturnType<typeof revokeKey>>;
        try {
          r = await revokeKey(state, id, { by: principal, now: deps.now() });
        } catch (e) {
          throw new ToolError(`${(e as Error).message}.`);
        }
        if (!r) throw new ToolError(`No API key with id ${id}: list_api_keys shows the ids.`);
        return { revoked: id, name: r.revoked.name, ...(r.cascaded.length ? { alsoRevoked: r.cascaded.map((k) => ({ id: k.id, name: k.name })) } : {}) };
      },
    }),
  ];

  return [
    tool({
      name: "open_changeset",
      title: "Open a changeset",
      description:
        "Starts one unit of work (a news run, a new or corrected option, a stack, this week's hot list, a prompt, a logo) pinned to main's current commit, and returns its id. " +
        "Pass that id to the propose_* tools, then validate_changeset and submit_changeset. The changeset belongs to you (this connection): only you can propose into it and submit it. " +
        "Proposals land one at a time, so several calls can add to it at once without overwriting each other; give each subagent with its own connection its own changeset, or have " +
        "subagents report back and propose from one agent. Before proposing, fetch_source every page you will cite. Open changesets nobody touches for 14 days expire.",
      input: z.object({
        kind: z.enum(KINDS).describe("What the changeset changes: news, option, stack, hot, prompt, logo, or mixed for several kinds"),
        title: z.string().trim().min(3).max(SUBJECT_MAX).describe("A short summary; the commit subject becomes '<kind>: <title>'"),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: async ({ kind, title }) => {
        const cs = await openChangeset(state, { kind, title: oneLine(title), principal, baseSha: await store.head(), now: deps.now() });
        return { changeset: cs.id, baseSha: cs.baseSha, next: "fetch_source for every page you will cite, then propose_*" };
      },
    }),

    tool({
      name: "list_changesets",
      title: "List changesets",
      description:
        "Lists changesets, newest first: id, kind, title, author, mine (whether you own it and so may continue it), status (open, submitting, submitted, closed), when it was last updated, how many files it stages, and for a submitted one the commit or pull request it produced. " +
        "Use it to find your own open changeset to continue, or to check what was submitted. Pass the returned cursor for the next page. get_changeset shows one in full.",
      input: z.object({
        status: z.enum(["open", "submitting", "submitted", "closed"]).optional().describe("Only changesets with this status; all of them when left out"),
        limit: z.number().int().min(1).max(100).optional().describe("Changesets per page, default 30"),
        cursor: z.string().optional().describe("The cursor from the previous page"),
      }),
      scope: "content:read",
      annotations: READ_ONLY,
      run: async ({ status, limit, cursor }) => {
        const page = await listChangesets(state, { status, limit: limit ?? 30, cursor });
        return {
          changesets: page.changesets.map((cs) => ({
            id: cs.id,
            kind: cs.kind,
            title: cs.title,
            author: cs.author,
            mine: isOwner(cs, principal),
            status: cs.status,
            updatedAt: cs.updatedAt,
            files: Object.keys(cs.changes).length,
            ...(cs.result ? { result: { mode: cs.result.mode, sha: cs.result.sha, url: cs.result.url, ...(cs.result.number !== undefined ? { number: cs.result.number } : {}) } } : {}),
            ...(cs.revertedBy ? { revertedBy: cs.revertedBy } : {}),
          })),
          ...(page.cursor ? { cursor: page.cursor } : {}),
        };
      },
    }),

    tool({
      name: "get_changeset",
      title: "Get a changeset",
      description:
        "Returns one changeset in full: its owner and whether it is yours, the staged file texts (null deletes a file), the log of proposals, claims marked for a human to check and notes (each under its file), and a diff saying whether each staged file is added, modified, deleted or unchanged against the commit the changeset was opened on.",
      input: z.object({ changeset: z.string().min(1).describe("The id open_changeset returned") }),
      scope: "content:read",
      annotations: READ_ONLY,
      run: async ({ changeset }) => {
        const cs = await load(changeset);
        return { ...cs, mine: isOwner(cs, principal), diff: diff(await store.files(cs.baseSha), cs.changes) };
      },
    }),

    tool({
      name: "validate_changeset",
      title: "Validate a changeset",
      description:
        "Dry run of submit_changeset: applies the staged changes to main and runs every check `npm run check` runs. Returns ok, the errors the changeset adds (errors already on main are listed apart as preexisting and don't block), " +
        "warnings, claims marked manual, the diff, and willPublish (true when you own it and submit_changeset would write straight to main rather than open a pull request). " +
        "It also fails when main changed a staged file since the changeset was opened. Fix errors with the propose_* tools and validate again before submitting.",
      input: z.object({ changeset: z.string().min(1).describe("The id open_changeset returned") }),
      scope: "content:write",
      annotations: READ_ONLY,
      run: async ({ changeset }) => {
        const cs = await loadOpen(changeset);
        const at = await landing(cs);
        const v = evaluate(cs, at.files);
        const mine = isOwner(cs, principal);
        return {
          ok: v.ok && at.moved.length === 0,
          errors: [...(at.moved.length ? [`${MOVED}: ${at.moved.join(", ")}`] : []), ...v.errors],
          preexisting: v.preexisting,
          warnings: [...v.notes.map(noteText), ...v.warnings],
          manual: v.manual,
          diff: v.diff,
          willPublish: mine && publisher && v.manual.length === 0,
          ...(mine ? {} : { owner: `${cs.author.name} (${cs.author.kind})`, note: "only its owner can submit it" }),
        };
      },
    }),

    tool({
      name: "submit_changeset",
      title: "Submit a changeset",
      description:
        "Writes a changeset to the repository, which is the site's database. Only its owner can submit it. With content:publish and no claims marked manual it commits straight to main (live after the next deploy, a few minutes), " +
        "replacing the files it changed; otherwise, or with mode 'pr', it opens a pull request for review. If main moved since the changeset was opened it is rebased, unless main changed one of its files, which is refused. " +
        "Every check must pass first: run validate_changeset before. Safe to call again after a timeout or an unexplained failure: it finds the commit or pull request an earlier call wrote instead of writing twice. " +
        "When main only takes pull requests, it says so: submit again with mode 'pr'. Returns the mode, the commit or pull request URL, the sha and the files written; when no pull request could be opened (a local checkout without a remote) the note says so. revert_commit undoes a publish.",
      input: z.object({
        changeset: z.string().min(1).describe("The id open_changeset returned"),
        mode: z.enum(["publish", "pr"]).optional().describe("publish commits to main (needs content:publish); pr opens a pull request. Default: publish when allowed and nothing is marked manual, else pr"),
        message: z.string().max(2000).optional().describe("Commit subject (first line) and extra body lines; default '<kind>: <title>'"),
      }),
      scope: "content:write",
      annotations: { ...WRITE, destructiveHint: true, openWorldHint: true },
      run: async ({ changeset: id, mode: asked, message }) => {
        const first = await load(id);
        checkAccess(first, principal);
        if (first.status === "submitted" || first.status === "closed") throw statusError(first);
        if (asked === "publish" && !publisher)
          throw new ToolError("Publishing straight to main needs the content:publish scope: submit with mode pr (or leave mode out) to open a pull request.");

        // A retry of a submit that never answered: a publish that landed is recorded, not written twice.
        const recovered = first.status === "submitting" ? await recover(first) : null;
        if (recovered?.result) return answer(recovered.result);
        const prior = first.status === "submitting" ? first.submitting : undefined;
        if (prior?.mode === "pr" && asked === "publish")
          throw new ToolError(`An earlier submit of changeset ${id} started a pull request (branch ${prior.branch}): it can only finish as one. Submit again with mode pr, or leave mode out.`);

        // Frozen first, under a token naming this call: no proposal changes what is checked and written from here on.
        const token = crypto.randomUUID();
        let cs = await mutate(
          state,
          id,
          principal,
          (c) => {
            c.status = "submitting";
            c.submitting = { ...(c.submitting ?? {}), token, startedAt: iso(deps.now()) };
          },
          // From the status it was read in: a fresh submit never takes over one another call just started.
          { status: [first.status], ttlSeconds: KEPT_TTL, now: deps.now() },
        );
        // Back to open, unless another call has taken the submit over since (then nothing is written).
        const unfreeze = () =>
          mutate(
            state,
            id,
            principal,
            (c) => {
              if (c.submitting?.token !== token) throw new Error("taken over");
              c.status = "open";
              delete c.submitting;
            },
            { status: ["submitting"], now: deps.now() },
          ).catch(() => {});

        const branch = prior?.branch ?? `bot/${cs.kind}/${cs.id}`;
        const attempt = async () => {
          // A pull request already started stays on its base, so a retry builds the same tree and finds it.
          const at =
            prior?.mode === "pr" && prior.base ? { base: prior.base, files: await store.files(prior.base), moved: [] as string[] } : await landing(cs);
          if (at.moved.length) throw new ToolError(MOVED, { changed: at.moved });
          const v = evaluate(cs, at.files);
          if (!v.ok)
            throw new ToolError("The changeset doesn't pass the checks: fix it with the propose_* tools (validate_changeset lists the same errors), then submit again.", { errors: v.errors });
          const mode: SubmitMode = prior?.mode === "pr" ? "pr" : (asked ?? (publisher && v.manual.length === 0 ? "publish" : "pr"));
          if (mode === "publish" && v.manual.length) throw new ToolError("claims marked manual need a human: submit with mode pr", { manual: v.manual });
          // What is about to be written, recorded first, so a retry after a lost answer can find it.
          cs = await mutate(
            state,
            id,
            principal,
            (c) => {
              if (c.submitting?.token !== token) throw new ToolError(`Another submit of changeset ${id} took over: let it finish (list_changesets shows the result).`);
              c.submitting = { ...c.submitting, mode, base: at.base, paths: v.changed, ...(mode === "pr" ? { branch } : {}) };
            },
            { status: ["submitting"], ttlSeconds: KEPT_TTL, now: deps.now() },
          );
          const msg = commitMessage({ ...cs, manual: v.manual, warnings: v.notes }, principal, message);
          const result = await store.commit({
            baseSha: at.base,
            changes: Object.fromEntries(v.changed.map((p) => [p, cs.changes[p]])),
            message: msg.full,
            mode,
            prTitle: msg.subject,
            prBody: msg.body,
            // One branch per changeset, so submitting the same one twice can't open two pull requests.
            ...(mode === "pr" ? { branch } : {}),
          });
          return { base: at.base, paths: v.changed, result };
        };

        let done: { base: string; paths: string[]; result: CommitResult };
        try {
          try {
            done = await attempt();
          } catch (e) {
            // main moved between reading its head and committing: rebase once more.
            if (!(e instanceof ConflictError)) throw e;
            done = await attempt();
          }
        } catch (e) {
          const err = e as Error;
          // These wrote nothing: the changeset opens again for another submit (or more proposals).
          if (e instanceof ToolError || e instanceof ConflictError || e instanceof WrongBranchError || e instanceof ProtectedBranchError) await unfreeze();
          if (e instanceof ConflictError) throw new ToolError("main kept moving while this was submitted: call submit_changeset again in a moment.");
          if (e instanceof ProtectedBranchError) throw new ToolError(/mode pr/.test(err.message) ? err.message : `${err.message}: submit again with mode pr.`, { retryWith: { mode: "pr" } });
          if (e instanceof ToolError) throw e;
          if (e instanceof WrongBranchError) throw new ToolError(err.message);
          if (/already exists/.test(err.message))
            throw new ToolError(
              `The branch ${branch} is already there from an earlier submit of this changeset, and this store can't tell whether its pull request was opened: look for it on ${deps.repo}, then close this changeset with close_changeset.`,
            );
          // Anything else (a timeout, a lost answer) may have written already, so the changeset stays frozen.
          throw new ToolError(
            `Submitting failed: ${err.message}. It may have gone through: call submit_changeset again, which finds a commit or pull request an earlier try wrote instead of writing twice.`,
          );
        }

        const { base, paths, result } = done;
        const record: SubmitResult = {
          mode: result.mode,
          sha: result.sha,
          url: result.url,
          ...(result.mode === "pr" ? { number: result.number, branch: result.branch, ...(result.pushed === false ? { pushed: false, note: result.note } : {}) } : {}),
          parentSha: base,
          paths,
          at: iso(deps.now()),
        };
        await finalize(id, record);
        return answer(record);
      },
    }),

    tool({
      name: "close_changeset",
      title: "Close a changeset",
      description:
        "Abandons a changeset without writing anything, for instance after submit_changeset refused it because main changed its files, or after a submit that can't finish. Only its owner or a principal with content:publish can close it. " +
        "A changeset an earlier submit did publish is recorded as submitted instead, and the answer says so. Returns the closed id; open_changeset starts again.",
      input: z.object({
        changeset: z.string().min(1).describe("The id open_changeset returned"),
        reason: z.string().trim().min(3).max(500).describe("Why it is abandoned, kept in the changeset's log"),
      }),
      scope: "content:write",
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      run: async ({ changeset: id, reason }) => {
        const cs = await load(id);
        checkAccess(cs, principal, "close");
        if (cs.status === "submitting") {
          const recovered = await recover(cs, "close");
          if (recovered?.result)
            throw new ToolError(`Changeset ${id} was published by an earlier submit (${recovered.result.url}), so it is recorded as submitted, not closed: revert_commit undoes it.`, {
              sha: recovered.result.sha,
            });
        }
        await mutate(
          state,
          id,
          principal,
          (c) => {
            c.status = "closed";
            delete c.submitting;
            c.log.push(`closed by ${oneLine(principal.name)}: ${oneLine(reason)}`);
          },
          { status: ["open", "submitting"], access: "close", ttlSeconds: KEPT_TTL, now: deps.now() },
        );
        const branch = cs.status === "submitting" ? cs.submitting?.branch : undefined;
        return { closed: id, ...(branch ? { note: `an earlier submit may have opened a pull request from ${branch}: close it on GitHub if so` } : {}) };
      },
    }),

    tool({
      name: "revert_commit",
      title: "Revert a published commit",
      description:
        "Undoes a commit this server published to main from a changeset (in the last 90 days), by publishing a new commit that restores every file it wrote to its text before. " +
        "Refused when a file was edited again after that commit (revert by hand then), when it was reverted already, or when the result would fail the checks. Returns the revert commit's URL and sha and the paths restored.",
      input: z.object({
        sha: z.string().regex(/^[0-9a-f]{7,40}$/i, "a commit sha").describe("The sha submit_changeset returned"),
        reason: z.string().trim().min(3).max(200).describe("Why it is reverted; goes in the commit subject"),
      }),
      scope: "content:publish",
      annotations: { ...WRITE, destructiveHint: true, openWorldHint: true },
      run: async ({ sha, reason }) => {
        const hits = await publishedBy(state, sha);
        if (hits.length > 1) throw new ToolError(`${sha} starts more than one commit this server published: pass more of the sha.`);
        const hit = hits[0];
        const cs = hit ? await loadChangeset(state, hit.id) : null;
        const r = cs?.result;
        if (!hit || !cs || r?.mode !== "publish" || r.sha !== hit.sha) {
          // Say why: no such commit, not content, or not one of ours.
          const info = await store.commitInfo(sha).catch(() => {
            throw new ToolError(`No commit ${sha} on main: check the sha submit_changeset returned.`);
          });
          const outside = info.paths.filter((p) => !WRITABLE.test(p));
          if (outside.length) throw new ToolError("only content commits can be reverted here", { outside });
          throw new ToolError("This server can only revert commits it published from a changeset in the last 90 days, whose parent it recorded: revert this one with git.");
        }
        if (cs.revertedBy) throw new ToolError(`${r.sha.slice(0, 7)} was reverted already, by ${cs.revertedBy}.`);
        const outside = r.paths.filter((p) => !WRITABLE.test(p));
        if (outside.length) throw new ToolError("only content commits can be reverted here", { outside });

        const head = await store.head();
        const [before, at, now] = await Promise.all([store.files(r.parentSha), store.files(r.sha), store.files(head)]);
        const edited = r.paths.filter((p) => (at.get(p) ?? null) !== (now.get(p) ?? null));
        if (edited.length) throw new ToolError("These files changed after that commit: revert by hand.", { edited });
        const changes = Object.fromEntries(r.paths.map((p) => [p, before.get(p) ?? null]));
        const c = check(now, changes, deps.now());
        if (!c.ok) throw new ToolError("Reverting would break the checks (later changes depend on this commit): revert by hand.", { errors: c.errors });

        const subject = cut(`revert: ${r.sha.slice(0, 7)} ${oneLine(reason)}`, SUBJECT_MAX);
        const message = `${subject}\n\nThis reverts commit ${r.sha} (changeset ${cs.id}).\n\n${trailers(principal, [`Reverts: ${r.sha}`])}`;
        const result = await store.commit({ baseSha: head, changes, message, mode: "publish" }).catch((e) => {
          if (e instanceof ConflictError) throw new ToolError("main moved while reverting: call revert_commit again.");
          if (e instanceof ProtectedBranchError || e instanceof WrongBranchError) throw new ToolError(`${(e as Error).message} (revert by hand, or with git in a pull request)`);
          throw e;
        });
        await markReverted(state, cs.id, result.sha, deps.now());
        await recordLastWrite(state, { at: iso(deps.now()), tool: "revert_commit", who: principal.name, mode: "publish", sha: result.sha, url: result.url, changeset: cs.id });
        return { url: result.url, sha: result.sha, reverted: r.paths };
      },
    }),

    // Keys minted on this machine would live in its state file, which no server reads them from.
    ...(principal.kind === "local" ? [] : keyTools),
  ];
}
