// Everything the site publishes for agents rather than people: markdown twins of every page,
// llms.txt files, a read-only JSON API with its OpenAPI spec, discovery catalogs and a skill.
// One function, agentFiles(), returns them all as path → file; scripts/agent-files.mjs writes
// them into out/ after the build, so the site stays fully static.
import crypto from "node:crypto";
import { BANDS } from "./bands";
import { SITE, asArray, getLayers, getNews, getStacks, getTrending, resolve, usedBy } from "./data";
import { DISCLOSURE, unknownLabel } from "./disclosure";
import { mdPath, optionHref } from "./links";
import type { Layer, Option, Stack } from "./types";

export const BUILT = new Date().toISOString().slice(0, 10);
const abs = (p: string) => `${SITE.url}${p}`;
const host = new URL(SITE.url).host;


const WHEN_TO_USE = `Use Agentic Stack when you need to:

- Pick a component for an AI agent: compare the real options in any of ${"{layers}"} layers (models, model gateways, harnesses, sandboxes, browser use, memory, retrieval, triggers, guardrails, payments, observability…).
- See how a known agent is built (OpenClaw, Hermes Agent, Pi, Claude Code, Codex, ChatGPT dots, Meta Muse, Manus, Poke…), with a source for every pick and an explicit "not disclosed" where a closed product hasn't said.
- Draft a stack for a new agent and share it as a link.

Don't use it for live prices, benchmark scores or uptime: it records what each option is and who uses it, with dated sources, not real-time metrics.`;

function frontmatter(f: Record<string, string | undefined>) {
  const lines = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

// ── Markdown twins ─────────────────────────────────────────────────────────

function homeMd() {
  const layers = getLayers();
  const stacks = getStacks();
  return (
    frontmatter({ title: SITE.name, description: SITE.description, canonical: abs("/"), "last-updated": BUILT }) +
    `# ${SITE.name}\n\n> ${SITE.description}\n\n## When to use this\n\n${WHEN_TO_USE.replace("{layers}", String(layers.length))}\n\n` +
    `## Stacks\n\n${stacks.map((s) => `- [${s.name}](${abs(mdPath(`/stack/${s.slug}/`))}): ${s.tagline} (${s.kind}${s.disclosure ? `, ${DISCLOSURE[s.disclosure].badge.toLowerCase()}` : ""})`).join("\n")}\n\n` +
    `## Layers\n\n${BANDS.map(([b, name]) => `### ${name}\n\n${layers
      .filter((l) => l.band === b)
      .map((l) => `- [${l.name}](${abs(mdPath(`/layer/${l.id}/`))}) (${l.ref}): ${l.description}`)
      .join("\n")}`).join("\n\n")}\n\n` +
    `## For agents\n\n- [API docs](${abs("/api/")}) and [OpenAPI spec](${abs("/openapi.json")}): read-only JSON, no key needed\n- [llms.txt](${abs("/llms.txt")}) and [llms-full.txt](${abs("/llms-full.txt")})\n- Every page has a markdown twin: append .md to its URL\n`
  );
}

function stackMd(s: Stack) {
  const rows = resolve(s);
  const layers = getLayers();
  const unk = unknownLabel(s.disclosure);
  const sources = [...(s.sources ?? [])];
  for (const u of Object.values(s.evidence ?? {}).flat()) if (!sources.some((x) => x.url === u)) sources.push({ title: u, url: u });
  const cite = (u: string) => `[${sources.findIndex((x) => x.url === u) + 1}]`;
  const missing = layers.filter((l) => !(l.id in s.layers) && !s.notUsed?.includes(l.id));
  const notUsed = layers.filter((l) => s.notUsed?.includes(l.id));
  return (
    frontmatter({ title: `${s.name} agent stack`, description: s.tagline, canonical: abs(`/stack/${s.slug}/`), "last-updated": s.researched ?? BUILT }) +
    `# ${s.name}\n\n${s.kind}${s.disclosure ? ` · ${DISCLOSURE[s.disclosure].badge}: ${DISCLOSURE[s.disclosure].about.toLowerCase()}` : ""}${s.researched ? ` · ${s.disclosure === "example" ? "checked" : "researched"} ${s.researched}` : ""}\n\n${s.description}\n\n` +
    (s.links ? `${Object.entries(s.links).map(([k, u]) => `- ${k}: ${u}`).join("\n")}\n\n` : "") +
    `## Layers\n\n${rows
      .map(({ layer, picks }) => `- **${layer.name}** (${layer.ref}): ${picks.map((p) => `[${p.name}](${abs(mdPath(optionHref(layer.id, p.id)))})`).join(", ")}${(s.evidence?.[layer.id] ?? []).map(cite).join("")}`)
      .join("\n")}\n` +
    (unk && missing.length ? `\n## ${unk}\n\n${missing.map((l) => l.name).join(", ")}\n` : "") +
    (!unk && missing.length ? `\n## Not used\n\n${missing.map((l) => l.name).join(", ")}\n` : "") +
    (notUsed.length ? `\n## Not used (confirmed)\n\n${notUsed.map((l) => l.name).join(", ")}\n` : "") +
    (sources.length ? `\n## Sources\n\n${sources.map((x, i) => `${i + 1}. [${x.title}](${x.url})`).join("\n")}\n` : "") +
    `\nAs JSON: ${abs(`/api/stacks/${s.slug}.json`)}\n`
  );
}

