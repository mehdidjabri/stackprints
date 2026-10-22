"use client";

import { useEffect } from "react";
import { layerIdFrom, renamedLayers } from "@/lib/links";
import { loadIndex, search, why, whyText } from "@/lib/search";

// WebMCP (W3C draft): tools a browser agent can call on any page of the site, backed by the
// same static JSON as the public API. document.modelContext first, navigator.modelContext as fallback.
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<unknown>;
};
type ModelContext = { registerTool: (tool: Tool) => unknown };

const getJson = (url: string, signal?: AbortSignal) =>
  fetch(url, { signal }).then((r) => (r.ok ? r.json() : { error: `Not found: ${url}`, status: r.status }));

const str = (description: string) => ({ type: "string", description });
const schema = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

type LayerName = { id: string; name: string };

// The layer input names every id, and display names are accepted too ("Triggers" → proactivity),
// so an agent that guesses from a name still gets the layer. No enum: it would reject the names.
const layerInput = (layers: LayerName[]) =>
  str(`Layer id: ${layers.map((l) => l.id).join(", ")}. Some ids differ from the name shown: ${renamedLayers(layers)}. Display names work too.`);

const tools = (layers: LayerName[]): Tool[] => [
  {
    name: "search_stackprints",
    description:
      "Search Stackprints for AI agent stacks, layers (model, harness, memory, sandbox…) and components (OpenRouter, E2B, Langfuse…). Returns matches with their page URLs.",
    inputSchema: schema({ query: str("What to look for, e.g. 'memory', 'browser use', 'OpenClaw'") }),
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const q = String(input.query);
      const rows = search(await loadIndex(), q, 15);
      return {
        results: rows.map((r) => {
          const w = why(r, q);
          const [kind, title, subtitle, href] = r;
          return { kind, title, subtitle, url: new URL(href, location.origin).href, ...(w ? { matched: whyText(w) } : {}) };
        }),
      };
    },
  },
  {
    name: "list_stacks",
    description: "List every agent stack on the site with its kind, tagline and disclosure level (open-source, documented, closed, example).",
    inputSchema: schema({}),
    annotations: { readOnlyHint: true },
    execute: (_i, o) => getJson("/api/stacks.json", o?.signal),
  },
  {
    name: "get_stack",
    description:
      "Get how one agent is built, layer by layer, with evidence URLs and sources. Layers in notDisclosed are unknown, not absent; layers in inUseUndisclosed are present but their component isn't named; picks with supported: true are configurable, not the default. Stacks with disclosure 'example' are designs, not products.",
    inputSchema: schema({ slug: str("Stack slug, e.g. openclaw, chatgpt-dots, pi, poke") }),
    annotations: { readOnlyHint: true },
    execute: (i, o) => getJson(`/api/stacks/${encodeURIComponent(String(i.slug))}.json`, o?.signal),
  },
  {
    name: "get_layer",
    description: "Get one layer of the agent stack and every option in it, to compare choices.",
    inputSchema: schema({ layer: layerInput(layers) }),
    annotations: { readOnlyHint: true },
    execute: (i, o) => getJson(`/api/layers/${encodeURIComponent(layerIdFrom(layers, String(i.layer)))}.json`, o?.signal),
  },
  {
    name: "get_option",
    description: "Get one component's datasheet: summary, facts, links, caveats, recent news and the stacks that use it, with example designs counted apart (usage).",
    inputSchema: schema({ layer: layerInput(layers), option: str("Option id, e.g. openrouter (see get_layer)") }),
    annotations: { readOnlyHint: true },
    execute: (i, o) =>
      getJson(
        `/api/options/${encodeURIComponent(layerIdFrom(layers, String(i.layer)))}/${encodeURIComponent(String(i.option))}.json`,
        o?.signal,
      ),
  },
  {
    name: "open_stack_in_editor",
    description: "Open a stack in the editor on the home page so the user can change, save and share it.",
    inputSchema: schema({ slug: str("Stack slug to load, e.g. openclaw") }),
    execute: async (i) => {
      location.href = `/#from=${encodeURIComponent(String(i.slug))}`;
      return { opened: String(i.slug) };
    },
  },
];

/** Layers come from the root layout (a server component): just the ids and names. */
export function WebMcp({ layers }: { layers: LayerName[] }) {
  useEffect(() => {
    const mc = ((document as unknown as { modelContext?: ModelContext }).modelContext ??
      (navigator as unknown as { modelContext?: ModelContext }).modelContext) as ModelContext | undefined;
    if (!mc || typeof mc.registerTool !== "function") return;
    for (const tool of tools(layers)) {
      try {
        Promise.resolve(mc.registerTool(tool)).catch(() => {});
      } catch {}
    }
  }, [layers]);
  return null;
}
