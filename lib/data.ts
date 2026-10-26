import fs from "node:fs";
import path from "node:path";
import { optionHref } from "./links";
import type { Hot, HotItem, Layer, News, Option, Prompt, Stack } from "./types";

const root = path.join(process.cwd(), "content");

export const SITE = {
  name: "Stackprints",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://stackprints.com",
  description:
    "Find out how any AI agent is built: its model, router, harness, tools, memory, sandbox, channels and more, mapped layer by layer. Browse, remix, save and share your own AI agent stack.",
  repo: "https://github.com/mehdidjabri/stackprints",
};

let layers: Layer[] | undefined;
let stacks: Stack[] | undefined;

const readDir = <T>(dir: string): T[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T)
    : [];

/** Layers from layers.json, each with its options from content/options/<layer>/<option>.json. */
export function getLayers(): Layer[] {
  layers ??= (JSON.parse(fs.readFileSync(path.join(root, "layers.json"), "utf8")) as Omit<Layer, "options">[]).map((l) => ({
    ...l,
    // Curated options carry an order; submissions without one follow, alphabetically.
    options: readDir<Option>(path.join(root, "options", l.id)).sort(
      (a, b) => (a.order ?? 1e6) - (b.order ?? 1e6) || a.name.localeCompare(b.name),
    ),
  }));
  return layers;
}

export function getStacks(): Stack[] {
  stacks ??= readDir<Stack>(path.join(root, "stacks")).sort((a, b) => a.name.localeCompare(b.name));
  return stacks;
}

export function getStack(slug: string) {
  return getStacks().find((s) => s.slug === slug);
}

export const PROMPT_KIND: Record<Prompt["kind"], string> = {
  "system-prompt": "System prompt",
  "instruction-file": "Instruction file",
  "tool-prompt": "Tool prompt",
  template: "Template",
};
const PROMPT_KINDS = Object.keys(PROMPT_KIND);

const prompts = new Map<string, Prompt[]>();
/** The prompts a stack's makers publish, in board order: by layer, then kind, then title. */
export function getPrompts(slug: string): Prompt[] {
  const dir = path.join(root, "prompts", slug);
  if (!fs.existsSync(dir)) return [];
  if (prompts.has(slug)) return prompts.get(slug)!;
  const order = new Map(getLayers().map((l, i) => [l.id, i]));
  const list = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      // A front-matter header of "key: value" lines, then the prompt verbatim (see scripts/check.mjs).
      const [, head, text] = fs.readFileSync(path.join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)!;
      const fm = Object.fromEntries(head.split("\n").map((l) => l.match(/^([a-z]+):\s*(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].trim()]));
      return { id: f.slice(0, -3), ...fm, text: text.replace(/^\n+|\s+$/g, "") } as Prompt;
    })
    .sort(
      (a, b) =>
        (order.get(a.layer) ?? 99) - (order.get(b.layer) ?? 99) ||
        PROMPT_KINDS.indexOf(a.kind) - PROMPT_KINDS.indexOf(b.kind) ||
        a.title.localeCompare(b.title),
    );
  prompts.set(slug, list);
  return list;
}

/** Every stack's published prompts for one layer, stack by stack. */
export const layerPrompts = (layerId: string) =>
  getStacks().flatMap((stack) => getPrompts(stack.slug).filter((p) => p.layer === layerId).map((prompt) => ({ stack, prompt })));

/** A card on the hot list. `id` is the stack's slug or the option's "layer/id". */
export type HotCard = { id: string; item: HotItem; name: string; logo?: string; label: string; band?: Layer["band"]; href: string; affiliation?: string };

/** The hot list, each row resolved to the pages its cards link to. Undefined when there's no list. */
export function getHot() {
  const file = path.join(root, "hot.json");
  if (!fs.existsSync(file)) return undefined;
  const hot = JSON.parse(fs.readFileSync(file, "utf8")) as Hot;
  const stacks = (hot.stacks ?? []).flatMap((item): HotCard[] => {
    const s = getStack(item.stack);
    return s ? [{ id: s.slug, item, name: s.name, logo: s.logo, label: s.kind, href: `/stack/${s.slug}/` }] : [];
  });
  const options = (hot.options ?? []).flatMap((item): HotCard[] => {
    const [layerId, id] = item.option.split("/");
    const layer = getLayer(layerId);
    const o = layer?.options.find((x) => x.id === id);
    return layer && o
      ? [{ id: item.option, item, name: o.name, logo: o.logo, label: layer.name, band: layer.band, href: optionHref(layer.id, o.id), affiliation: o.affiliation }]
      : [];
  });
  return { updated: hot.updated, from: hot.from, stacks, options };
}

export function getLayer(id: string) {
  return getLayers().find((l) => l.id === id);
}

export const asArray = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Resolve a stack into ordered rows of [layer, options[]] for rendering. */
export function resolve(stack: Pick<Stack, "layers">) {
  return getLayers()
    .map((layer) => ({
      layer,
      picks: asArray(stack.layers[layer.id])
        .map((id) => layer.options.find((o) => o.id === id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o)),
    }))
    .filter((r) => r.picks.length > 0);
}