function layerMd(l: Layer) {
  return (
    frontmatter({ title: `${l.name} for AI agents`, description: l.description, canonical: abs(`/layer/${l.id}/`), "last-updated": BUILT }) +
    `# ${l.name}\n\n${l.ref} · ${BANDS.find(([b]) => b === l.band)![1]} band · ${l.options.length} options\n\n${l.description}\n\n## Options\n\n` +
    l.options
      .map((o) => {
        const users = usedBy(l.id, o.id);
        return `- [${o.name}](${abs(mdPath(optionHref(l.id, o.id)))})${o.note ? `: ${o.note}` : ""}${o.open ? " (open)" : ""}${o.profile ? ` [${o.profile}]` : ""}${users.length ? ` · used by ${users.map((u) => u.name).join(", ")}` : ""}`;
      })
      .join("\n") +
    `\n\nAs JSON: ${abs(`/api/layers/${l.id}.json`)}\n`
  );
}

function optionMd(l: Layer, o: Option) {
  const news = o.profile === "pattern" ? undefined : getNews(l.id, o.id);
  const users = usedBy(l.id, o.id);
  const m = o.model;
  const parts = [
    frontmatter({
      title: `${o.name}: ${l.name.toLowerCase()} for AI agents`,
      description: o.summary ?? o.note,
      canonical: abs(optionHref(l.id, o.id)),
      "last-updated": o.researched ?? BUILT,
    }),
    `# ${o.name}\n\n${[o.profile, l.name, o.open ? "open" : undefined, o.url].filter(Boolean).join(" · ")}\n`,
    o.note ? `\n> ${o.note}\n` : "",
    o.summary ? `\n${o.summary}\n` : "",
    m ? `\n## Model\n\n${Object.entries(m).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\n")}\n` : "",
    o.facts?.length ? `\n## Datasheet\n\n| | |\n|---|---|\n${o.facts.map(([k, v]) => `| ${k} | ${v.replace(/\|/g, "\\|")} |`).join("\n")}\n` : "",
    o.how?.length ? `\n## How it works\n\n${o.how.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n` : "",
    o.goodFor?.length ? `\n## Good for\n\n${o.goodFor.map((g) => `- ${g}`).join("\n")}\n` : "",
    o.watchOut?.length ? `\n## Watch out for\n\n${o.watchOut.map((g) => `- ${g}`).join("\n")}\n` : "",
    o.links ? `\n## Links\n\n${Object.entries(o.links).map(([k, u]) => `- ${k}: ${u}`).join("\n")}\n` : "",
    users.length ? `\n## Used in stacks\n\n${users.map((u) => `- [${u.name}](${abs(mdPath(`/stack/${u.slug}/`))})`).join("\n")}\n` : "",
    news?.items.length ? `\n## Latest news (checked ${news.updated})\n\n${news.items.map((n) => `- ${n.date}: [${n.title}](${n.url}) (${n.source})`).join("\n")}\n` : "",
    `\nAlternatives: ${abs(mdPath(`/layer/${l.id}/`))} · As JSON: ${abs(`/api/options/${l.id}/${o.id}.json`)}\n`,
  ];
  return parts.join("");
}

