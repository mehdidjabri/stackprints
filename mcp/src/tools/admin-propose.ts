// The admin server's propose tools: each adds one change to an open changeset, behind the sourcing
// gate (only pages this server fetched can be cited, and changed facts must quote them). They read
// the repository at the changeset's base with its earlier changes on top, so successive proposals
// build on each other, and they write nothing to the repository: submit_changeset does. A proposal
// is computed from a snapshot of the changeset and staged in one atomic step, which refuses it when
// another proposal changed one of its files meanwhile; it then runs again on the new snapshot.
import { z } from "zod";
import { slugify } from "../../../lib/github";
import { layerIdFrom } from "../../../lib/links";
import { logoProblems } from "../../../lib/validate.mjs";
import { type Changeset, type ManualClaim, type ManualEntry, type Note, checkAccess, loadChangeset, mutate, overlay, stage, statusError, versionOf } from "../core/changeset";
import { checkDuplicate, day, layers, news, option, paths, stack, toJson, toNewsJson } from "../core/content";
import type { AdminDeps } from "../core/deps";
import { type Page, containsQuote, looseText, normalizeUrl, pageFor, titleMatches } from "../core/receipts";
import { type Claim, knownUrls, requireFetched, safeInline, urlsIn, verifyClaims } from "../core/sourcing";
import { ContentionError } from "../core/state";
import { type Changes, WRITABLE } from "../core/store";
import { ToolError, type ToolSpec, WRITE, tool } from "../core/tool";
import type { Files, Hot, NewsItem, Option, Stack } from "../core/types";

const NEXT = "validate_changeset, then submit_changeset";
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NEWS_KEEP = 5;
const NEWS_WINDOW_DAYS = 30;
const NEWS_MAX_AGE_DAYS = 365;
const HOT_WINDOW_DAYS = 7;
/** HOT.md: every source of the hot list was read in the last 48 hours. */
const HOT_RECEIPT_MS = 48 * 36e5;
const PROMPT_MAX = 60_000;
/** How much of a template's literal text must be found on its source page. */
const TEMPLATE_OPENING = 200;
/** How many times a proposal runs when other proposals keep changing its files. */
const PROPOSE_TRIES = 3;
/**
 * Fields an update may not change (RESEARCH.md rule 2): they place the option (order), name it, or
 * are the maintainers' to set. A logo is set through propose_logo's assign.
 */
const IMMUTABLE = ["id", "order", "name", "logo", "affiliation", "exclusive"] as const;
/** Fields a new option leaves out: the maintainers set them (a logo through propose_logo). */
const RESERVED = ["order", "affiliation", "logo", "exclusive"] as const;

/** The order keys usually appear in, so a new key lands where a person would put it. */
const OPTION_KEYS = ["order", "id", "name", "url", "note", "open", "logo", "affiliation", "exclusive", "profile", "summary", "how", "facts", "links", "goodFor", "watchOut", "model", "sources", "evidence", "researched"];
const STACK_KEYS = ["slug", "name", "logo", "kind", "tagline", "description", "links", "author", "disclosure", "closedLayers", "sources", "layers", "supports", "notUsed", "inUseUndisclosed", "evidence", "version", "researched"];

// ---- inputs -------------------------------------------------------------------------------------

const CHANGESET = z.string().describe("The changeset id open_changeset returned");
const LAYER = z.string().describe("Layer id, e.g. sandbox (a display name such as 'Model gateway' also works)");
const VERSION = z
  .string()
  .describe("The version get_item returned for this file when you read it (pass changeset to get_item to include what this changeset staged); refused when the file changed since");

const source = z.strictObject({ title: z.string().describe("The page's title"), url: z.string().describe("Full https URL") });

const claim = z.strictObject({
  field: z.string().describe('The fact label exactly as written in facts ("Pricing"), or "model.<field>" ("model.priceIn")'),
  url: z.string().describe("A page you read with fetch_source in the last 14 days"),
  quote: z.string().max(300).describe("8 to 300 characters copied from that page that state the value"),
  vendorReported: z.boolean().optional().describe('True for a number the vendor publishes about itself; write the value with "(vendor-reported)"'),
});

const manualClaim = z.strictObject({
  field: z.string().describe('The fact label or "model.<field>" this backs'),
  url: z.string().describe("The page that states it"),
  reason: z.string().trim().min(3).describe("Why the server can't check it (PDF, paywall, script-only page); the change then goes to a person"),
});

const modelFields = z.strictObject({
  lab: z.string().optional(),
  released: z.string().optional().describe("YYYY-MM-DD"),
  context: z.string().optional().describe('e.g. "1M tokens"'),
  priceIn: z.string().optional().describe('e.g. "$4 / 1M tokens"'),
  priceOut: z.string().optional(),
  modalities: z.array(z.string()).optional(),
  weights: z.enum(["open", "closed"]).optional(),
  openrouter: z.string().optional().describe("OpenRouter model id"),
});

const LINK_KEYS = ["site", "docs", "repo", "pricing", "changelog", "blog", "x"] as const;
const optionLinks = z.strictObject(Object.fromEntries(LINK_KEYS.map((k) => [k, z.string().optional()])) as Record<(typeof LINK_KEYS)[number], z.ZodOptional<z.ZodString>>);
const linkPatch = z.strictObject(
  Object.fromEntries(LINK_KEYS.map((k) => [k, z.string().nullable().optional()])) as Record<(typeof LINK_KEYS)[number], z.ZodOptional<z.ZodNullable<z.ZodString>>>,
);

/** Every Option field, optional; maintainer-only ones are accepted here so they can be refused by name. */
const optionFields = {
  id: z.string().optional().describe("Kebab-case file name; defaults to the name in kebab-case"),
  order: z.number().optional().describe("Maintainer-only: leave out"),
  name: z.string().optional(),
  url: z.string().optional().describe("Domain or URL without protocol, e.g. e2b.dev; https://<url> must have been read with fetch_source"),
  note: z.string().optional().describe("3 to 8 word descriptor, under 60 characters"),
  logo: z.string().optional().describe("Maintainer-only here: propose_logo's assign sets a logo"),
  open: z.boolean().optional().describe("Open source or open weights"),
  affiliation: z.string().optional().describe("Maintainer-only: leave out"),
  exclusive: z.boolean().optional().describe("Maintainer-only: leave out"),
  profile: z.enum(["model", "product", "protocol", "pattern"]).optional(),
  summary: z.string().optional().describe("Two or three neutral sentences"),
  facts: z.array(z.tuple([z.string(), z.string()])).optional().describe("Datasheet rows as [label, value], 4 to 8, most useful first"),
  links: optionLinks.optional().describe("Full https URLs you checked"),
  goodFor: z.array(z.string()).optional().describe("At most 3 short phrases"),
  watchOut: z.array(z.string()).optional().describe("At most 3 short honest caveats"),
  how: z.array(z.string()).optional().describe("Pattern steps, 3 to 5"),
  model: modelFields.optional().describe("For profile model"),
  sources: z.array(source).optional().describe("Pages the datasheet came from"),
  evidence: z.record(z.string(), z.array(z.string())).optional().describe('Fact label, "model.<field>" or "watchOut.<n>" to URLs listed in sources'),
  researched: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
};

