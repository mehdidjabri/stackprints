import fs from "node:fs";
import path from "node:path";
import type { Layer, Stack } from "./types";

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

export function getLayers(): Layer[] {
  layers ??= JSON.parse(fs.readFileSync(path.join(root, "layers.json"), "utf8")) as Layer[];
  return layers;
}

export function getStacks(): Stack[] {
  stacks ??= fs
    .readdirSync(path.join(root, "stacks"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, "stacks", f), "utf8")) as Stack)
    .sort((a, b) => a.name.localeCompare(b.name));
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