function trendingMd() {
  const rows = getTrending().slice(0, 40);
  return (
    frontmatter({ title: "Trending in AI agent infrastructure", description: "Options most in the news over the last 30 days.", canonical: abs("/trending/"), "last-updated": BUILT }) +
    `# Trending\n\nRanked by recent news: every story from the last 30 days counts, newer stories count more.\n\n` +
    rows.map(({ layer, option, latest, count }, i) => `${i + 1}. [${option.name}](${abs(mdPath(optionHref(layer.id, option.id)))}) (${layer.name}, ${count} stories): ${latest.date} [${latest.title}](${latest.url})`).join("\n") +
    "\n"
  );
}

// Trust pages share their copy between HTML and markdown.
export const ABOUT = `Agentic Stack is an open, community-maintained map of how AI agents are built. It breaks an agent into ${"{layers}"} layers, from the channels people reach it through to the model, the harness that runs the loop, the sandbox its code runs in, its memory, what wakes it up, its guardrails and where it is hosted. Each layer lists the real options people use today, and each stack shows which option a known agent picks in every layer.

Every claim about a real product is sourced. Open-source stacks are built from their public code; closed products are built only from what their makers and reputable press have published, and every layer they haven't disclosed is marked "Not disclosed" rather than guessed. Benchmark numbers that a vendor publishes about itself are labelled vendor-reported. Rankings and listings are never paid for.

The site is static and free: no accounts, no ads, no tracking. All data lives as JSON files in a public GitHub repository, anyone can propose a change by pull request, and a weekly job refreshes the news for every option.

Disclosure: Agentic Stack is built by the team behind past.dev, a memory API listed here. past.dev is the first suggestion in the Memory layer and the memory in example designs where a hosted memory API fits. Stacks of real products list past.dev only where a source shows they use it, and its benchmark numbers are marked vendor-reported like everyone else's.`;

export const PRIVACY = `Agentic Stack is a static website. It sets no cookies, runs no analytics or advertising scripts, and has no accounts, so we don't collect personal data about visitors.

Stacks you save with the Save button are kept in your own browser's local storage and never leave your device; clearing your browser data removes them. Share links encode the stack inside the URL itself, so whoever has the link can read that stack, and nothing is stored on a server.

The hosting provider may keep standard server logs (IP address, user agent, requested URL) for security and operations, under its own privacy policy. Links to other websites, logos of third-party products and the GitHub pull-request flow are subject to those services' own policies. If you contribute through GitHub, your contribution and GitHub username become part of the public repository history.`;

export const CONTACT = `Agentic Stack is maintained in the open on GitHub. To report a mistake, ask for a correction or suggest a product, open an issue or a pull request in the repository; every page also has an "Edit" link that opens the right file. Vendors who want their product listed can use the Submit form, which opens a pre-filled pull request, and can request corrections to a stack or an option the same way.

For questions about how the site works, see the About page and the contribution guide. Security issues should be reported privately through GitHub's security advisory form on the repository rather than in a public issue.`;

const pageMd = (title: string, path: string, body: string, description: string) =>
  frontmatter({ title, description, canonical: abs(path), "last-updated": BUILT }) + `# ${title}\n\n${body.replace("{layers}", String(getLayers().length))}\n`;

export const PRICING_MD = `# Pricing

Agentic Stack is free.

- Website: free, no account.
- JSON API (${"{api}"}): free, read-only, no API key, no rate-limit tiers. Please cache responses; data changes weekly.
- Listing a product: free, by pull request. Listings and rankings are never paid for.
- Data license: MIT, like the code.
`;

// ── llms.txt family ─────────────────────────────────────────────────────────

function llmsTxt() {
  const layers = getLayers();
  return `# ${SITE.name}

> ${SITE.description}

## When to use this

${WHEN_TO_USE.replace("{layers}", String(layers.length))}

## How to use it

- Read a page as markdown: append .md to any URL, e.g. ${abs("/stack/openclaw.md")} or ${abs("/layer/memory.md")}.
- Query the JSON API, no key needed: ${abs("/api/stacks.json")}, ${abs("/api/stacks/{slug}.json")}, ${abs("/api/layers/{layer}.json")}, ${abs("/api/options/{layer}/{option}.json")}. Spec: ${abs("/openapi.json")}. Docs: ${abs("/api/")}.
- In a browser with WebMCP, the pages expose tools: search_agentic_stack, list_stacks, get_stack, get_layer, get_option, open_stack_in_editor.
- On a closed product, a layer that isn't listed is "not disclosed", not "not used". Check each stack's disclosure field.

## Sections

- [Stacks index](${abs("/stack/llms.txt")}): every stack with its disclosure level
- [Layers index](${abs("/layer/llms.txt")}): every layer and its options
- [Everything in one file](${abs("/llms-full.txt")})

## Key pages

- [Home](${abs("/index.md")})
- [All layers](${abs("/layers.md")})
- [Trending](${abs("/trending.md")})
- [API docs](${abs("/api/")})
- [About](${abs("/about.md")})
- [Contribute](${abs("/contribute/")})
- [Pricing](${abs("/pricing.md")})
`;
}

