import fs from "node:fs";
import path from "node:path";
import type { Layer, News, Option, Stack } from "./types";

const root = path.join(process.cwd(), "content");

export const SITE = {
  name: "Agentic Stack",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://agenticstack.dev",
  description:
    "Every possible agentic stack, mapped. Models, routers, harnesses, tools, memory, sandboxes, channels and more — browse, remix, save and share your own AI agent stack.",
  repo: "https://github.com/agentic-stack/agentic-stack",
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

export function getOption(layerId: string, optionId: string) {
  const layer = getLayer(layerId);
  const option = layer?.options.find((o) => o.id === optionId);
  return layer && option ? { layer, option } : undefined;
}

export function getNews(layerId: string, optionId: string): News | undefined {
  const p = path.join(root, "news", layerId, `${optionId}.json`);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as News) : undefined;
}

/**
 * Trending = most in the news lately. Each item in the last `days` scores by recency (1 → 0),
 * so three stories this week beat one story a month ago. Honest by construction: no hidden inputs.
 */
export function getTrending(days = 30, now = new Date()) {
  const out = [];
  for (const layer of getLayers())
    for (const option of layer.options) {
      const news = getNews(layer.id, option.id);
      if (!news) continue;
      const recent = news.items.filter((i) => (now.getTime() - new Date(i.date).getTime()) / 864e5 <= days);
      if (!recent.length) continue;
      const score = recent.reduce((s, i) => s + 1 - (now.getTime() - new Date(i.date).getTime()) / 864e5 / days, 0);
      out.push({ layer, option, score, latest: recent[0], count: recent.length });
    }
  return out.sort((a, b) => b.score - a.score);
}
