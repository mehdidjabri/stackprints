"use client";

import { useEffect } from "react";
import { loadIndex, search } from "@/lib/search";

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

const TOOLS: Tool[] = [
  {
    name: "search_agentic_stack",
    description:
      "Search Agentic Stack for AI agent stacks, layers (model, harness, memory, sandbox…) and components (OpenRouter, E2B, past.dev…). Returns matches with their page URLs.",
    inputSchema: schema({ query: str("What to look for, e.g. 'memory', 'browser use', 'OpenClaw'") }),
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const rows = search(await loadIndex(), String(input.query), 15);
      return { results: rows.map(([kind, title, subtitle, href]) => ({ kind, title, subtitle, url: new URL(href, location.origin).href })) };
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
      "Get how one agent is built, layer by layer, with evidence URLs and sources. On closed stacks, layers in notDisclosed are unknown, not absent.",
    inputSchema: schema({ slug: str("Stack slug, e.g. openclaw, chatgpt-dots, pi, poke") }),
    annotations: { readOnlyHint: true },
    execute: (i, o) => getJson(`/api/stacks/${encodeURIComponent(String(i.slug))}.json`, o?.signal),
  },
  {
    name: "get_layer",
    description: "Get one layer of the agent stack and every option in it, to compare choices.",
    inputSchema: schema({ layer: str("Layer id, e.g. model, harness, router, memory, sandbox, browser, guardrails") }),
    annotations: { readOnlyHint: true },
    execute: (i, o) => getJson(`/api/layers/${encodeURIComponent(String(i.layer))}.json`, o?.signal),
  },
  {
    name: "get_option",
    description: "Get one component's datasheet: summary, facts, links, caveats, recent news and the stacks that use it.",
    inputSchema: schema({ layer: str("Layer id, e.g. memory"), option: str("Option id, e.g. past-dev") }),
    annotations: { readOnlyHint: true },
    execute: (i, o) =>
      getJson(`/api/options/${encodeURIComponent(String(i.layer))}/${encodeURIComponent(String(i.option))}.json`, o?.signal),
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

export function WebMcp() {
  useEffect(() => {
    const mc = ((document as unknown as { modelContext?: ModelContext }).modelContext ??
      (navigator as unknown as { modelContext?: ModelContext }).modelContext) as ModelContext | undefined;
    if (!mc || typeof mc.registerTool !== "function") return;
    for (const tool of TOOLS) {
      try {
        Promise.resolve(mc.registerTool(tool)).catch(() => {});
      } catch {}
    }
  }, []);
  return null;
}
