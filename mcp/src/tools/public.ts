// The public tools: anyone's agent reads the catalogue through the site's own JSON API, checks a
// draft with the validator CI runs, and gets back the file and the links its user needs to open a
// pull request or an issue as themselves. Nothing here writes or stores anything, so the admin
// server registers the same tools for its own agents.
import { z } from "zod";
import { newFileUrl, slugify } from "../../../lib/github";
import { layerIdFrom, optionHref, renamedLayers } from "../../../lib/links";
import { type Row, search, why, whyText } from "../../../lib/search";
import { encodeDraft } from "../../../lib/share";
import { check } from "../core/changeset";
import { checkDuplicate, hot as readHot, layers as contentLayers, news as readNews, option as readOption, options as contentOptions, paths, stack as readStack, stacks as contentStacks, toJson } from "../core/content";
import type { PublicDeps } from "../core/deps";
import { READ_ONLY, ToolError, type ToolSpec, tool } from "../core/tool";
import type { Files } from "../core/types";

/** How to read a stack without overclaiming, shared by the tool descriptions and the server instructions. */
export const STACK_READING =
  "`disclosure` decides what an empty layer means. open-source and example stacks list everything they use, so a missing layer is not used. documented and closed stacks list only what the makers or reputable press published, so layers in notDisclosed are unknown, not absent (an open-source stack with closed parts lists the layers only those parts could fill there too). Layers in inUseUndisclosed are present, a source says so, but the component isn't named. Layers in notUsed are confirmed absent. A pick with supported: true is something the stack can be configured to use, not what it runs by default. Every pick on a real product carries evidence URLs: cite them. A stack with disclosure example is a design written for the site, not a product, so never read its picks as adoption.";

/** The catalogue readers: what the admin server registers from here, besides its own tools. */
export const PUBLIC_READ_TOOLS = ["search_stackprints", "list_layers", "get_layer", "get_option", "list_stacks", "get_stack", "get_hot"] as const;

const LAYER_INPUT = 'Layer id ("memory", "router", "proactivity") or its display name ("Model gateway", "Triggers"); list_layers has all 28.';
const DISCLOSURES = ["open-source", "documented", "closed", "example"] as const;
const URL_LIMIT = 8000;

// Shapes of the site's JSON API (lib/agent.ts builds them), as far as these tools read them.
type ApiOption = { id: string; name: string; note?: string; profile?: string; open?: boolean; affiliation?: string; url: string; api: string };
type ApiLayer = { id: string; name: string; band: string; ref: string; description: string; url: string; api: string; options: ApiOption[] };
type ApiStackRow = { slug: string; name: string; kind: string; tagline: string; disclosure?: string | null; url: string; api: string };
type ApiStack = ApiStackRow & { layers: { id: string; picks: (ApiOption & { supported?: boolean })[] }[] };

const abs = (deps: PublicDeps, path: string) => new URL(path, deps.siteUrl).href;
const isHttps = (u: unknown) => {
  try {
    return typeof u === "string" && new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};
/** "https://github.com/mehdidjabri/stackprints" → "mehdidjabri/stackprints". */
const repoPath = (repo: string) => new URL(repo).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
const quote = (s: string) => `"${s.replace(/["\\$`]/g, "\\$&")}"`;
const withinUrlLimit = (url: string) => (url.length < URL_LIMIT ? url : null);

async function apiLayers(deps: PublicDeps) {
  const d = await deps.api.json<{ layers: ApiLayer[] }>("/api/layers.json");
  if (!d) throw new ToolError("The layer list is unavailable right now; try again shortly.");
  return d.layers;
}

/** A layer from an id or a display name, or an error that lists every valid id. */
async function resolveLayer(deps: PublicDeps, input: string) {
  const all = await apiLayers(deps);
  const layer = all.find((l) => l.id === layerIdFrom(all, input));
  if (!layer)
    throw new ToolError(`No layer "${input}". Use one of these ids (display names work too): ${all.map((l) => l.id).join(", ")}.`, {
      layers: all.map((l) => ({ id: l.id, name: l.name })),
    });
  return { layer, all };
}

const findOption = (options: { id: string; name: string }[], input: string) =>
  options.find((o) => o.id === input) ?? options.find((o) => o.id === slugify(input) || slugify(o.name) === slugify(input));

// --- Drafts -------------------------------------------------------------------------------------

const sourceInput = z.object({ title: z.string(), url: z.string() });
const layerMap = <T extends z.ZodType>(v: T) => z.record(z.string(), v);