/** Stacks that use a given option. */
export function usedBy(layerId: string, optionId: string) {
  return getStacks().filter((s) => asArray(s.layers[layerId]).includes(optionId));
}

/**
 * The same, split: example designs are written by this site, so they never count as adoption.
 * Wherever usage is shown or counted, real stacks and examples are kept apart.
 */
export function usage(layerId: string, optionId: string) {
  const all = usedBy(layerId, optionId);
  return { stacks: all.filter((s) => s.disclosure !== "example"), examples: all.filter((s) => s.disclosure === "example") };
}

/** "in 2 stacks · 3 example designs", leaving out whichever part is zero. */
export function usageText({ stacks, examples }: ReturnType<typeof usage>) {
  const parts = [];
  if (stacks.length) parts.push(`${stacks.length} stack${stacks.length > 1 ? "s" : ""}`);
  if (examples.length) parts.push(`${examples.length} example design${examples.length > 1 ? "s" : ""}`);
  return parts.length ? `in ${parts.join(" · ")}` : "";
}

/** "OpenClaw agent stack", but "Support agent stack" rather than "Support agent agent stack". */
export const stackTitle = (s: Pick<Stack, "name">) => (/\bagents?\b/i.test(s.name) ? `${s.name} stack` : `${s.name} agent stack`);

/** A meta description: whole sentences when they fit, else cut at a word with an ellipsis. */
export function metaDesc(text: string, max = 160) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return cut.slice(0, word > 0 ? word : max).replace(/[,;:.\s]+$/, "") + "…";
}

/** Options a stack picks that are made by the people behind this site. */
export const affiliated = (stack: Pick<Stack, "layers">) => resolve(stack).flatMap((r) => r.picks.filter((p) => p.affiliation));

export function getOption(layerId: string, optionId: string) {
  const layer = getLayer(layerId);
  const option = layer?.options.find((o) => o.id === optionId);
  return layer && option ? { layer, option } : undefined;
}

export function getNews(layerId: string, optionId: string): News | undefined {
  const p = path.join(root, "news", layerId, `${optionId}.json`);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as News) : undefined;
}

// ── Dates ───────────────────────────────────────────────────────────────────
// When a page last changed in substance, for the sitemap's lastmod and the markdown twins'
// last-updated. ISO dates compare as strings; undefined when nothing is dated (callers fall back).

const newest = (dates: (string | undefined)[]) => dates.filter((d): d is string => Boolean(d)).sort().at(-1);

/** An option's page: its research date or its newest story, whichever is later. */
export const optionDate = (layerId: string, o: Option) =>
  newest([o.researched, ...(o.profile === "pattern" ? [] : (getNews(layerId, o.id)?.items ?? []).map((i) => i.date))]);

/** A layer's page lists its options and the stacks that pick them. */
export const layerDate = (l: Layer) =>
  newest([...l.options.map((o) => o.researched), ...getStacks().filter((s) => l.id in s.layers).map((s) => s.researched)]);

/** A list of stacks (a kind page). */
export const stacksDate = (xs: Stack[]) => newest(xs.map((s) => s.researched));

/** The day news was last checked: what Trending is ranked as of, so a rebuild alone never moves it. */
export function newsDate() {
  return newest(getLayers().flatMap((l) => l.options.map((o) => getNews(l.id, o.id)?.updated)));
}

/** The layers page lists every layer and its options. */
export const layersDate = () => newest(getLayers().map(layerDate));

/** The home page shows every stack and layer, and the top of Trending. */
export const siteDate = () => newest([layersDate(), stacksDate(getStacks()), newsDate()]);

// A news file keeps its 5 newest stories plus any other from the 30 days before it was checked
// (docs/RESEARCH.md#news). Files from before that rule stop at 5, so a full one may hold back more.
const NEWS_KEEP = 5;

/**
 * Trending = most in the news lately. Each item in the `days` before `now` scores by recency (1 → 0),
 * so three stories this week beat one story a month ago. Honest by construction: no hidden inputs.
 * `now` is the day news was last checked, not the build: the ranking only moves when the news does.
 */
export function getTrending(days = 30, now = new Date(newsDate() ?? Date.now())) {
  const out = [];
  for (const layer of getLayers())
    for (const option of layer.options) {
      const news = getNews(layer.id, option.id);
      if (!news) continue;
      const recent = news.items.filter((i) => (now.getTime() - new Date(i.date).getTime()) / 864e5 <= days);
      if (!recent.length) continue;
      const score = recent.reduce((s, i) => s + 1 - (now.getTime() - new Date(i.date).getTime()) / 864e5 / days, 0);
      // Every story kept is recent and the file is at the old cap: there may be more than it holds.
      const atLeast = recent.length === news.items.length && news.items.length === NEWS_KEEP;
      out.push({ layer, option, score, latest: recent[0], count: recent.length, atLeast });
    }
  return out.sort((a, b) => b.score - a.score);
}

/** "3 stories", "1 story", or "5+ stories" when the news file may hold back more. */
export const storyCount = ({ count, atLeast }: { count: number; atLeast: boolean }) =>
  `${count}${atLeast ? "+" : ""} ${count === 1 && !atLeast ? "story" : "stories"}`;