const stacksLlms = () =>
  `# ${SITE.name}: stacks\n\n> How known AI agents are built, layer by layer, with sources.\n\n${getStacks()
    .map((s) => `- [${s.name}](${abs(mdPath(`/stack/${s.slug}/`))}): ${s.tagline} (${s.kind}; ${s.disclosure ?? "unknown"})`)
    .join("\n")}\n`;

const layersLlms = () =>
  `# ${SITE.name}: layers\n\n> The ${getLayers().length} layers of an AI agent stack and the options in each.\n\n${getLayers()
    .map((l) => `## [${l.name}](${abs(mdPath(`/layer/${l.id}/`))})\n\n${l.description}\n\n${l.options.map((o) => `- [${o.name}](${abs(mdPath(optionHref(l.id, o.id)))})${o.note ? `: ${o.note}` : ""}`).join("\n")}`)
    .join("\n\n")}\n`;

// ── JSON API ────────────────────────────────────────────────────────────────

const stackSummary = (s: Stack) => ({
  slug: s.slug,
  name: s.name,
  kind: s.kind,
  tagline: s.tagline,
  disclosure: s.disclosure ?? null,
  researched: s.researched ?? null,
  links: s.links ?? {},
  url: abs(`/stack/${s.slug}/`),
  markdown: abs(mdPath(`/stack/${s.slug}/`)),
  api: abs(`/api/stacks/${s.slug}.json`),
});

function stackJson(s: Stack) {
  const layers = getLayers();
  const unk = unknownLabel(s.disclosure);
  return {
    ...stackSummary(s),
    description: s.description,
    author: s.author ?? null,
    layers: layers
      .filter((l) => l.id in s.layers)
      .map((l) => ({
        id: l.id,
        name: l.name,
        band: l.band,
        ref: l.ref,
        picks: asArray(s.layers[l.id]).map((id) => {
          const o = l.options.find((x) => x.id === id)!;
          return { id, name: o.name, note: o.note ?? null, url: abs(optionHref(l.id, id)), api: abs(`/api/options/${l.id}/${id}.json`) };
        }),
        evidence: s.evidence?.[l.id] ?? [],
      })),
    // On closed or documented stacks, unlisted layers are unknown rather than absent.
    notDisclosed: unk ? layers.filter((l) => !(l.id in s.layers) && !s.notUsed?.includes(l.id)).map((l) => l.id) : [],
    notUsed: unk ? s.notUsed ?? [] : layers.filter((l) => !(l.id in s.layers)).map((l) => l.id),
    sources: s.sources ?? [],
  };
}

const optionSummary = (l: Layer, o: Option) => ({
  id: o.id,
  name: o.name,
  note: o.note ?? null,
  profile: o.profile ?? null,
  open: Boolean(o.open),
  url: abs(optionHref(l.id, o.id)),
  api: abs(`/api/options/${l.id}/${o.id}.json`),
});

const layerJson = (l: Layer, full: boolean) => ({
  id: l.id,
  name: l.name,
  band: l.band,
  ref: l.ref,
  description: l.description,
  url: abs(`/layer/${l.id}/`),
  api: abs(`/api/layers/${l.id}.json`),
  options: l.options.map((o) => (full ? { ...optionSummary(l, o), summary: o.summary ?? null, website: o.url ?? null } : optionSummary(l, o))),
});

function optionJson(l: Layer, o: Option) {
  const { order: _order, ...rest } = o;
  return {
    ...rest,
    layer: { id: l.id, name: l.name, band: l.band },
    url: abs(optionHref(l.id, o.id)),
    news: o.profile === "pattern" ? null : getNews(l.id, o.id) ?? null,
    usedBy: usedBy(l.id, o.id).map(stackSummary),
  };
}

function openapi() {
  const ok = (ref: string, description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } },
  });
  const param = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });
  return {
    openapi: "3.1.0",
    info: {
      title: `${SITE.name} API`,
      version: "1.0.0",
      summary: "Read-only JSON describing AI agent stacks, their layers and the options in each.",
      description:
        "Static JSON files rebuilt on every deploy. No authentication, no API key. Responses are cacheable; data changes about weekly. Errors are plain HTTP 404s for unknown slugs.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: SITE.url }],
    security: [],
    paths: {
      "/api/stacks.json": {
        get: { operationId: "listStacks", summary: "List all stacks", responses: { "200": ok("StackList", "Every stack, summarised") } },
      },
      "/api/stacks/{slug}.json": {
        get: {
          operationId: "getStack",
          summary: "Get one stack, layer by layer, with evidence and sources",
          parameters: [param("slug", "Stack slug, e.g. openclaw, chatgpt-dots, pi")],
          responses: { "200": ok("Stack", "The stack"), "404": { description: "No such stack" } },
        },
      },
      "/api/layers.json": {
        get: { operationId: "listLayers", summary: "List all layers with their options", responses: { "200": ok("LayerList", "Every layer") } },
      },
      "/api/layers/{layer}.json": {
        get: {
          operationId: "getLayer",
          summary: "Get one layer and all its options",
          parameters: [param("layer", "Layer id, e.g. model, harness, memory, sandbox")],
          responses: { "200": ok("Layer", "The layer"), "404": { description: "No such layer" } },
        },
      },
      "/api/options/{layer}/{option}.json": {
        get: {
          operationId: "getOption",
          summary: "Get one option: datasheet, links, news and the stacks that use it",
          parameters: [param("layer", "Layer id"), param("option", "Option id, e.g. openrouter, e2b, past-dev")],
          responses: { "200": ok("Option", "The option"), "404": { description: "No such option" } },
        },
      },
      "/search.json": {
        get: {
          operationId: "searchIndex",
          summary: "Compact search index of every stack, layer and option",
          responses: { "200": { description: "Rows of [kind, title, subtitle, href, logo, extra]", content: { "application/json": { schema: { type: "array", items: { type: "array", items: { type: "string" } } } } } } },
        },
      },
    },
    components: {
      schemas: {
        StackSummary: {
          type: "object",
          required: ["slug", "name", "kind", "url"],
          properties: {
            slug: { type: "string" },
            name: { type: "string" },
            kind: { type: "string" },
            tagline: { type: "string" },
            disclosure: { type: ["string", "null"], enum: ["open-source", "documented", "closed", "example", null], description: "What an absent layer means: open-source/example = not used, documented/closed = not disclosed" },
            researched: { type: ["string", "null"], format: "date" },
            links: { type: "object", additionalProperties: { type: "string", format: "uri" } },
            url: { type: "string", format: "uri" },
            markdown: { type: "string", format: "uri" },
            api: { type: "string", format: "uri" },
          },
        },
        StackList: { type: "object", required: ["stacks"], properties: { stacks: { type: "array", items: { $ref: "#/components/schemas/StackSummary" } } } },
        Stack: {
          allOf: [
            { $ref: "#/components/schemas/StackSummary" },
            {
              type: "object",
              properties: {
                description: { type: "string" },
                layers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      band: { type: "string" },
                      ref: { type: "string" },
                      picks: { type: "array", items: { $ref: "#/components/schemas/OptionSummary" } },
                      evidence: { type: "array", items: { type: "string", format: "uri" } },
                    },
                  },
                },
                notDisclosed: { type: "array", items: { type: "string" }, description: "Layer ids the maker hasn't disclosed" },
                notUsed: { type: "array", items: { type: "string" }, description: "Layer ids known not to be used" },
                sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string", format: "uri" } } } },
              },
            },
          ],
        },
        OptionSummary: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            note: { type: ["string", "null"] },
            profile: { type: ["string", "null"], enum: ["model", "product", "protocol", "pattern", null] },
            open: { type: "boolean" },
            url: { type: "string", format: "uri" },
            api: { type: "string", format: "uri" },
          },
        },
        Layer: {
          type: "object",
          required: ["id", "name", "band", "options"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            band: { type: "string", enum: BANDS.map(([b]) => b) },
            ref: { type: "string", description: "Board designator, e.g. U2" },
            description: { type: "string" },
            url: { type: "string", format: "uri" },
            options: { type: "array", items: { $ref: "#/components/schemas/OptionSummary" } },
          },
        },
        LayerList: { type: "object", required: ["layers"], properties: { layers: { type: "array", items: { $ref: "#/components/schemas/Layer" } } } },
        Option: {
          type: "object",
          description: "An option with its research: summary, facts as [label, value] pairs, links, goodFor, watchOut, how (patterns), model (models), news and usedBy.",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            summary: { type: "string" },
            facts: { type: "array", items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 } },
            news: { type: ["object", "null"] },
            usedBy: { type: "array", items: { $ref: "#/components/schemas/StackSummary" } },
          },
        },
      },
    },
  };
}

// ── Discovery catalogs and the skill ───────────────────────────────────────

const SKILL_MD = () => `---
name: agentic-stack
description: Look up how AI agents are built and compare components for each layer of an agent stack (models, model gateways, harnesses, sandboxes, browser use, memory, retrieval, triggers, guardrails, payments, observability). Use when choosing infrastructure for an agent, comparing options in one layer, or explaining how a known agent (OpenClaw, Hermes, Pi, Claude Code, Codex, ChatGPT dots, Meta Muse, Manus, Poke…) is put together.
---