const stackDraft = z
  .looseObject({
    slug: z.string().optional().describe("File name, kebab-case; defaults to the name slugified"),
    name: z.string().min(1).describe("The product or project name"),
    kind: z.string().optional().describe('What it is, e.g. "Personal agent", "Coding agent" (list_stacks returns the kinds in use)'),
    tagline: z.string().optional().describe("One line people read in the grid"),
    description: z.string().optional().describe("Two or three neutral sentences on how it works; an example design starts with 'An example design for…'"),
    disclosure: z
      .string()
      .optional()
      .describe("open-source (the code is public), documented (the vendor documents its architecture), closed (announcements and press only) or example (a design, not a product)"),
    layers: layerMap(z.union([z.string(), z.array(z.string())])).describe('Layer id to option id or ids, e.g. { "model": "claude-sonnet-5-5", "channels": ["telegram", "email"] }; get_layer lists the ids'),
    evidence: layerMap(z.array(z.string())).optional().describe("Layer id to the https URLs that back the pick; every picked layer of a real product needs one"),
    sources: z.array(sourceInput).optional().describe("Pages the stack is built from, as { title, url } with https URLs"),
    notUsed: z.array(z.string()).optional().describe("Layers a source confirms are absent"),
    inUseUndisclosed: z.array(z.string()).optional().describe("Layers a source confirms are present without naming the component; each needs evidence"),
    closedLayers: z.array(z.string()).optional().describe("Open-source stacks with closed parts: the layers only those parts could fill"),
    supports: layerMap(z.array(z.string())).optional().describe("Layer id to the picks that are configurable rather than the default"),
    links: z.record(z.string(), z.string()).optional().describe("site, repo, docs, announcement: https URLs"),
    author: z.object({ name: z.string(), url: z.string().optional() }).optional().describe("Who made or submitted the stack"),
    researched: z.string().optional().describe("YYYY-MM-DD, the day the picks were checked"),
    version: z.string().optional().describe("The release the picks were mapped from (real products only)"),
  })
  .describe("A stack in the shape of content/stacks/<slug>.json");

const optionDraft = z
  .looseObject({
    id: z.string().optional().describe("kebab-case file name; defaults to the name slugified"),
    name: z.string().min(1).describe("The product, model, protocol or pattern name"),
    url: z.string().optional().describe("Domain or URL without protocol, e.g. e2b.dev"),
    note: z.string().optional().describe("3 to 8 word descriptor, under 60 characters"),
    open: z.boolean().optional().describe("Open source or open weights"),
    profile: z.string().optional().describe("model, product, protocol or pattern"),
    summary: z.string().optional().describe("Two or three neutral sentences: what it is, how it works, who it's for"),
    facts: z.array(z.array(z.string())).optional().describe('Datasheet rows as [label, value] pairs; a number the vendor publishes about itself ends in "(vendor-reported)"'),
    links: z.record(z.string(), z.string()).optional().describe("site, docs, repo, pricing, changelog, blog, x: https URLs you checked"),
    goodFor: z.array(z.string()).optional().describe("At most 3 short phrases"),
    watchOut: z.array(z.string()).optional().describe("At most 3 short honest caveats"),
    how: z.array(z.string()).optional().describe("Pattern steps, 3 to 5"),
    model: z.record(z.string(), z.unknown()).optional().describe("Models only: lab, released, context, priceIn, priceOut, modalities, weights, openrouter"),
    sources: z.array(sourceInput).optional().describe("At least one page the facts come from, as { title, url }"),
    evidence: z.record(z.string(), z.array(z.string())).optional().describe('Fact label, "model.<field>" or "watchOut.<n>" to the source URLs that back it'),
    researched: z.string().optional().describe("YYYY-MM-DD"),
  })
  .describe("An option in the shape of content/options/<layer>/<id>.json");

type StackDraft = z.infer<typeof stackDraft>;
type OptionDraft = z.infer<typeof optionDraft>;

// The key order the repo's own files use, so a submitted file reads like its neighbours.
const STACK_KEYS = ["slug", "name", "logo", "kind", "tagline", "description", "author", "links", "disclosure", "sources", "layers", "supports", "inUseUndisclosed", "notUsed", "closedLayers", "evidence", "researched", "version"];
const OPTION_KEYS = ["id", "name", "url", "note", "open", "profile", "summary", "how", "facts", "model", "links", "goodFor", "watchOut", "sources", "evidence", "researched"];

function ordered<T extends Record<string, unknown>>(o: T, keys: string[]): T {
  const out: Record<string, unknown> = {};
  for (const k of [...keys, ...Object.keys(o).filter((k) => !keys.includes(k))]) if (o[k] !== undefined) out[k] = o[k];
  return out as T;
}

/** The draft with its slug settled and layer names turned into ids, as the file would be written. */
function settleStack(files: Files, draft: StackDraft) {
  const slug = draft.slug ?? slugify(draft.name);
  if (!slug) throw new ToolError("The stack needs a name with letters or digits, or a slug.");
  if (slugify(slug) !== slug) throw new ToolError(`slug must be kebab-case, e.g. "${slugify(slug)}".`);
  const all = contentLayers(files);
  const renamed = new Set<string>();
  const fix = (k: string) => {
    const id = layerIdFrom(all, k);
    if (id !== k) renamed.add(`${k} → ${id}`);
    return id;
  };
  const keys = <V>(r?: Record<string, V>) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [fix(k), v])) : undefined);
  const list = (a?: string[]) => a?.map(fix);
  const stack = ordered(
    {
      ...draft,
      slug,
      layers: keys(draft.layers) ?? {},
      evidence: keys(draft.evidence),
      supports: keys(draft.supports),
      notUsed: list(draft.notUsed),
      inUseUndisclosed: list(draft.inUseUndisclosed),
      closedLayers: list(draft.closedLayers),
    },
    STACK_KEYS,
  );
  return { stack, slug, path: paths.stack(slug), renamed: [...renamed] };
}

type ChecklistItem = { rule: string; status: "ok" | "missing" | "confirm"; detail?: string };