/** What propose_option_update takes: lists merged by their key, so a field left out stays as it is. */
const optionPatch = z.strictObject({
  ...optionFields,
  facts: z
    .array(z.tuple([z.string(), z.string()]))
    .optional()
    .describe("Rows to add or change, as [label, value]: a label already on the option gets the new value in place, a new label is added at the end; other facts stay (remove one with removeFacts)"),
  links: linkPatch.optional().describe("Links to set (full https URLs you checked) or remove (null); links left out stay"),
  sources: z.array(source).optional().describe("Sources to add, or retitle by URL; other sources stay (remove one with removeSources)"),
  evidence: z
    .record(z.string(), z.array(z.string()).nullable())
    .optional()
    .describe('Per key (fact label, "model.<field>", "watchOut.<n>"): the URLs from sources that back it, or null to remove that key; keys left out stay'),
  model: modelFields.optional().describe("For profile model; merged field by field"),
  goodFor: z.array(z.string()).optional().describe("The whole new list (at most 3 short phrases); every item it drops is named in a warning"),
  watchOut: z.array(z.string()).optional().describe("The whole new list (at most 3 caveats); every item it drops is named in a warning"),
  how: z.array(z.string()).optional().describe("The whole new list of pattern steps; every step it drops is named in a warning"),
});
type OptionPatch = z.infer<typeof optionPatch>;

const stackInput = z.strictObject({
  slug: z.string().optional().describe("Kebab-case file name; defaults to the name in kebab-case"),
  name: z.string().min(1),
  logo: z.string().optional().describe("A file name in content/logos, without .svg (real products only)"),
  tagline: z.string().min(1),
  description: z.string().min(1).describe("Neutral; say what is public"),
  kind: z.string().min(1).describe('e.g. "Coding agent"'),
  disclosure: z.enum(["open-source", "documented", "closed", "example"]).describe("What an empty slot means: open-source and example read 'not used', documented and closed read 'not disclosed'"),
  sources: z.array(source).optional(),
  evidence: z.record(z.string(), z.array(z.string())).optional().describe("Per picked layer: the source URLs that back the pick"),
  notUsed: z.array(z.string()).optional().describe("Layers a source confirms are absent"),
  inUseUndisclosed: z.array(z.string()).optional().describe("Layers a source confirms are present with the component unnamed; each needs evidence"),
  closedLayers: z.array(z.string()).optional().describe("Open core: layers only the closed parts of an open-source stack could fill"),
  supports: z.record(z.string(), z.array(z.string())).optional().describe("Per layer: picks that are configurable rather than the default"),
  researched: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
  version: z.string().optional().describe("The release the picks were mapped from (real products only)"),
  links: z.strictObject({ site: z.string().optional(), repo: z.string().optional(), docs: z.string().optional(), announcement: z.string().optional() }).optional(),
  author: z.strictObject({ name: z.string(), url: z.string().optional() }).optional(),
  layers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).describe("Layer id to option id, or several"),
});

const hotSource = z.strictObject({
  title: z.string().describe('The page\'s title; for a post on X, "@author: its first words", with the author the post\'s own'),
  url: z.string(),
  date: z.string().describe("When it was published, YYYY-MM-DD"),
});
const hotFields = {
  why: z.string().describe("What happened and why people are talking: one plain sentence, at most 120 characters, no hype words"),
  since: z.string().optional().describe("When the conversation started (the launch, release or post), YYYY-MM-DD"),
  sources: z.array(hotSource).describe("1 to 4 pages, an x.com post first when there is one, at least one dated in the last 7 days"),
};

// ---- the shared flow ----------------------------------------------------------------------------

/** One proposal in progress: the changeset as it was read, the files it sees, and what it will stage. */
type Work = {
  /** The snapshot the proposal is computed from. */
  cs: Changeset;
  base: Files;
  /** The base with the changeset's changes on top, updated as this proposal stages more. */
  files: Files;
  known: Set<string>;
  now: number;
  today: string;
  writes: Changes;
  warnings: Note[];
  manual: ManualEntry[];
  /** "<path>|<field>" (or "<path>|*") for the facts this proposal checked again: earlier manual entries for them go. */
  resolves: Set<string>;
};

type Built = { line: string; extra?: Record<string, unknown> };

/** Another proposal staged one of this proposal's files after its snapshot was read. */
class Raced extends Error {
  constructor(readonly paths: string[]) {
    super(`changed meanwhile: ${paths.join(", ")}`);
    this.name = "Raced";
  }
}

async function begin(deps: AdminDeps, id: string): Promise<Work> {
  const cs = await loadChangeset(deps.state, id);
  if (!cs) throw new ToolError(`No changeset "${id}". Open one with open_changeset (an open changeset nobody touches for 14 days is dropped).`);
  if (cs.status !== "open") throw statusError(cs);
  checkAccess(cs, deps.principal);
  const now = deps.now();
  const base = await deps.store.files(cs.baseSha);
  return { cs, base, files: overlay(base, cs.changes), known: knownUrls(base), now, today: day(now), writes: {}, warnings: [], manual: [], resolves: new Set() };
}

function put(w: Work, path: string, text: string) {
  if (!WRITABLE.test(path)) throw new ToolError(`${path} is not a content path this server may write.`);
  w.files.set(path, text);
  w.writes[path] = text;
}

const warn = (w: Work, path: string, text: string) => {
  if (!w.warnings.some((n) => n.path === path && n.text === text)) w.warnings.push({ path, text });
};

const noteText = (n: Note) => `${n.path}: ${n.text}`;
const same = (a: Changes, b: Changes, p: string) => (p in a ? a[p] : undefined) === (p in b ? b[p] : undefined);

/**
 * Stages what the proposal computed, in one atomic step: refused (and run again) when another
 * proposal changed one of its files since the snapshot. A manual entry stays until its own fact is
 * claimed again (or removed), or its file is back to what main has: re-proposing a file for other
 * fields must not drop it, or an unchecked fact would publish without review. Notes only add up.
 */
async function finish(deps: AdminDeps, w: Work, { line, extra = {} }: Built) {
  const staged = Object.keys(w.writes);
  await mutate(
    deps.state,
    w.cs.id,
    deps.principal,
    (cs) => {
      const raced = staged.filter((p) => !same(cs.changes, w.cs.changes, p));
      if (raced.length) throw new Raced(raced);
      for (const [p, t] of Object.entries(w.writes)) stage(cs, p, t);
      const settled = (m: ManualEntry) =>
        w.resolves.has(`${m.path}|${m.field}`) || w.resolves.has(`${m.path}|*`) || (m.path in cs.changes && cs.changes[m.path] === (w.base.get(m.path) ?? null));
      cs.manual = [...cs.manual.filter((m) => !settled(m)), ...w.manual];
      cs.warnings = [...cs.warnings, ...w.warnings.filter((n) => !cs.warnings.some((o) => o.path === n.path && o.text === n.text))];
      cs.log.push(line);
    },
    { now: w.now },
  );
  return { changeset: w.cs.id, staged, ...extra, warnings: w.warnings.map(noteText), ...(w.manual.length ? { manual: w.manual } : {}), next: NEXT };
}