# Agentic Stack

Read-only data about AI agent stacks at ${SITE.url}. No key needed.

## Steps

1. Find things: GET ${abs("/search.json")} (rows of [kind, title, subtitle, href, logo, extra]) or list them: GET ${abs("/api/stacks.json")}, ${abs("/api/layers.json")}.
2. Read a stack: GET ${abs("/api/stacks/{slug}.json")}. Each layer has picks and evidence URLs; cite those when you repeat a claim.
3. Compare a layer: GET ${abs("/api/layers/{layer}.json")}, then ${abs("/api/options/{layer}/{option}.json")} for datasheets, caveats ("watchOut") and recent news.
4. Respect disclosure: if a stack's disclosure is "closed" or "documented", a layer listed in notDisclosed is unknown, not absent. Say "not disclosed" rather than guessing.
5. Link people to the HTML page (the url field) or the markdown twin (append .md).

## Notes

- Vendor-published benchmark numbers are marked "(vendor-reported)" in facts; keep that label.
- Data changes about weekly; the researched dates tell you how fresh a record is.
- Spec: ${abs("/openapi.json")}.
`;

function catalog() {
  const entry = (id: string, displayName: string, type: string, url: string, description: string, extra: object = {}) => ({
    identifier: `urn:air:${host}:${id}`,
    displayName,
    type,
    url,
    description,
    auth: { status: "none" },
    ...extra,
  });
  return {
    specVersion: "1.0",
    host: { displayName: SITE.name, identifier: `did:web:${host}`, documentationUrl: abs("/api/") },
    entries: [
      entry("api:agentic-stack", `${SITE.name} API`, "application/vnd.oai.openapi+json", abs("/openapi.json"), "Read-only JSON API: stacks, layers and options with sources and news. No key.", {
        tags: ["ai-agents", "agent-stack", "directory", "comparison"],
        capabilities: ["listStacks", "getStack", "listLayers", "getLayer", "getOption"],
        representativeQueries: ["how is OpenClaw built", "which sandboxes exist for AI agents", "compare memory APIs for agents", "what model does ChatGPT dots use"],
      }),
      entry("skill:agentic-stack", "Agentic Stack skill", "text/markdown", abs("/.well-known/agent-skills/agentic-stack/SKILL.md"), "Agent Skill: how to look up stacks and compare components, respecting disclosure."),
      entry("docs:llms-txt", "llms.txt", "text/plain", abs("/llms.txt"), "Guide for AI readers: when to use the site and where everything is."),
      entry("data:search-index", "Search index", "application/json", abs("/search.json"), "Every stack, layer and option in one compact index."),
    ],
  };
}

function apiCatalog() {
  return {
    linkset: [
      { anchor: abs("/.well-known/api-catalog"), item: [{ href: abs("/api/") }] },
      {
        anchor: abs("/api/"),
        "service-desc": [{ href: abs("/openapi.json"), type: "application/vnd.oai.openapi+json" }],
        "service-doc": [{ href: abs("/api/"), type: "text/html" }],
        "service-meta": [{ href: abs("/llms.txt"), type: "text/plain" }],
      },
    ],
  };
}

// ── Everything, as path → content ──────────────────────────────────────────

export type AgentFile = { body: string; type: string };

export function agentFiles(): Record<string, AgentFile> {
  const md = (body: string): AgentFile => ({ body, type: "text/markdown" });
  const json = (o: unknown): AgentFile => ({ body: JSON.stringify(o, null, 2) + "\n", type: "application/json" });
  const txt = (body: string): AgentFile => ({ body, type: "text/plain" });
  const layers = getLayers();
  const stacks = getStacks();
  const files: Record<string, AgentFile> = {};

  // Markdown twins
  files["/index.md"] = md(homeMd());
  files["/layers.md"] = md(
    frontmatter({ title: "Layers of an AI agent stack", canonical: abs("/layers/"), "last-updated": BUILT }) +
      `# Layers\n\n${layers.map((l) => `- [${l.name}](${abs(mdPath(`/layer/${l.id}/`))}) (${l.ref}, ${l.band}): ${l.description}`).join("\n")}\n`,
  );
  files["/trending.md"] = md(trendingMd());
  files["/about.md"] = md(pageMd("About", "/about/", ABOUT, "What Agentic Stack is and how it is researched."));
  files["/privacy.md"] = md(pageMd("Privacy", "/privacy/", PRIVACY, "What Agentic Stack does and doesn't collect."));
  files["/contact.md"] = md(pageMd("Contact", "/contact/", CONTACT, "How to reach the maintainers."));
  files["/pricing.md"] = md(
    frontmatter({ title: "Pricing", description: "Agentic Stack is free.", canonical: abs("/pricing.md"), "last-updated": BUILT }) +
      PRICING_MD.replace("{api}", abs("/api/")),
  );
  files["/404.md"] = md(frontmatter({ title: "Not found", "last-updated": BUILT }) + `# Not found\n\nThat page doesn't exist on ${SITE.name}. Start from ${abs("/llms.txt")}, the sitemap at ${abs("/sitemap.xml")}, or search at ${abs("/search.json")}.\n`);
  for (const s of stacks) files[mdPath(`/stack/${s.slug}/`)] = md(stackMd(s));
  for (const l of layers) {
    files[mdPath(`/layer/${l.id}/`)] = md(layerMd(l));
    for (const o of l.options) files[mdPath(optionHref(l.id, o.id))] = md(optionMd(l, o));
  }

  // llms.txt family
  files["/llms-full.txt"] = txt(
    `# ${SITE.name}: full text\n\n> ${SITE.description}\n\n` +
      [homeMd(), ...stacks.map(stackMd), ...layers.map(layerMd)].map((m) => m.replace(/^---[\s\S]*?---\n\n/, "")).join("\n\n---\n\n"),
  );
  files["/stack/llms.txt"] = txt(stacksLlms());
  files["/layer/llms.txt"] = txt(layersLlms());

  // JSON API
  files["/api/stacks.json"] = json({ stacks: stacks.map(stackSummary) });
  for (const s of stacks) files[`/api/stacks/${s.slug}.json`] = json(stackJson(s));
  files["/api/layers.json"] = json({ layers: layers.map((l) => layerJson(l, false)) });
  for (const l of layers) {
    files[`/api/layers/${l.id}.json`] = json(layerJson(l, true));
    for (const o of l.options) files[`/api/options/${l.id}/${o.id}.json`] = json(optionJson(l, o));
  }
  files["/openapi.json"] = json(openapi());

  // Discovery
  files["/.well-known/ard.json"] = json(catalog());
  files["/.well-known/ai-catalog.json"] = json(catalog());
  files["/.well-known/api-catalog"] = { ...json(apiCatalog()), type: 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"' };
  const skill = SKILL_MD();
  files["/.well-known/agent-skills/agentic-stack/SKILL.md"] = md(skill);
  files["/.well-known/agent-skills/index.json"] = json({
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "agentic-stack",
        type: "skill-md",
        description: skill.match(/^description: (.*)$/m)![1],
        url: "/.well-known/agent-skills/agentic-stack/SKILL.md",
        digest: `sha256:${crypto.createHash("sha256").update(skill).digest("hex")}`,
      },
    ],
  });
  return files;
}

export { llmsTxt };