/** docs/RESEARCH.md's stack rules, each marked ok, missing, or for the user to confirm (a machine can't tell). */
function stackChecklist(s: StackDraft, valid: boolean): ChecklistItem[] {
  const disclosure = DISCLOSURES.find((d) => d === s.disclosure);
  const items: ChecklistItem[] = [
    { rule: "npm run check passes (the validator CI runs)", status: valid ? "ok" : "missing" },
    {
      rule: "disclosure is honest: open-source only if the code is public, documented if the vendor documents the architecture in depth, closed for announcements and press, example for a design",
      status: disclosure ? "confirm" : "missing",
      ...(disclosure ? {} : { detail: `set disclosure to one of ${DISCLOSURES.join(", ")}` }),
    },
  ];
  if (disclosure === "example") {
    items.push({ rule: "the description starts with 'An example design for…' and stays neutral", status: s.description?.startsWith("An example design for") ? "ok" : "missing" });
    items.push({ rule: "sources are further reading (the harness's docs and the parts the design hinges on), not evidence", status: "confirm" });
  } else {
    const bare = Object.keys(s.layers ?? {}).filter((l) => !s.evidence?.[l]?.length);
    items.push({
      rule: "every picked layer has evidence: URLs of pages you opened, first-party where possible (RESEARCH.md rule 1)",
      status: bare.length ? "missing" : "ok",
      ...(bare.length ? { detail: `no evidence for: ${bare.join(", ")}` } : {}),
    });
    items.push({ rule: "sources list the pages the picks come from, as { title, url } with https URLs", status: s.sources?.length ? "ok" : "missing" });
    items.push({ rule: "no guessed picks: a layer no source names is left out (on documented and closed stacks it reads 'not disclosed')", status: "confirm" });
    items.push({
      rule: "notUsed only where a source shows the layer is absent, with that page in sources",
      status: !s.notUsed?.length ? "ok" : s.sources?.length ? "confirm" : "missing",
    });
    items.push({ rule: "researched is the day the picks were checked (YYYY-MM-DD); version names the release they were mapped from, when there is one", status: s.researched ? "ok" : "missing" });
  }
  items.push({ rule: "the description is neutral and says what is public (no 'best', 'leading', 'seamless')", status: "confirm" });
  return items;
}

/** Runs the content checks on the repository with the draft written at its path. */
async function checkStack(deps: PublicDeps, draft: StackDraft) {
  const files = await deps.files();
  const { stack, slug, path, renamed } = settleStack(files, draft);
  const json = toJson(stack);
  const result = check(files, { [path]: json }, deps.now());
  const mine = (e: string) => e.startsWith(`${slug}.json:`) || e.includes(path);
  const checklist = stackChecklist(stack, result.ok);
  const todo = checklist.filter((c) => c.status === "missing" && c !== checklist[0]).map((c) => (c.detail ? `${c.rule} (${c.detail})` : c.rule));
  const related = result.errors.filter((e) => !mine(e));
  const layers = Object.fromEntries(Object.entries(stack.layers).map(([k, v]) => [k, [v].flat()]));
  return {
    ok: result.ok,
    slug,
    path,
    exists: files.has(path),
    errors: result.errors.filter(mine),
    // Raised on another file by adding this one, e.g. an option's "Used by" fact naming this stack.
    ...(related.length ? { relatedErrors: related } : {}),
    warnings: [...result.warnings.filter(mine), ...todo],
    ...(renamed.length ? { renamedLayers: renamed } : {}),
    stack,
    json,
    checklist,
    boardUrl: `${deps.siteUrl.replace(/\/$/, "")}/#s=${encodeDraft({ name: stack.name, layers })}`,
  };
}

function ghSteps(deps: PublicDeps, { path, branch, title, body }: { path: string; branch: string; title: string; body: string }) {
  const repo = repoPath(deps.repo);
  return [
    `gh repo fork ${repo} --clone && cd ${repo.split("/")[1]}`,
    `git checkout -b ${branch}`,
    `Write the json above to ${path} exactly as given (two-space indent, trailing newline).`,
    "npm ci && npm run check",
    `git add ${path} && git commit -m ${quote(title)}`,
    `git push -u origin ${branch}`,
    `gh pr create --repo ${repo} --base main --title ${quote(title)} --body ${quote(body)}`,
  ];
}

// --- Corrections --------------------------------------------------------------------------------

type CorrectionArgs = { kind: "option" | "stack" | "layer" | "news" | "hot"; layer?: string; id?: string; slug?: string };