/** Runs a proposal on a fresh snapshot until it stages without racing another (PROPOSE_TRIES times at most). */
async function propose(deps: AdminDeps, id: string, build: (w: Work) => Promise<Built>) {
  for (let attempt = 1; ; attempt++) {
    const w = await begin(deps, id);
    const built = await build(w);
    try {
      return await finish(deps, w, built);
    } catch (e) {
      if (!(e instanceof Raced || e instanceof ContentionError)) throw e;
      if (attempt >= PROPOSE_TRIES) {
        const what = e instanceof Raced ? e.paths.join(", ") : "it";
        throw new ToolError(`Other proposals kept changing ${what} in changeset ${id} while this one ran (${PROPOSE_TRIES} tries): send it again.`);
      }
    }
  }
}

/** Refuses a proposal built on a version of the file other than the one the changeset sees now. */
async function expectVersion(w: Work, path: string, expected: string | undefined, required = false) {
  const text = w.files.get(path);
  if (expected === undefined) {
    if (required && text !== undefined)
      throw new ToolError(`${path} exists, so replacing it needs expectedVersion: read it with get_item (pass changeset), build on what it returns, and send its version.`);
    return;
  }
  const current = await versionOf(text);
  if (current !== expected)
    throw new ToolError(
      `${path} changed since you read it: re-read it with get_item (pass changeset to include what this changeset staged), redo the change on that text, and propose again with its version.`,
      { path, expectedVersion: expected, currentVersion: current },
    );
}

function layerOf(files: Files, input: string) {
  const all = layers(files);
  const id = layerIdFrom(all, input);
  if (!all.some((l) => l.id === id)) throw new ToolError(`Unknown layer "${input}".`, { layers: all.map((l) => `${l.id} (${l.name})`) });
  return id;
}

function existingOption(files: Files, layerInput: string, id: string) {
  const layer = layerOf(files, layerInput);
  const o = option(files, layer, id);
  if (!o) throw new ToolError(`No option ${layer}/${id}. Find it with get_item or search, or add it with propose_option_create.`);
  return { layer, option: o };
}

function kebab(what: string, value: string) {
  if (!KEBAB.test(value)) throw new ToolError(`${what} "${value}" must be kebab-case: lower-case letters, digits and single dashes.`);
  return value;
}

const isDay = (s: string) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && day(t) === s;
};
const daysFrom = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;