/** The file and page a correction is about, or an error naming what does exist. */
function correctionTarget(deps: PublicDeps, files: Files, a: CorrectionArgs) {
  const all = contentLayers(files);
  const needLayer = () => {
    if (!a.layer) throw new ToolError(`A ${a.kind} correction needs layer.`);
    const layer = all.find((l) => l.id === layerIdFrom(all, a.layer!));
    if (!layer) throw new ToolError(`No layer "${a.layer}". Valid ids: ${all.map((l) => l.id).join(", ")}.`, { layers: all.map((l) => l.id) });
    return layer;
  };
  switch (a.kind) {
    case "layer": {
      const l = needLayer();
      return { name: `${l.name} layer`, path: paths.layers, page: abs(deps, `/layer/${l.id}/`), data: l as unknown };
    }
    case "option":
    case "news": {
      const l = needLayer();
      if (!a.id) throw new ToolError(`A ${a.kind} correction needs id, the option's id (get_layer lists them).`);
      const o = readOption(files, l.id, a.id) ?? findOption(contentOptions(files, l.id), a.id);
      if (!o) throw new ToolError(`No option "${a.id}" in ${l.id}. get_layer ${l.id} lists its options.`, { options: contentOptions(files, l.id).map((x) => x.id) });
      const page = abs(deps, optionHref(l.id, o.id));
      return a.kind === "option"
        ? { name: o.name, path: paths.option(l.id, o.id), page, data: o as unknown }
        : { name: `${o.name} news`, path: paths.news(l.id, o.id), page, data: readNews(files, l.id, o.id) as unknown };
    }
    case "stack": {
      if (!a.slug) throw new ToolError("A stack correction needs slug.");
      const s = readStack(files, a.slug) ?? contentStacks(files).find((x) => slugify(x.name) === slugify(a.slug!));
      if (!s) throw new ToolError(`No stack "${a.slug}". Valid slugs: ${contentStacks(files).map((x) => x.slug).join(", ")}.`, { slugs: contentStacks(files).map((x) => x.slug) });
      return { name: s.name, path: paths.stack(s.slug), page: abs(deps, `/stack/${s.slug}/`), data: s as unknown };
    }
    case "hot": {
      const h = readHot(files);
      if (!h) throw new ToolError("There is no hot list to correct.");
      return { name: "Hot right now", path: paths.hot, page: abs(deps, "/"), data: h as unknown };
    }
  }
}