const isHttps = (u: string) => {
  try {
    return /^https:\/\/\S+$/.test(u) && new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};
const sameUrl = (a: string, b: string) => {
  try {
    return normalizeUrl(a) === normalizeUrl(b);
  } catch {
    return a === b;
  }
};

/** An option's url ("e2b.dev/docs") as the https page it names, which needs a receipt like any cited URL. */
const siteUrl = (url: string | undefined) => (url ? [`https://${url.replace(/^\/+/, "")}`] : []);

/** The URLs a log line names, cut so one line stays readable in a commit message. */
function sourcesLine(urls: Iterable<string>, max = 12) {
  const list = [...new Set(urls)];
  if (!list.length) return "no new sources";
  return list.length > max ? `${list.slice(0, max).join(", ")} and ${list.length - max} more` : list.join(", ");
}

/** The object's keys in the file's existing order, with new keys placed where the usual order puts them. */
function arrange<T extends object>(value: T, existing: string[], order: string[]): T {
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const v = value as Record<string, unknown>;
  const keys = existing.filter((k) => k in v);
  for (const k of Object.keys(v)) {
    if (keys.includes(k)) continue;
    const at = keys.findIndex((x) => rank(x) > rank(k));
    if (at < 0) keys.push(k);
    else keys.splice(at, 0, k);
  }
  return Object.fromEntries(keys.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) as T;
}

const quoted = (items: string[]) => items.map((s) => JSON.stringify(s)).join(", ");

// ---- options: claims and citations --------------------------------------------------------------

type ModelKey = keyof NonNullable<Option["model"]>;

/** Fact labels and model.<field> keys whose value a change adds or alters. */
function changedFields(before: Partial<Option>, facts?: [string, string][], model?: Option["model"]) {
  const old = new Map(before.facts ?? []);
  const out: string[] = [];
  for (const [label, value] of facts ?? []) if (old.get(label) !== value) out.push(label);
  for (const [k, v] of Object.entries(model ?? {})) if (JSON.stringify(before.model?.[k as ModelKey]) !== JSON.stringify(v)) out.push(`model.${k}`);
  return [...new Set(out)];
}

function requireClaims(fields: string[], claims: Claim[], manual: ManualClaim[]) {
  const backed = new Set([...claims.map((c) => c.field), ...manual.map((m) => m.field)]);
  const unclaimed = fields.filter((f) => !backed.has(f));
  if (unclaimed.length)
    throw new ToolError(
      "Every fact you add or change needs a claim quoting a page you fetched, or a manual entry with a reason. Add one for each of these fields (the field is the fact label exactly as written, or model.<field>).",
      { unclaimed },
    );
  const notHttps = manual.filter((m) => !isHttps(m.url)).map((m) => m.url);
  if (notHttps.length) throw new ToolError("Manual entries need the https URL of the page that states the value.", { notHttps });
}

/** The entries on an option that evidence may name (as lib/validate.mjs checks). */
const citable = (o: Option) =>
  new Set([...(o.facts ?? []).map(([k]) => k), ...Object.keys(o.model ?? {}).map((k) => `model.${k}`), ...(o.watchOut ?? []).map((_, i) => `watchOut.${i}`)]);

/** Verified claims become the option's citations: the page in sources, its URL in evidence[field]. */
async function cite(deps: AdminDeps, w: Work, o: Option, claims: Claim[]) {
  const keys = citable(o);
  for (const c of claims) {
    if (!keys.has(c.field)) continue;
    let src = o.sources?.find((s) => sameUrl(s.url, c.url));
    if (!src) {
      const page = await pageFor(deps.state, c.url, w.now);
      src = { title: page?.title?.trim() || new URL(c.url).hostname, url: c.url };
      o.sources = [...(o.sources ?? []), src];
    }
    const list = o.evidence?.[c.field] ?? [];
    if (!list.some((u) => sameUrl(u, src.url))) o.evidence = { ...o.evidence, [c.field]: [...list, src.url] };
  }
}

/**
 * Evidence the change left pointing at nothing goes, with a note: a key for an entry the option no
 * longer has, a watchOut.<n> whose item changed, a URL whose source was removed. Keys the patch or
 * its claims set stay as they are, for the checks to judge.
 */
function pruneEvidence(w: Work, at: string, before: Option, o: Option, setByPatch: Set<string>) {
  if (!o.evidence) return;
  const keys = citable(o);
  const sources = new Set((o.sources ?? []).map((s) => s.url));
  const kept: [string, string[]][] = [];
  const gone: string[] = [];
  for (const [k, urls] of Object.entries(o.evidence)) {
    if (setByPatch.has(k)) {
      kept.push([k, urls]);
      continue;
    }
    const moved = k.startsWith("watchOut.") && before.watchOut?.[Number(k.slice(9))] !== o.watchOut?.[Number(k.slice(9))];
    if (!keys.has(k) || moved) {
      gone.push(k);
      continue;
    }
    const live = urls.filter((u) => sources.has(u));
    if (live.length < urls.length) warn(w, at, `dropped ${urls.filter((u) => !sources.has(u)).join(", ")} from evidence for ${k}: that source was removed`);
    if (live.length) kept.push([k, live]);
    else gone.push(k);
  }
  if (kept.length) o.evidence = Object.fromEntries(kept);
  else delete o.evidence;
  if (gone.length) warn(w, at, `dropped evidence for ${gone.join(", ")}, which no longer names an entry on the option (or lost its sources)`);
}

function vendorWarnings(o: Option, claims: Claim[]) {
  const facts = new Map(o.facts ?? []);
  return claims
    .filter((c) => c.vendorReported)
    .flatMap((c) => {
      const v = c.field.startsWith("model.") ? o.model?.[c.field.slice(6) as ModelKey] : facts.get(c.field);
      return v !== undefined && !String(v).includes("(vendor-reported)") ? [`${c.field} is vendor-reported, so write its value with "(vendor-reported)" (RESEARCH.md rule 4)`] : [];
    });
}

/**
 * The option with a patch merged in: facts by label (removeFacts drops some), links and evidence by
 * key (null removes one), sources by URL (removeSources drops some), model by field; goodFor,
 * watchOut and how are replaced whole, with a note naming each item they lose.
 */
function mergeOption(w: Work, at: string, before: Option, patch: OptionPatch, removeFacts: string[], removeSources: string[]): Option {
  const { facts, links, sources, evidence, model, goodFor, watchOut, how, ...plain } = patch;
  const next: Option = { ...structuredClone(before), ...plain };

  const labels = (facts ?? []).map(([k]) => k);
  const twice = labels.filter((k, i) => labels.indexOf(k) !== i);
  if (twice.length) throw new ToolError(`facts names ${quoted([...new Set(twice)])} more than once.`);
  const has = new Set((before.facts ?? []).map(([k]) => k));
  const unknownFacts = removeFacts.filter((k) => !has.has(k));
  if (unknownFacts.length) throw new ToolError(`removeFacts names facts ${at} doesn't have: ${quoted(unknownFacts)}.`, { facts: [...has] });
  const both = removeFacts.filter((k) => labels.includes(k));
  if (both.length) throw new ToolError(`${quoted(both)} is both in facts and in removeFacts: send one or the other.`);
  if (facts || removeFacts.length) {
    const list = (before.facts ?? []).filter(([k]) => !removeFacts.includes(k)).map(([k, v]): [string, string] => [k, v]);
    for (const [k, v] of facts ?? []) {
      const i = list.findIndex(([x]) => x === k);
      if (i >= 0) list[i] = [k, v];
      else list.push([k, v]);
    }
    if (list.length) next.facts = list;
    else delete next.facts;
  }

  if (links) {
    const merged: Record<string, string> = { ...before.links };
    for (const [k, v] of Object.entries(links)) {
      if (v === null) delete merged[k];
      else if (v !== undefined) merged[k] = v;
    }
    if (Object.keys(merged).length) next.links = merged;
    else delete next.links;
  }

  const unknownSources = removeSources.filter((u) => !(before.sources ?? []).some((s) => sameUrl(s.url, u)));
  if (unknownSources.length) throw new ToolError(`removeSources names URLs ${at} doesn't list as sources: ${unknownSources.join(", ")}.`);
  if (sources || removeSources.length) {
    const list = (before.sources ?? []).filter((s) => !removeSources.some((u) => sameUrl(s.url, u)));
    for (const s of sources ?? []) {
      const i = list.findIndex((x) => sameUrl(x.url, s.url));
      // The listed spelling stays, so evidence that names it still matches.
      if (i >= 0) list[i] = { title: s.title, url: list[i].url };
      else list.push(s);
    }
    if (list.length) next.sources = list;
    else delete next.sources;
  }

  if (evidence) {
    const merged: Record<string, string[]> = { ...before.evidence };
    for (const [k, v] of Object.entries(evidence)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (Object.keys(merged).length) next.evidence = merged;
    else delete next.evidence;
  }

  if (model) next.model = { ...before.model, ...model };

  for (const [field, list] of [
    ["goodFor", goodFor],
    ["watchOut", watchOut],
    ["how", how],
  ] as const) {
    if (!list) continue;
    const lost = (before[field] ?? []).filter((x) => !list.includes(x));
    if (lost.length) warn(w, at, `removed from ${field}: ${quoted(lost)}`);
    if (list.length) next[field] = list;
    else delete next[field];
  }
  return next;
}

// ---- news ---------------------------------------------------------------------------------------

const newsKey = (it: { date: string; title: string }) => `${it.date}|${looseText(it.title)}`;

/**
 * NEWS.md: newest first, from the last 12 months only; of those, the 5 newest plus every other item
 * from the 30 days before `updated`.
 */
export function mergeNews(current: NewsItem[], fresh: NewsItem[], updated: string) {
  return [...current, ...fresh]
    .filter((it) => daysFrom(it.date, updated) <= NEWS_MAX_AGE_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((it, i) => i < NEWS_KEEP || daysFrom(it.date, updated) <= NEWS_WINDOW_DAYS);
}

function newsProblems(it: NewsItem, today: string) {
  const out: string[] = [];
  const at = it.url || it.title || "an item";
  if (!isDay(it.date)) out.push(`${at}: date must be YYYY-MM-DD`);
  else if (it.date > today) out.push(`${at}: date ${it.date} is in the future`);
  else if (daysFrom(it.date, today) > NEWS_MAX_AGE_DAYS) out.push(`${at}: ${it.date} is more than 12 months ago; news covers the last 12 months`);
  if (!it.title.trim()) out.push(`${at}: needs the headline as title`);
  if (!isHttps(it.url)) out.push(`${at}: url must be a full https URL`);
  if (!it.source.trim()) out.push(`${at}: needs a source (the publisher's domain)`);
  return out;
}

function newsWarnings(it: NewsItem, page: Page | null) {
  const out: string[] = [];
  if (page?.title && !titleMatches(page.title, it.title)) out.push(`${safeInline(it.title)} doesn't match the page's title ${safeInline(page.title)} (${it.url})`);
  if (!page?.published) out.push(`date unverified for ${it.url}: the page shows no publish date`);
  else if (page.published !== it.date) out.push(`date differs from the page for ${it.url}: ${it.date} given, the page says ${safeInline(page.published)}`);
  return out;
}

// ---- hot list -----------------------------------------------------------------------------------

const HANDLE_TITLE = /^@(\w{1,15}):/;

/** A post on X is titled "@author: its first words", which are looked for in the post itself. */
function hotTitleDiffers(page: Page, title: string) {
  if (page.via === "direct") return Boolean(page.title) && !titleMatches(page.title, title);
  const words = title.replace(HANDLE_TITLE, "").trim().replace(/(…|\.\.\.)\s*$/, "");
  return !titleMatches(page.title, title) && !containsQuote(page.text, words);
}

/** The "@handle" a source title credits, when the post's receipt names another author. */
function wrongAuthor(page: Page, title: string) {
  const asked = title.match(HANDLE_TITLE)?.[1];
  const author = typeof page.meta?.author === "string" ? page.meta.author.replace(/^@/, "") : undefined;
  return asked && author && asked.toLowerCase() !== author.toLowerCase() ? { credited: `@${asked}`, author: `@${author}` } : null;
}

// ---- prompts ------------------------------------------------------------------------------------

/** Where a template marks text that code fills in: {{name}}, ${name}, <dynamic: …>, $ARGUMENTS. */
const MARKER = /\{\{[^}]*\}\}|\$\{[^}]*\}|<dynamic:[^>]*>|\$[A-Z][A-Z_]{2,}/g;

/** The text's literal lines, placeholders aside, that the page doesn't contain, within the first `chars` characters. */
function notOnPage(pageText: string, text: string, chars = Number.POSITIVE_INFINITY) {
  const missing: string[] = [];
  let seen = 0;
  for (const line of text.split(MARKER).flatMap((s) => s.split("\n"))) {
    if (seen >= chars) break;
    const piece = line.trim().slice(0, chars - seen);
    if (!/[\p{L}\p{N}]/u.test(piece)) continue;
    seen += piece.length;
    if (!containsQuote(pageText, piece)) missing.push(piece);
  }
  return missing;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// ---- the tools ----------------------------------------------------------------------------------

const STAGED_ONLY = " Nothing is written to the repository until submit_changeset; call validate_changeset first. Only the changeset's owner (who opened it) can propose into it.";

export function adminProposeTools(deps: AdminDeps): ToolSpec[] {
  return [
    tool({
      name: "propose_news",
      title: "Propose news for an option",
      description:
        "Adds news items to one option's news file (content/news/<layer>/<id>.json) in an open changeset. Send only what you found; the server merges by the NEWS.md rule: " +
        "it drops duplicates (same URL, or same date and title) and anything older than 12 months, sorts newest first, keeps the 5 newest plus every other item from the 30 days before today, and sets updated to today. " +
        "Send items: [] to record that the option was checked and nothing is new. Fetch every new item's URL with fetch_source first or the call is refused; " +
        "the headline and date are compared with the page, and a mismatch or a page with no publish date comes back as a warning that stays on the changeset. " +
        "Patterns have no news. Returns the staged path, the items added, skipped as duplicates and dropped by the rule, and warnings." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        layer: LAYER,
        id: z.string().describe("Option id, e.g. e2b"),
        items: z
          .array(
            z.strictObject({
              date: z.string().describe("The article's original publish date, YYYY-MM-DD (byline or datePublished, never an 'updated on' date), in the last 12 months"),
              title: z.string().describe("The headline as published"),
              url: z.string().describe("Full https URL, read with fetch_source"),
              source: z.string().describe("The publisher's domain, e.g. techcrunch.com"),
            }),
          )
          .describe("New items; [] records that the option was checked and nothing is new"),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, layer: layerInput, id, items }) =>
        propose(deps, changeset, async (w) => {
          const { layer, option: o } = existingOption(w.files, layerInput, id);
          if (o.profile === "pattern") throw new ToolError(`${layer}/${id} is a pattern; patterns have no news.`);
          const problems = items.flatMap((it) => newsProblems(it, w.today));
          if (problems.length) throw new ToolError("Some items can't be used as they are; fix them and send the call again.", { problems });

          const at = paths.news(layer, id);
          const current = news(w.files, layer, id) ?? { updated: w.today, items: [] };
          const urls = new Set(current.items.map((i) => (isHttps(i.url) ? normalizeUrl(i.url) : i.url)));
          const keys = new Set(current.items.map(newsKey));
          const fresh: NewsItem[] = [];
          const skipped: string[] = [];
          for (const it of items) {
            const u = normalizeUrl(it.url);
            const k = newsKey(it);
            if (urls.has(u) || keys.has(k)) {
              skipped.push(it.url);
              continue;
            }
            urls.add(u);
            keys.add(k);
            fresh.push({ date: it.date, title: it.title.trim(), url: it.url, source: it.source.trim() });
          }
          // The title and date are checked against the page itself, so every new item needs a receipt,
          // even a URL the content already cites elsewhere.
          await requireFetched(deps.state, fresh.map((i) => i.url), new Set(), w.now);
          for (const it of fresh) for (const text of newsWarnings(it, await pageFor(deps.state, it.url, w.now))) warn(w, at, text);

          const merged = mergeNews(current.items, fresh, w.today);
          const dropped = [...current.items, ...fresh].filter((i) => !merged.includes(i)).map((i) => i.url);
          put(w, at, toNewsJson({ updated: w.today, items: merged }, w.files.get(at)));
          const line = fresh.length
            ? `news ${layer}/${id}: ${fresh.length} new item${fresh.length === 1 ? "" : "s"} from ${sourcesLine(fresh.map((i) => i.url))}`
            : `news ${layer}/${id}: checked, nothing new`;
          return { line, extra: { added: fresh, skipped, dropped } };
        }),
    }),

    tool({
      name: "propose_option_update",
      title: "Propose changes to an option",
      description:
        "Changes fields on one existing option (content/options/<layer>/<id>.json) in an open changeset, merging into what is there: facts by label (a label already present gets the new value " +
        "in place, a new one is added; removeFacts drops facts by label), links and evidence by key (null removes one), sources by URL (removeSources drops some), model field by field. " +
        "goodFor, watchOut and how replace the whole list, and every item a new list drops comes back as a warning. Fields you leave out stay as they are. " +
        "id, order, name, logo, affiliation and exclusive can't be changed here (a logo is set with propose_logo's assign). Read the option with get_item first and pass its version as " +
        "expectedVersion, so a change someone made since is not overwritten. " +
        "Every fact you add or change (a [label, value] pair that is new or has a new value, or a model.<field>) needs a claim { field, url, quote }: field is the label exactly as in facts " +
        'or "model.<field>", and quote is 8 to 300 characters copied from a page you read with fetch_source, which the server finds in the text it fetched. ' +
        "A claim a machine can't check (PDF, paywall, script-only page) goes in manual with a reason instead, and sends the change to a person. " +
        "Verified claims are cited for you: the page joins sources and evidence[field]. Any other URL the content doesn't already cite must have been fetched too, url included (as https://<url>). " +
        'Set vendorReported on a number the vendor publishes about itself, and write its value with "(vendor-reported)". researched is set to today unless the patch sets it. ' +
        "Returns the staged path, the facts that changed or were removed, and warnings." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        layer: LAYER,
        id: z.string().describe("Option id, e.g. e2b"),
        patch: optionPatch.describe("The fields to change, merged into the option as described"),
        removeFacts: z.array(z.string()).optional().describe("Fact labels to remove, exactly as written"),
        removeSources: z.array(z.string()).optional().describe("Source URLs to remove; evidence that cited them goes too, with a warning"),
        claims: z.array(claim).optional().describe("One per added or changed fact, quoting a fetched page"),
        manual: z.array(manualClaim).optional().describe("Facts whose page a machine can't read; these send the change for review"),
        expectedVersion: VERSION.optional(),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, layer: layerInput, id, patch, removeFacts = [], removeSources = [], claims = [], manual = [], expectedVersion }) =>
        propose(deps, changeset, async (w) => {
          const { layer, option: before } = existingOption(w.files, layerInput, id);
          const at = paths.option(layer, id);
          await expectVersion(w, at, expectedVersion);
          const locked = IMMUTABLE.filter((k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(before[k]));
          if (locked.length)
            throw new ToolError(
              `A proposal can't change ${locked.join(", ")}; the maintainers set these by hand (RESEARCH.md rule 2)${locked.includes("logo") ? ", and propose_logo's assign sets a logo" : ""}.`,
              { fields: locked },
            );

          const changed = changedFields(before, patch.facts, patch.model);
          requireClaims(changed, claims, manual);
          await verifyClaims(deps.state, claims, w.now);
          const newSite = patch.url !== undefined && patch.url !== before.url ? siteUrl(patch.url) : [];
          await requireFetched(deps.state, [...urlsIn(patch), ...newSite], w.known, w.now);

          const next = mergeOption(w, at, before, patch, removeFacts, removeSources);
          next.researched = patch.researched ?? w.today;
          await cite(deps, w, next, claims);
          pruneEvidence(w, at, before, next, new Set([...Object.keys(patch.evidence ?? {}), ...claims.map((c) => c.field)]));
          for (const text of vendorWarnings(next, claims)) warn(w, at, text);
          for (const f of [...claims.map((c) => c.field), ...manual.map((m) => m.field), ...removeFacts]) w.resolves.add(`${at}|${f}`);
          w.manual.push(...manual.map((m) => ({ path: at, ...m })));
          put(w, at, toJson(arrange(next, Object.keys(before), OPTION_KEYS)));

          const fields = Object.keys(patch).filter((k) => k !== "researched");
          const removed = [...(removeFacts.length ? [`removed facts ${removeFacts.join(", ")}`] : []), ...(removeSources.length ? [`removed ${removeSources.length} sources`] : [])];
          const what = [...fields, ...removed].join(", ") || "re-checked";
          const facts = changed.length ? ` (facts: ${changed.join(", ")})` : "";
          const cited = [...[...claims, ...manual].map((c) => c.url), ...[...urlsIn(patch), ...newSite].filter((u) => !w.known.has(normalizeUrl(u)))];
          return { line: `option ${layer}/${id}: ${what}${facts} from ${sourcesLine(cited)}`, extra: { changedFacts: changed, removedFacts: removeFacts } };
        }),
    }),

    tool({
      name: "propose_option_create",
      title: "Propose a new option",
      description:
        "Adds a new option (a product, model, protocol or pattern) to a layer in an open changeset, with its empty news file (patterns have none). " +
        "Call check_duplicate first: a name, domain or repo matching an existing option or stack is refused unless notDuplicate says why they are different products. " +
        "id defaults to the name in kebab-case; order, affiliation, logo and exclusive are maintainer-only, leave them out (propose_logo's assign sets a logo). Follow docs/RESEARCH.md (get_research_rules) for the fields. " +
        "Every URL in the option must have been read with fetch_source (url as https://<url>), and every fact (and model.<field>) needs a claim quoting its page, or a manual entry with a reason, " +
        "as in propose_option_update; verified claims join sources and evidence. researched defaults to today. Returns the staged paths and warnings." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        layer: LAYER,
        option: z.strictObject({ ...optionFields, name: z.string().min(1).describe("The product's name") }).describe("The option as it will be written"),
        claims: z.array(claim).optional().describe("One per fact, quoting a fetched page"),
        manual: z.array(manualClaim).optional().describe("Facts whose page a machine can't read; these send the change for review"),
        notDuplicate: z.string().optional().describe("Only when check_duplicate found matches: why they are different products"),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, layer: layerInput, option: input, claims = [], manual = [], notDuplicate }) =>
        propose(deps, changeset, async (w) => {
          const layer = layerOf(w.files, layerInput);
          const reserved = RESERVED.filter((k) => input[k] !== undefined);
          if (reserved.length)
            throw new ToolError(`Leave out ${reserved.join(" and ")}: the maintainers set them${reserved.includes("logo") ? " (propose_logo's assign sets a logo)" : ""}.`, { fields: reserved });
          const id = kebab("id", input.id ?? slugify(input.name));
          const at = paths.option(layer, id);
          if (w.files.has(at)) throw new ToolError(`${at} already exists; change it with propose_option_update.`);

          const matches = checkDuplicate(w.files, { name: input.name, url: input.url ?? input.links?.site, repo: input.links?.repo });
          if (matches.length && !notDuplicate?.trim())
            throw new ToolError(
              "This may already be in the catalogue (RESEARCH.md rule 4). Update the existing entry instead, or send notDuplicate saying why these are different products.",
              { matches },
            );
          if (matches.length) {
            const names = matches.map((m) => (m.kind === "option" ? `${m.layer}/${m.id}` : `stack ${m.id}`)).join(", ");
            warn(w, at, `added next to possible duplicates ${names}: ${oneLine(notDuplicate!)}`);
          }

          requireClaims(changedFields({}, input.facts, input.model), claims, manual);
          await verifyClaims(deps.state, claims, w.now);
          // A new option is checked whole: every URL it cites needs a receipt, even one cited elsewhere.
          await requireFetched(deps.state, [...urlsIn(input), ...siteUrl(input.url)], new Set(), w.now);

          const o: Option = { ...input, id, researched: input.researched ?? w.today };
          await cite(deps, w, o, claims);
          for (const text of vendorWarnings(o, claims)) warn(w, at, text);
          w.resolves.add(`${at}|*`);
          w.manual.push(...manual.map((m) => ({ path: at, ...m })));
          put(w, at, toJson(arrange(o, [], OPTION_KEYS)));
          const newsAt = paths.news(layer, id);
          if (o.profile !== "pattern" && !w.files.has(newsAt)) put(w, newsAt, toJson({ updated: w.today, items: [] }));
          return { line: `new option ${layer}/${id} (${safeInline(o.name)}) from ${sourcesLine([...urlsIn(o), ...siteUrl(o.url)])}`, extra: { id } };
        }),
    }),

    tool({
      name: "propose_stack",
      title: "Propose a stack",
      description:
        "Creates or replaces a whole stack (content/stacks/<slug>.json) in an open changeset. The object replaces the file: to change an existing stack, get_item it first " +
        "(pass changeset), edit it, send all of it, and pass the version get_item returned as expectedVersion, which replacing an existing stack requires (a field you leave out is removed, and a warning names it). " +
        "slug defaults to the name in kebab-case. disclosure is required, and on a real product every picked layer and every inUseUndisclosed layer needs evidence URLs (docs/RESEARCH.md, " +
        "'Researching a stack'). URLs the content doesn't already cite must have been read with fetch_source first. researched defaults to today. Returns the staged path, whether it replaced a stack, and warnings." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        stack: stackInput.describe("The whole stack, as it will be written"),
        expectedVersion: VERSION.optional().describe("Required to replace an existing stack: the version get_item returned for it"),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, stack: input, expectedVersion }) =>
        propose(deps, changeset, async (w) => {
          const slug = kebab("slug", input.slug ?? slugify(input.name));
          const at = paths.stack(slug);
          await expectVersion(w, at, expectedVersion, true);
          const before = stack(w.files, slug);
          await requireFetched(deps.state, urlsIn(input), w.known, w.now);

          const s: Stack = { ...input, slug, researched: input.researched ?? w.today };
          if (before) {
            const lost = Object.keys(before).filter((k) => !(k in s));
            if (lost.length) warn(w, at, `the new version leaves out ${lost.join(", ")}`);
          } else {
            const twins = checkDuplicate(w.files, { name: s.name, url: s.links?.site, repo: s.links?.repo }).filter((m) => m.kind === "stack");
            if (twins.length) warn(w, at, `may duplicate ${twins.map((m) => `stack ${m.id} (${m.why.join(", ")})`).join("; ")}`);
          }
          if (s.disclosure !== "example") {
            const bare = [...Object.keys(s.layers), ...(s.inUseUndisclosed ?? [])].filter((l) => !s.evidence?.[l]?.length);
            if (bare.length) warn(w, at, `no evidence for ${bare.join(", ")} (RESEARCH.md: every pick on a real product needs a source)`);
          }
          put(w, at, toJson(arrange(s, before ? Object.keys(before) : [], STACK_KEYS)));
          return {
            line: `stack ${slug} ${before ? "replaced" : "added"} from ${sourcesLine([...urlsIn(input)].filter((u) => !w.known.has(normalizeUrl(u))))}`,
            extra: { replaced: Boolean(before) },
          };
        }),
    }),

    tool({
      name: "propose_hot_list",
      title: "Propose the hot list",
      description:
        "Replaces content/hot.json, the 'Hot right now' cards on the home page, in an open changeset. Read the current list with get_hot_list (or get_item kind hot, whose version " +
        "goes in expectedVersion) and the rules in docs/HOT.md first, then send both rows in full, in rank order (most talked about first), at most 6 each: stacks name agent products by " +
        "stack slug, options name components as layer/id. A product with no page gets one first, in the same changeset (propose_stack or propose_option_create). Each item has why (one " +
        "plain sentence, at most 120 characters, no hype words), since, and 1 to 4 sources, an x.com post first when there is one and at least one dated in the last 7 days. Every source " +
        "must have been read in the last 48 hours, even one the content already cites: posts on X through search_x, everything else through fetch_source. A post's title credits its own " +
        "author (\"@author: its first words\"); crediting anyone else is refused. The server sets updated to today and from to 7 days earlier; source titles and dates that differ from " +
        "the pages come back as warnings." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        stacks: z.array(z.strictObject({ stack: z.string().describe("Stack slug, e.g. openclaw"), ...hotFields })).describe("Agent products, in rank order; [] for none"),
        options: z.array(z.strictObject({ option: z.string().describe("layer/id, e.g. model/claude-opus-5-5"), ...hotFields })).describe("Components, in rank order; [] for none"),
        expectedVersion: VERSION.optional(),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, stacks: stackRow, options: optionRow, expectedVersion }) =>
        propose(deps, changeset, async (w) => {
          // The list is replaced whole, so it must be built on the one that is there now.
          await expectVersion(w, paths.hot, expectedVersion, true);
          const updated = w.today;
          const from = day(w.now - HOT_WINDOW_DAYS * 864e5);
          const sources = [...stackRow, ...optionRow].flatMap((it) => it.sources);
          // The list is about this week, so every source needs its own fresh receipt, even one cited before.
          const fresh = { maxAgeMs: HOT_RECEIPT_MS };
          await requireFetched(deps.state, sources.map((s) => s.url), new Set(), w.now, fresh);
          const miscredited: { url: string; credited: string; author: string }[] = [];
          for (const s of sources) {
            const page = await pageFor(deps.state, s.url, w.now, fresh);
            if (!page) continue;
            const wrong = wrongAuthor(page, s.title);
            if (wrong) miscredited.push({ url: s.url, ...wrong });
            if (hotTitleDiffers(page, s.title)) warn(w, paths.hot, `${safeInline(s.title)} differs from the page's title ${safeInline(page.title ?? "")} (${s.url})`);
            if (page.published && page.published !== s.date) warn(w, paths.hot, `${s.url} is dated ${s.date} here, the page says ${safeInline(page.published)}`);
          }
          if (miscredited.length)
            throw new ToolError("A post's title must credit its own author, as its receipt names them: retitle these \"@author: its first words\" with the real author.", { miscredited });
          const card = (it: { why: string; since?: string; sources: { title: string; url: string; date: string }[] }) => ({
            why: it.why,
            ...(it.since ? { since: it.since } : {}),
            sources: it.sources.map(({ title, url, date }) => ({ title, url, date })),
          });
          const list: Hot = {
            updated,
            from,
            stacks: stackRow.map((it) => ({ stack: it.stack, ...card(it) })),
            options: optionRow.map((it) => ({ option: it.option, ...card(it) })),
          };
          put(w, paths.hot, toJson(list));
          return { line: `hot list ${updated}: ${stackRow.length} stacks, ${optionRow.length} options from ${sourcesLine(sources.map((s) => s.url))}`, extra: { updated, from } };
        }),
    }),

    tool({
      name: "propose_prompt",
      title: "Propose a published prompt",
      description:
        "Adds or replaces a prompt a stack's makers publish (content/prompts/<stack>/<id>.md) in an open changeset, filed under the layer it drives. Official sources only (the " +
        "project's repo pinned to a full commit SHA, or the vendor's own docs), copied verbatim, under a licence that allows it (docs/RESEARCH.md, 'Prompts'). Fetch the source " +
        "with fetch_source first: a system-prompt or instruction-file must appear on that page in full; for a template or tool-prompt, the first 200 characters of literal text " +
        "(placeholders such as {{name}}, ${name} or <dynamic: …> aside) must. When the page can't show it (text assembled in code, an excerpt with gaps, a label you added), " +
        "give manualReason and the prompt is flagged for a person to check. retrieved is the day the source was fetched. Returns the staged path and whether it replaced a prompt." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        stack: z.string().describe("The stack's slug, e.g. openclaw"),
        id: z.string().describe("Kebab-case file name, e.g. heartbeat-prompt"),
        layer: LAYER,
        kind: z.enum(["system-prompt", "instruction-file", "tool-prompt", "template"]),
        title: z.string().trim().min(1),
        source: z.string().describe("Where the text was copied from: a GitHub blob URL pinned to a commit SHA, or the vendor's docs"),
        license: z.string().trim().min(1).describe('e.g. MIT, Apache-2.0, or "published by <vendor>"'),
        note: z.string().optional().describe("One paragraph: how the prompt is used, what was left out or added"),
        text: z.string().describe("The prompt, verbatim"),
        manualReason: z.string().optional().describe("Why the page can't show the text as given; flags the prompt for a person to check"),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, stack: slug, id, layer: layerInput, kind, title, source: url, license, note, text, manualReason }) =>
        propose(deps, changeset, async (w) => {
          if (!stack(w.files, slug)) throw new ToolError(`No stack "${slug}"; prompts are filed under an existing stack (add one with propose_stack).`);
          kebab("id", id);
          const layer = layerOf(w.files, layerInput);
          if (!isHttps(url)) throw new ToolError("source must be a full https URL.");
          if (/github\.com\/[^/]+\/[^/]+\/blob\//.test(url) && !/\/blob\/[0-9a-f]{40}\//.test(url))
            throw new ToolError("Pin a GitHub source to a full 40-character commit SHA (…/blob/<sha>/path) so the copy can be checked against it.");
          if (!text.trim()) throw new ToolError("text is empty.");

          await requireFetched(deps.state, [url], new Set(), w.now);
          const page = (await pageFor(deps.state, url, w.now)) as Page;
          const at = paths.prompt(slug, id);
          // The whole prompt is checked again, so an earlier manual entry on it goes.
          w.resolves.add(`${at}|*`);
          // A prompt shipped as one block must be on the page whole; text assembled in code only in its opening.
          const whole = kind === "system-prompt" || kind === "instruction-file";
          const missing = whole ? notOnPage(page.text, text).slice(0, 5) : notOnPage(page.text, text, TEMPLATE_OPENING);
          if (whole ? !containsQuote(page.text, text) : missing.length > 0) {
            if (!manualReason?.trim())
              throw new ToolError(
                whole
                  ? "The text isn't on the source page as fetched. Copy it verbatim, or give manualReason if the page can't show it as one block."
                  : `The first ${TEMPLATE_OPENING} characters of literal text aren't on the source page as fetched. Copy them verbatim, or give manualReason.`,
                { notFound: missing.length ? missing : ["each line is on the page, but not together in this order"] },
              );
            w.manual.push({ path: at, field: `prompt ${slug}/${id}`, url, reason: oneLine(manualReason) });
          }

          const header = [
            `layer: ${layer}`,
            `kind: ${kind}`,
            `title: ${oneLine(title)}`,
            `source: ${url}`,
            `license: ${oneLine(license)}`,
            `retrieved: ${day(Date.parse(page.fetchedAt))}`,
            ...(note?.trim() ? [`note: ${oneLine(note)}`] : []),
          ];
          const file = `---\n${header.join("\n")}\n---\n${text.replace(/\s+$/, "")}\n`;
          if (file.length > PROMPT_MAX) throw new ToolError(`The file would be ${file.length} characters; keep it under ${PROMPT_MAX}: keep the relevant part and say so in note.`);
          const replaced = w.files.has(at);
          put(w, at, file);
          return { line: `prompt ${slug}/${id} (${kind}) ${replaced ? "replaced" : "added"} from ${url}`, extra: { replaced } };
        }),
    }),

    tool({
      name: "propose_logo",
      title: "Propose a logo",
      description:
        "Adds or replaces a logo (content/logos/<name>.svg) in an open changeset, and can set it as the logo of an option or a stack in the same call. The SVG is held to the same " +
        "strict rules as `npm run check`: one <svg> with a viewBox, under 8,000 bytes, only plain shapes (path, g, rect, clipPath and the like) in one colour (fill and stroke only " +
        "currentColor or none, so the logo follows the theme), and no scripts, styles, classes, comments, event handlers, links outside the file or external url(). A file that breaks " +
        "a rule is refused with the list of problems; the server never rewrites it, so fix the file (svgo helps) and send it again. Returns the staged paths and whether it replaced a logo." +
        STAGED_ONLY,
      input: z.object({
        changeset: CHANGESET,
        name: z.string().describe("Kebab-case file name without .svg, usually the product's name, e.g. e2b"),
        svg: z.string().describe("The whole SVG file"),
        assign: z
          .strictObject({
            option: z.string().optional().describe("layer/id of an option to give this logo"),
            stack: z.string().optional().describe("Slug of a stack to give this logo"),
          })
          .optional(),
      }),
      scope: "content:write",
      annotations: WRITE,
      run: ({ changeset, name, svg, assign }) =>
        propose(deps, changeset, async (w) => {
          kebab("name", name);
          const problems = logoProblems(svg.trim());
          if (problems.length) throw new ToolError("This SVG can't be a logo. Fix these and send it again; the server doesn't rewrite logos.", { problems });
          const at = paths.logo(name);
          const replaced = w.files.has(at);
          put(w, at, svg.trim());

          const on: string[] = [];
          if (assign?.option) {
            const [l, oid, extra] = assign.option.split("/");
            if (!l || !oid || extra !== undefined) throw new ToolError(`assign.option "${assign.option}" must be layer/id, e.g. sandbox/e2b.`);
            const { layer, option: o } = existingOption(w.files, l, oid);
            put(w, paths.option(layer, oid), toJson(arrange({ ...o, logo: name }, Object.keys(o), OPTION_KEYS)));
            on.push(`${layer}/${oid}`);
          }
          if (assign?.stack) {
            const s = stack(w.files, assign.stack);
            if (!s) throw new ToolError(`No stack "${assign.stack}".`);
            put(w, paths.stack(assign.stack), toJson(arrange({ ...s, logo: name }, Object.keys(s), STACK_KEYS)));
            on.push(`stack ${assign.stack}`);
          }
          return { line: `logo ${name} ${replaced ? "replaced" : "added"}${on.length ? `, set on ${on.join(" and ")}` : ""}`, extra: { replaced } };
        }),
    }),
  ];
}