/** Whether a field names something on the target: a key path ("model.context", "links.site") or a fact label. */
function hasField(data: unknown, field: string) {
  const d = data as { facts?: unknown } | undefined;
  if (Array.isArray(d?.facts) && d.facts.some((f) => Array.isArray(f) && String(f[0]).toLowerCase() === field.toLowerCase())) return true;
  let cur: unknown = data;
  for (const part of field.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

// --- GitHub status ------------------------------------------------------------------------------

type GhUser = { login: string };
type GhPull = { number: number; state: string; merged?: boolean; merged_at?: string | null; draft?: boolean; title: string; html_url: string; updated_at: string; user?: GhUser; head?: { sha: string } };
type GhIssue = { number: number; state: string; state_reason?: string | null; title: string; html_url: string; updated_at: string; user?: GhUser; labels?: { name: string }[]; comments?: number };
type GhRuns = { total_count: number; check_runs: { name: string; status: string; conclusion: string | null }[] };

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
const STATUS_TTL = 60_000;
const STATUS_CACHED = 200;

/**
 * Submission answers by "repo#number", kept a minute in this isolate: an agent asking twice, or many
 * users asking about one pull request, costs GitHub one read.
 */
const statusCache = new Map<string, { at: number; value: Record<string, unknown> }>();

function github(deps: PublicDeps) {
  const base = `https://api.github.com/repos/${repoPath(deps.repo)}`;
  return async (path: string) => {
    try {
      return await deps.fetch(`${base}${path}`, {
        headers: {
          "User-Agent": "stackprints-mcp",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(deps.githubToken ? { Authorization: `Bearer ${deps.githubToken}` } : {}),
        },
      });
    } catch (e) {
      throw new ToolError(`Could not reach GitHub: ${(e as Error).message}. Try again shortly.`);
    }
  };
}

function githubError(deps: PublicDeps, r: Response, what: string) {
  const limited = r.status === 403 || r.status === 429;
  const who = deps.githubToken ? "this server's" : "anonymous";
  return new ToolError(limited ? `GitHub is rate-limiting ${who} reads (${r.status}); try again in a few minutes.` : `GitHub answered ${r.status} for ${what}.`);
}

/** A pull request (with its checks) or else an issue, by number. */
async function submissionStatus(deps: PublicDeps, number: number): Promise<Record<string, unknown>> {
  const gh = github(deps);
  const pr = await gh(`/pulls/${number}`);
  if (pr.ok) {
    const p = (await pr.json()) as GhPull;
    const merged = Boolean(p.merged ?? p.merged_at);
    let checks: { total: number; passed: number; failing: string[]; pending: string[] } | undefined;
    if (p.head?.sha) {
      const r = await gh(`/commits/${p.head.sha}/check-runs?per_page=100`);
      if (r.ok) {
        const runs = ((await r.json()) as GhRuns).check_runs;
        const failing = runs.filter((c) => c.conclusion && FAILED.has(c.conclusion)).map((c) => c.name);
        const pending = runs.filter((c) => c.status !== "completed").map((c) => c.name);
        checks = { total: runs.length, passed: runs.length - failing.length - pending.length, failing, pending };
      }
    }
    return {
      kind: "pull",
      number: p.number,
      state: merged ? "merged" : p.state,
      merged,
      ...(p.draft ? { draft: true } : {}),
      title: p.title,
      url: p.html_url,
      updatedAt: p.updated_at,
      ...(p.user ? { author: p.user.login } : {}),
      ...(checks ? { checks } : {}),
    };
  }
  if (pr.status !== 404) throw githubError(deps, pr, `pull request #${number}`);
  const is = await gh(`/issues/${number}`);
  if (is.status === 404) throw new ToolError(`No pull request or issue #${number} on ${repoPath(deps.repo)}.`);
  if (!is.ok) throw githubError(deps, is, `issue #${number}`);
  const i = (await is.json()) as GhIssue;
  return {
    kind: "issue",
    number: i.number,
    state: i.state,
    ...(i.state_reason ? { stateReason: i.state_reason } : {}),
    title: i.title,
    url: i.html_url,
    updatedAt: i.updated_at,
    ...(i.user ? { author: i.user.login } : {}),
    labels: (i.labels ?? []).map((x) => x.name),
    comments: i.comments ?? 0,
  };
}

// --- Tools --------------------------------------------------------------------------------------

export function publicTools(deps: PublicDeps): ToolSpec[] {
  return [
    tool({
      name: "search_stackprints",
      title: "Search Stackprints",
      description:
        "Full-text search over Stackprints: agent stacks (OpenClaw, Claude Code, Codex…), the 28 layers (model, harness, memory, sandbox…) and the components in them (OpenRouter, E2B, Langfuse…). Returns matches best first, each with kind (stack, layer or option), title, subtitle, the page URL to cite, and `matched` when the hit is in a stack's parts or the page text rather than its title. Use it first when you have a name or a topic, then call get_stack, get_layer or get_option on what it finds.",
      input: z.object({
        query: z.string().min(1).describe("What to look for, e.g. 'memory', 'browser use', 'OpenClaw'"),
        limit: z.number().int().min(1).max(50).optional().describe("At most this many results (default 15)"),
      }),
      annotations: READ_ONLY,
      run: async ({ query, limit = 15 }) => {
        const rows = await deps.api.json<Row[]>("/search.json");
        if (!rows) throw new ToolError("The search index is unavailable right now; list_layers and list_stacks still work.");
        const results = search(rows, query, limit).map((r) => {
          const w = why(r, query);
          const [kind, title, subtitle, href] = r;
          return { kind, title, subtitle, url: abs(deps, href), ...(w ? { matched: whyText(w) } : {}) };
        });
        return { query, count: results.length, results };
      },
    }),

    tool({
      name: "list_layers",
      title: "List the layers",
      description:
        "The 28 layers every agent stack is drawn with, in 5 bands from top to bottom: surface (where people and events reach the agent), brain (harness, model, gateway, instructions), hands (tools, sandbox, browser, connectors, payments), files (memory, retrieval, sessions) and ops (hosting, durable execution, guardrails, identity, observability). Each layer has its id, name, band, board designator (ref), description, page URL and how many options it has. Use it to map a goal onto layers, then get_layer to compare the options in one. Some ids differ from the names shown; `idsThatDifferFromNames` lists them.",
      input: z.object({}),
      annotations: READ_ONLY,
      run: async () => {
        const all = await apiLayers(deps);
        return {
          count: all.length,
          bands: ["surface", "brain", "hands", "files", "ops"],
          idsThatDifferFromNames: renamedLayers(all),
          layers: all.map((l) => ({ id: l.id, name: l.name, band: l.band, ref: l.ref, description: l.description, url: l.url, optionCount: l.options.length })),
        };
      },
    }),

    tool({
      name: "get_layer",
      title: "Get a layer",
      description:
        "One layer and every option in it: id, name, note, profile (model, product, protocol or pattern), open (open source or open weights), summary and page URL, plus the prompts stacks publish for that layer. An option with `affiliation` is made by the people behind Stackprints: say so whenever you mention it. Use it to compare choices, then get_option for one option's datasheet. Accepts a layer id or display name.",
      input: z.object({ layer: z.string().min(1).describe(LAYER_INPUT) }),
      annotations: READ_ONLY,
      run: async ({ layer }) => {
        const { layer: l } = await resolveLayer(deps, layer);
        const data = await deps.api.json<Record<string, unknown>>(`/api/layers/${l.id}.json`);
        if (!data) throw new ToolError(`The ${l.id} layer page is unavailable right now.`);
        return data;
      },
    }),

    tool({
      name: "get_option",
      title: "Get an option's datasheet",
      description:
        "One component's datasheet: summary, facts (each cited, numbers the vendor publishes about itself marked 'vendor-reported'), links, good for, watch out, model fields for models, recent news, and the stacks that use it. `usage` counts real stacks and example designs apart: examples are designs, not adoption. Quote facts as written and cite the page URL. Needs the layer (id or display name) and the option id from get_layer; an option name works too.",
      input: z.object({
        layer: z.string().min(1).describe(LAYER_INPUT),
        option: z.string().min(1).describe("Option id, e.g. openrouter (get_layer lists them); the option's name works too"),
      }),
      annotations: READ_ONLY,
      run: async ({ layer, option }) => {
        const { layer: l, all } = await resolveLayer(deps, layer);
        const hit = findOption(l.options, option);
        if (!hit) {
          const elsewhere = all.filter((x) => x !== l && findOption(x.options, option)).map((x) => x.id);
          throw new ToolError(
            `No option "${option}" in the ${l.id} layer.${elsewhere.length ? ` It is in: ${elsewhere.join(", ")}.` : ""} Call get_layer with "${l.id}" to see its options.`,
            { layer: l.id, options: l.options.map((o) => o.id), ...(elsewhere.length ? { foundIn: elsewhere } : {}) },
          );
        }
        const data = await deps.api.json<Record<string, unknown>>(`/api/options/${l.id}/${hit.id}.json`);
        if (!data) throw new ToolError(`The datasheet for ${l.id}/${hit.id} is unavailable right now.`);
        return data;
      },
    }),

    tool({
      name: "list_stacks",
      title: "List stacks",
      description:
        "Every agent stack on Stackprints with its kind, tagline, disclosure (open-source, documented, closed, example), links and page URL. Filter by disclosure, by kind, or by an option the stack picks (uses_option, as layer/id; each match says whether that pick is only supported, not the default). Real stacks and example designs are counted apart: examples are designs written for the site, not products. Then get_stack for one stack layer by layer.",
      input: z.object({
        disclosure: z.enum(DISCLOSURES).optional().describe("Only stacks with this disclosure"),
        kind: z.string().optional().describe('Only stacks of this kind, e.g. "Coding agent" (case-insensitive); `kinds` in the result lists them'),
        uses_option: z.string().optional().describe('Only stacks that pick this option, as "layer/id", e.g. "router/openrouter" or "memory/memory-md"'),
      }),
      annotations: READ_ONLY,
      run: async ({ disclosure, kind, uses_option }) => {
        const d = await deps.api.json<{ stacks: ApiStackRow[] }>("/api/stacks.json");
        if (!d) throw new ToolError("The stack list is unavailable right now; try again shortly.");
        const kinds = [...new Set(d.stacks.map((s) => s.kind))].sort();
        let rows: (ApiStackRow & { supported?: boolean })[] = d.stacks.filter((s) => (!disclosure || s.disclosure === disclosure) && (!kind || slugify(s.kind) === slugify(kind)));
        if (uses_option) {
          const [layerIn, idIn] = uses_option.split("/");
          if (!layerIn || !idIn) throw new ToolError('uses_option is "layer/id", e.g. "router/openrouter".');
          const { layer } = await resolveLayer(deps, layerIn);
          const id = findOption(layer.options, idIn)?.id;
          if (!id) throw new ToolError(`No option "${idIn}" in the ${layer.id} layer. Call get_layer with "${layer.id}" to see its options.`, { options: layer.options.map((o) => o.id) });
          const picks = await Promise.all(
            rows.map(async (s) => (await deps.api.json<ApiStack>(`/api/stacks/${s.slug}.json`))?.layers.find((l) => l.id === layer.id)?.picks.find((p) => p.id === id)),
          );
          rows = rows.flatMap((s, i) => (picks[i] ? [{ ...s, supported: Boolean(picks[i]!.supported) }] : []));
        }
        const examples = rows.filter((s) => s.disclosure === "example").length;
        return { count: rows.length, realStacks: rows.length - examples, exampleDesigns: examples, kinds, stacks: rows };
      },
    }),

    tool({
      name: "get_stack",
      title: "Get a stack",
      description: `How one agent is built, layer by layer: the picks in each layer with their evidence URLs, sources, notDisclosed, inUseUndisclosed and notUsed layers, the prompts its makers publish, version, author and the date it was researched. How to read it: ${STACK_READING}`,
      input: z.object({ slug: z.string().min(1).describe("Stack slug, e.g. openclaw, claude-code, pi, poke (list_stacks lists them); the stack's name works too") }),
      annotations: READ_ONLY,
      run: async ({ slug }) => {
        const direct = slugify(slug) === slug ? await deps.api.json<Record<string, unknown>>(`/api/stacks/${slug}.json`) : null;
        if (direct) return direct;
        const list = await deps.api.json<{ stacks: ApiStackRow[] }>("/api/stacks.json");
        const hit = list?.stacks.find((s) => s.slug === slugify(slug) || slugify(s.name) === slugify(slug));
        const data = hit ? await deps.api.json<Record<string, unknown>>(`/api/stacks/${hit.slug}.json`) : null;
        if (data) return data;
        const slugs = list?.stacks.map((s) => s.slug) ?? [];
        throw new ToolError(`No stack "${slug}".${slugs.length ? ` Valid slugs: ${slugs.join(", ")}.` : ""}`, { slugs });
      },
    }),

    tool({
      name: "get_hot",
      title: "What's hot this week",
      description:
        "The AI agent products people on X talk about the most this week, in two rows, each most talked about first: stacks (agent products) and options (components, as layer/id). Each item says why it is being discussed, since when, its sources and its page on the site. `updated` is the day the list was checked and `from` the start of the week it covers; mention the date when you use it.",
      input: z.object({}),
      annotations: READ_ONLY,
      run: async () => (await deps.api.json<Record<string, unknown>>("/api/hot.json")) ?? { hot: null, message: "There is no hot list right now." },
    }),

    tool({
      name: "validate_stack",
      title: "Validate a stack draft",
      description:
        "Checks a stack draft (the shape of content/stacks/<slug>.json) against the current catalogue with the same validator `npm run check` and CI run, as if the file were added at its path. Returns ok, errors about this file (unknown layers or options, a layer both picked and notUsed, Any model next to other picks without supports…), warnings (including what docs/RESEARCH.md still asks for, such as evidence for every picked layer of a real product), the slug and path, and a boardUrl that opens the draft on the site's board. Layer display names are turned into ids. Call it while drafting, then prepare_stack_submission when it passes.",
      input: z.object({ stack: stackDraft }),
      annotations: READ_ONLY,
      run: async ({ stack }) => {
        const v = await checkStack(deps, stack);
        return {
          ok: v.ok,
          slug: v.slug,
          path: v.path,
          exists: v.exists,
          errors: v.errors,
          ...(v.relatedErrors ? { relatedErrors: v.relatedErrors } : {}),
          warnings: v.warnings,
          ...(v.renamedLayers ? { renamedLayers: v.renamedLayers } : {}),
          boardUrl: v.boardUrl,
        };
      },
    }),

    tool({
      name: "prepare_stack_submission",
      title: "Prepare a stack submission",
      description:
        "Turns a new stack draft into a pull request the user opens as themselves on GitHub; nothing is stored or sent. Validates like validate_stack and refuses a slug that already exists (correct an existing stack with prepare_correction). Returns ready, the slug and path, json (the exact file text), newFileUrl (GitHub's new-file page prefilled with it; null when the file is too long for a URL, then use ghSteps), boardUrl (the draft on the site's board), ghSteps (fork, branch, write, check, commit, gh pr create) and the reviewer checklist from docs/RESEARCH.md, each rule ok, missing, or for the user to confirm. ready is true when the checks pass and no rule is missing. Show the user the links and never say the stack was submitted; get_submission_status follows the pull request once it is open.",
      input: z.object({ stack: stackDraft }),
      annotations: READ_ONLY,
      run: async ({ stack }) => {
        const v = await checkStack(deps, stack);
        if (v.exists)
          throw new ToolError(
            `A stack with slug "${v.slug}" already exists at ${v.path}. To change it, edit that file in a pull request (editUrl) or report one wrong fact with prepare_correction; to add a different stack, give it another slug.`,
            { slug: v.slug, path: v.path, page: abs(deps, `/stack/${v.slug}/`), editUrl: `${deps.repo}/edit/main/${v.path}` },
          );
        const title = `Add stack: ${v.stack.name}`;
        const missing = v.checklist.filter((c) => c.status === "missing");
        return {
          ready: v.ok && !missing.length,
          slug: v.slug,
          path: v.path,
          json: v.json,
          newFileUrl: withinUrlLimit(newFileUrl(deps.repo, v.path, v.json)),
          boardUrl: v.boardUrl,
          page: abs(deps, `/stack/${v.slug}/`),
          ghSteps: ghSteps(deps, { path: v.path, branch: `stack/${v.slug}`, title, body: `Adds ${v.path}. Checked with npm run check.` }),
          checklist: v.checklist,
          errors: v.errors,
          ...(v.relatedErrors ? { relatedErrors: v.relatedErrors } : {}),
          warnings: v.warnings,
          ...(v.renamedLayers ? { renamedLayers: v.renamedLayers } : {}),
        };
      },
    }),

    tool({
      name: "prepare_option_submission",
      title: "Prepare an option submission",
      description:
        "Turns a new option (a product, model, protocol or pattern in one layer) into a pull request the user opens as themselves; nothing is stored or sent. The id defaults to the name slugified. order, logo, affiliation and exclusive are set by the maintainers and refused. Links must be https and at least one source is required. Looks for duplicates by name, domain and repo across every layer and stack first: when it finds any, ready is false and `duplicates` names them (correct an existing option with prepare_correction instead). Returns ready, the path, json (the exact file text), newFileUrl (GitHub's new-file page prefilled; null when too long), ghSteps, duplicates, errors and warnings. Facts follow docs/RESEARCH.md: neutral wording, numbers the vendor publishes marked '(vendor-reported)', only pages you opened.",
      input: z.object({ layer: z.string().min(1).describe(LAYER_INPUT), option: optionDraft }),
      annotations: READ_ONLY,
      run: async ({ layer, option }) => {
        const files = await deps.files();
        const all = contentLayers(files);
        const l = all.find((x) => x.id === layerIdFrom(all, layer));
        if (!l) throw new ToolError(`No layer "${layer}". Valid ids: ${all.map((x) => x.id).join(", ")}.`, { layers: all.map((x) => x.id) });
        const refused = ["order", "logo", "affiliation", "exclusive"].filter((k) => k in option);
        if (refused.length)
          throw new ToolError(`${refused.join(", ")} ${refused.length > 1 ? "are" : "is"} set by the maintainers; leave ${refused.length > 1 ? "them" : "it"} out of a submission.`, { refused });
        const id = option.id ?? slugify(option.name);
        if (!id || slugify(id) !== id) throw new ToolError(`id must be kebab-case, e.g. "${slugify(id || option.name) || "my-option"}".`);
        const o = ordered<OptionDraft>({ ...option, id }, OPTION_KEYS);
        const path = paths.option(l.id, id);
        const json = toJson(o);
        const errors: string[] = [];
        if (files.has(path)) errors.push(`${path} already exists; report what is wrong with it through prepare_correction`);
        for (const [k, v] of Object.entries(o.links ?? {})) if (!isHttps(v)) errors.push(`links.${k} must be an https URL`);
        if (!o.sources?.length) errors.push("add at least one source: { title, url } of a page the facts come from");
        for (const s of o.sources ?? []) if (!isHttps(s.url)) errors.push(`source "${s.title}" needs an https url`);
        const result = check(files, { [path]: json }, deps.now());
        errors.push(...result.errors.filter((e) => e.includes(path)));
        const related = result.errors.filter((e) => !e.includes(path));
        const duplicates = checkDuplicate(files, { name: o.name, url: o.url, repo: o.links?.repo });
        const title = `Add option: ${o.name} (${l.name})`;
        return {
          ready: result.ok && !errors.length && !duplicates.length,
          layer: l.id,
          id,
          path,
          json,
          newFileUrl: withinUrlLimit(newFileUrl(deps.repo, path, json)),
          page: abs(deps, optionHref(l.id, id)),
          duplicates,
          errors,
          ...(related.length ? { relatedErrors: related } : {}),
          warnings: result.warnings.filter((w) => w.includes(path)),
          ghSteps: ghSteps(deps, { path, branch: `option/${l.id}-${id}`, title, body: `Adds ${path}. Checked with npm run check.` }),
        };
      },
    }),

    tool({
      name: "prepare_correction",
      title: "Prepare a correction",
      description:
        "Reports a fact on Stackprints that is wrong, stale or missing, as a GitHub issue the user opens as themselves; nothing is stored or changed. Checks the target exists (an option or its news by layer and id, a stack by slug, a layer, or the hot list) and that every source is https, then returns issueUrl (the 'correction' issue form prefilled: target page, field, what's wrong, proposed value, sources), the title and markdown body, and a gh command for when the URL is too long. The maintainers' research agents pick correction issues up and fix the content with sources. Show the user the link; never say the correction was filed.",
      input: z.object({
        kind: z.enum(["option", "stack", "layer", "news", "hot"]).describe("What the correction is about"),
        layer: z.string().optional().describe(`For option, news and layer: ${LAYER_INPUT}`),
        id: z.string().optional().describe("For option and news: the option id (get_layer lists them)"),
        slug: z.string().optional().describe("For stack: the stack slug"),
        field: z.string().optional().describe('What is wrong as named in the data: a fact label ("Pricing"), "model.context", "summary", "layers.memory", a news headline…'),
        problem: z.string().min(1).describe("What is wrong or stale, in a sentence or two"),
        proposed: z.string().optional().describe("The correct value, as it should read"),
        sources: z.array(z.string()).min(1).describe("https URLs of pages that show the correct value; at least one"),
      }),
      annotations: READ_ONLY,
      run: async (a) => {
        const bad = a.sources.filter((u) => !isHttps(u));
        if (bad.length) throw new ToolError(`Sources must be https URLs: ${bad.join(", ")}.`, { invalid: bad });
        const files = await deps.files();
        const t = correctionTarget(deps, files, a);
        const warnings = a.field && t.data !== undefined && !hasField(t.data, a.field) ? [`"${a.field}" is not a field or fact on ${t.name} yet; fine if you are reporting it missing.`] : [];
        const title = `Correction: ${t.name}${a.field ? ` (${a.field})` : ""}`.slice(0, 120);
        const body = [
          `**Target:** [${t.name}](${t.page}) (\`${t.path}\`)`,
          ...(a.field ? [`**Field:** ${a.field}`] : []),
          "",
          "### What's wrong",
          "",
          a.problem,
          ...(a.proposed ? ["", "### Proposed value", "", a.proposed] : []),
          "",
          "### Sources",
          "",
          ...a.sources.map((u) => `- ${u}`),
          "",
          "_Prepared with prepare_correction on the Stackprints MCP server._",
        ].join("\n");
        // The form's field ids prefill the issue form; body is what a plain issue or `gh issue create` uses.
        const query: [string, string | undefined][] = [
          ["template", "correction.yml"],
          ["labels", "correction"],
          ["title", title],
          ["target", t.page],
          ["field", a.field],
          ["problem", a.problem],
          ["proposed", a.proposed],
          ["sources", a.sources.join("\n")],
          ["body", body],
        ];
        const issueUrl = `${deps.repo}/issues/new?${query
          .filter((q): q is [string, string] => Boolean(q[1]))
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join("&")}`;
        return {
          issueUrl,
          tooLongForBrowsers: issueUrl.length >= URL_LIMIT,
          title,
          body,
          target: { kind: a.kind, name: t.name, path: t.path, page: t.page },
          gh: `gh issue create --repo ${repoPath(deps.repo)} --label correction --title ${quote(title)} --body-file - <<'EOF'\n${body}\nEOF`,
          warnings,
        };
      },
    }),

    tool({
      name: "get_submission_status",
      title: "Get a submission's status",
      description:
        "The state of a submission pull request or correction issue on the Stackprints GitHub repo, by number: kind (pull or issue), state (open, merged or closed), title, link, last update and, for a pull request, its CI checks (total, failing and pending names; the 'check' run is npm run check and the build). Reads GitHub's API, which rate-limits it, and keeps each answer for a minute: call it when the user asks how a submission is doing, not in a loop.",
      input: z.object({ number: z.number().int().positive().describe("The pull request or issue number, e.g. 42") }),
      annotations: { ...READ_ONLY, openWorldHint: true },
      run: async ({ number }) => {
        const key = `${repoPath(deps.repo)}#${number}`;
        const hit = statusCache.get(key);
        if (hit && deps.now() - hit.at < STATUS_TTL) return structuredClone(hit.value);
        // Errors are not kept: a pull request opened a moment ago should show up on the next call.
        const value = await submissionStatus(deps, number);
        statusCache.delete(key);
        statusCache.set(key, { at: deps.now(), value });
        while (statusCache.size > STATUS_CACHED) statusCache.delete(statusCache.keys().next().value!);
        return value;
      },
    }),
  ];
}
