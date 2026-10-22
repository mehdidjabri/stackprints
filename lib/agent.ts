// Everything the site publishes for agents rather than people: markdown twins of every page,
// llms.txt files, a read-only JSON API with its OpenAPI spec, discovery catalogs and a skill.
// One function, agentFiles(), returns them all as path → file; scripts/agent-files.mjs writes
// them into out/ after the build, so the site stays fully static.
import crypto from "node:crypto";
import { BANDS } from "./bands";
import {
  PROMPT_KIND,
  SITE,
  affiliated,
  asArray,
  getHot,
  getLayers,
  getNews,
  getPrompts,
  getStacks,
  getTrending,
  layerDate,
  layerPrompts,
  layersDate,
  newsDate,
  optionDate,
  resolve,
  siteDate,
  stackTitle,
  stacksDate,
  storyCount,
  usage,
  usageText,
  usedBy,
} from "./data";
import { EMPTY, disclosureOf, emptyLayers, isSupported } from "./disclosure";
import { MD_RULE, citeNumbers, kindHref, mdPath, numberedSources, optionHref, promptFile, promptHref, renamedLayers, stackSources } from "./links";
import type { Layer, Option, Prompt, Stack } from "./types";
import type { HotCard } from "./data";

export const BUILT = new Date().toISOString().slice(0, 10);
const abs = (p: string) => `${SITE.url}${p}`;
const host = new URL(SITE.url).host;


const WHEN_TO_USE = `Use Stackprints when you need to:

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
// Twins link each other as .md, for agents reading markdown, but each says under its title which
// URL to cite: the HTML page (vercel.json sends the same as a canonical Link header).

const h1 = (title: string, page: string) => `# ${title}\n\nCite: ${abs(page)}\n\n`;

/** The hot list as a section: what X talks about this week, stacks then components, each with its page and sources. */
function hotMd() {
  const hot = getHot();
  if (!hot || !(hot.stacks.length + hot.options.length)) return "";
  const list = (cards: HotCard[]) =>
    cards
      .map(({ item, name, label, href }) => `- [${name}](${abs(mdPath(href))}) (${label}): ${item.why}${item.since ? ` Since ${item.since}.` : ""} Sources: ${item.sources.map((s) => `[${s.title}](${s.url})`).join(", ")}`)
      .join("\n");
  return (
    `## Hot right now\n\nWhat people on X talked about the most from ${hot.from} to ${hot.updated}, most first. As JSON: ${abs("/api/hot.json")}\n\n` +
    (hot.stacks.length ? `### Stacks\n\n${list(hot.stacks)}\n\n` : "") +
    (hot.options.length ? `### Layers\n\n${list(hot.options)}\n\n` : "")
  );
}

function homeMd() {
  const layers = getLayers();
  const stacks = getStacks();
  return (
    frontmatter({ title: SITE.name, description: SITE.description, canonical: abs("/"), "last-updated": siteDate() ?? BUILT }) +
    `${h1(SITE.name, "/")}> ${SITE.description}\n\n## When to use this\n\n${WHEN_TO_USE.replace("{layers}", String(layers.length))}\n\n` +
    hotMd() +
    `## Stacks\n\n${stacks.map((s) => `- [${s.name}](${abs(mdPath(`/stack/${s.slug}/`))}): ${s.tagline} (${s.kind}${disclosureOf(s) ? `, ${disclosureOf(s)!.badge.toLowerCase()}` : ""})`).join("\n")}\n\n` +
    `## Layers\n\n${BANDS.map(([b, name]) => `### ${name}\n\n${layers
      .filter((l) => l.band === b)
      .map((l) => `- [${l.name}](${abs(mdPath(`/layer/${l.id}/`))}) (${l.ref}): ${l.description}`)
      .join("\n")}`).join("\n\n")}\n\n` +
    `## For agents\n\n- [API docs](${abs("/api/")}) and [OpenAPI spec](${abs("/openapi.json")}): read-only JSON, no key needed\n- [llms.txt](${abs("/llms.txt")}) and [llms-full.txt](${abs("/llms-full.txt")})\n- Every content page has a markdown twin: ${MD_RULE}\n`
  );
}

function stackMd(s: Stack) {
  const rows = resolve(s);
  const badge = disclosureOf(s);
  const sources = stackSources(s);
  const cites = (layerId: string) => citeNumbers(sources, s.evidence?.[layerId]).map((n) => `[${n}]`).join("");
  const link = (layerId: string, p: Option) => `[${p.name}](${abs(mdPath(optionHref(layerId, p.id)))})`;
  // Picks the stack runs, then the ones it only supports.
  const picksMd = (layerId: string, picks: Option[]) => {
    const used = picks.filter((p) => !isSupported(s, layerId, p.id)).map((p) => link(layerId, p));
    const extra = picks.filter((p) => isSupported(s, layerId, p.id)).map((p) => link(layerId, p));
    return [used.join(", "), extra.length ? `${used.length ? "also supports" : "supports"}: ${extra.join(", ")}` : ""].filter(Boolean).join("; ");
  };
  const empty = emptyLayers(s, getLayers());
  const own = affiliated(s);
  const prompts = getPrompts(s.slug);
  const layerName = (id: string) => getLayers().find((l) => l.id === id)?.name ?? id;
  return (
    frontmatter({ title: stackTitle(s), description: s.tagline, canonical: abs(`/stack/${s.slug}/`), "last-updated": s.researched ?? BUILT }) +
    `${h1(s.name, `/stack/${s.slug}/`)}${s.kind}${badge ? ` · ${badge.badge}: ${badge.about.toLowerCase()}` : ""}${s.researched ? ` · ${s.disclosure === "example" ? "checked" : "researched"} ${s.researched}` : ""}${s.version ? ` against ${s.version}` : ""}\n\n${s.description}\n\n` +
    (own.length ? `> Disclosure: this ${s.disclosure === "example" ? "example" : "stack"} uses ${own.map((o) => o.name).join(", ")}. ${[...new Set(own.map((o) => o.affiliation))].join(" ")}\n\n` : "") +
    (s.links ? `${Object.entries(s.links).map(([k, u]) => `- ${k}: ${u}`).join("\n")}\n\n` : "") +
    `## Layers\n\n${rows.map(({ layer, picks }) => `- **${layer.name}** (${layer.ref}): ${picksMd(layer.id, picks)}${cites(layer.id)}`).join("\n")}\n` +
    (empty.present.length ? `\n## In use, not disclosed\n\n${empty.present.map((l) => `${l.name}${cites(l.id)}`).join(", ")}\n` : "") +
    (empty.unknown.length ? `\n## ${EMPTY.unknown}\n\n${empty.unknown.map((l) => l.name).join(", ")}\n` : "") +
    // "Confirmed" only means something next to a list of layers that aren't known.
    (empty.unused.length
      ? `\n## ${empty.unknown.length || empty.present.length ? "Not used (confirmed)" : EMPTY.unused}\n\n${empty.unused.map((l) => l.name).join(", ")}\n`
      : "") +
    (prompts.length
      ? `\n## Prompts\n\nPublished by the makers, copied word for word. Each file has the text and where it came from.\n\n${prompts
          .map((p) => `- **${layerName(p.layer)}** · ${PROMPT_KIND[p.kind].toLowerCase()}: [${p.title}](${abs(promptFile(s.slug, p.id))})${p.note ? ` — ${p.note}` : ""} (${p.license}; copied ${p.retrieved} from ${p.source})`)
          .join("\n")}\n`
      : "") +
    (sources.length ? `\n## ${s.disclosure === "example" ? "Further reading" : "Sources"}\n\n${sources.map((x, i) => `${i + 1}. [${x.title}](${x.url})`).join("\n")}\n` : "") +
    `\nAs JSON: ${abs(`/api/stacks/${s.slug}.json`)}\n`
  );
}

function kindMd(kind: string) {
  const xs = getStacks().filter((s) => s.kind === kind);
  return (
    frontmatter({ title: `${kind} stacks`, canonical: abs(kindHref(kind)), "last-updated": stacksDate(xs) ?? BUILT }) +
    `${h1(`${kind} stacks`, kindHref(kind))}${xs
      .map((s) => `- [${s.name}](${abs(mdPath(`/stack/${s.slug}/`))}): ${s.tagline}${disclosureOf(s) ? ` (${disclosureOf(s)!.badge.toLowerCase()})` : ""}`)
      .join("\n")}\n\nAll stacks: ${abs("/index.md")}\n`
  );
}

function layerMd(l: Layer) {
  const own = l.options.filter((o) => o.affiliation);
  return (
    frontmatter({ title: `${l.name} for AI agents`, description: l.description, canonical: abs(`/layer/${l.id}/`), "last-updated": layerDate(l) ?? BUILT }) +
    `${h1(l.name, `/layer/${l.id}/`)}${l.ref} · ${BANDS.find(([b]) => b === l.band)![1]} band · ${l.options.length} options\n\n` +
    own.map((o) => `> Disclosure (${o.name}): ${o.affiliation}\n\n`).join("") +
    `${l.description}\n\n## Options\n\n` +
    l.options
      .map((o) => {
        const { stacks, examples } = usage(l.id, o.id);
        const names = (xs: Stack[]) => xs.map((u) => u.name).join(", ");
        return `- [${o.name}](${abs(mdPath(optionHref(l.id, o.id)))})${o.note ? `: ${o.note}` : ""}${o.open ? " (open)" : ""}${o.profile ? ` [${o.profile}]` : ""}${stacks.length ? ` · used by ${names(stacks)}` : ""}${examples.length ? ` · example designs: ${names(examples)}` : ""}`;
      })
      .join("\n") +
    (layerPrompts(l.id).length
      ? `\n\n## Published prompts\n\nWhat stacks' makers publish for this layer, copied word for word:\n\n${layerPrompts(l.id)
          .map(({ stack, prompt: p }) => `- [${stack.name}](${abs(mdPath(`/stack/${stack.slug}/`))}): [${p.title}](${abs(promptFile(stack.slug, p.id))}) (${PROMPT_KIND[p.kind].toLowerCase()}, ${p.license})`)
          .join("\n")}`
      : "") +
    `\n\nAs JSON: ${abs(`/api/layers/${l.id}.json`)}\n`
  );
}

function optionMd(l: Layer, o: Option) {
  const news = o.profile === "pattern" ? undefined : getNews(l.id, o.id);
  const { stacks, examples } = usage(l.id, o.id);
  const list = (xs: Stack[]) => xs.map((u) => `- [${u.name}](${abs(mdPath(`/stack/${u.slug}/`))})`).join("\n");
  const m = o.model;
  // Datasheet entries cite their sources like a stack's layers do (see Option.evidence).
  const sources = numberedSources(o.sources, o.evidence);
  const cites = (key: string) => citeNumbers(sources, o.evidence?.[key]).map((n) => ` [${n}]`).join("");
  const parts = [
    frontmatter({
      title: `${o.name}: ${l.name.toLowerCase()} for AI agents`,
      description: o.summary ?? o.note,
      canonical: abs(optionHref(l.id, o.id)),
      "last-updated": optionDate(l.id, o) ?? BUILT,
    }),
    `${h1(o.name, optionHref(l.id, o.id))}${[o.profile, l.name, o.open ? "open" : undefined, usageText({ stacks, examples }) || undefined, o.url].filter(Boolean).join(" · ")}\n`,
    o.affiliation ? `\n> Disclosure: ${o.affiliation}\n` : "",
    o.note ? `\n> ${o.note}\n` : "",
    o.summary ? `\n${o.summary}\n` : "",
    m ? `\n## Model\n\n${Object.entries(m).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : v}${cites(`model.${k}`)}`).join("\n")}\n` : "",
    o.facts?.length ? `\n## Datasheet\n\n| | |\n|---|---|\n${o.facts.map(([k, v]) => `| ${k} | ${v.replace(/\|/g, "\\|")}${cites(k)} |`).join("\n")}\n` : "",
    o.how?.length ? `\n## How it works\n\n${o.how.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n` : "",
    o.goodFor?.length ? `\n## Good for\n\n${o.goodFor.map((g) => `- ${g}`).join("\n")}\n` : "",
    o.watchOut?.length ? `\n## Watch out for\n\n${o.watchOut.map((g, i) => `- ${g}${cites(`watchOut.${i}`)}`).join("\n")}\n` : "",
    o.links ? `\n## Links\n\n${Object.entries(o.links).map(([k, u]) => `- ${k}: ${u}`).join("\n")}\n` : "",
    sources.length ? `\n## Sources\n\n${sources.map((x, i) => `${i + 1}. [${x.title}](${x.url})`).join("\n")}\n` : "",
    stacks.length ? `\n## Used in stacks\n\n${list(stacks)}\n` : "",
    // Example designs are written by this site: listed, never counted as adoption.
    examples.length ? `\n## In example designs\n\n${list(examples)}\n` : "",
    news?.items.length ? `\n## Latest news (checked ${news.updated})\n\n${news.items.map((n) => `- ${n.date}: [${n.title}](${n.url}) (${n.source})`).join("\n")}\n` : "",
    `\nAlternatives: ${abs(mdPath(`/layer/${l.id}/`))} · As JSON: ${abs(`/api/options/${l.id}/${o.id}.json`)}\n`,
  ];
  return parts.join("");
}

function trendingMd() {
  const rows = getTrending().slice(0, 40);
  const asOf = newsDate();
  return (
    frontmatter({ title: "Trending in AI agent infrastructure", description: "Options most in the news over the last 30 days.", canonical: abs("/trending/"), "last-updated": asOf ?? BUILT }) +
    `${h1("Trending", "/trending/")}Ranked by news from the 30 days up to ${asOf ? `${asOf}, when news was last checked` : "today"}: every story counts, newer stories count more.${rows.some((r) => r.atLeast) ? ` "5+" means the option's news file holds only its 5 newest stories, so there may be more.` : ""}\n\n` +
    rows.map((r, i) => `${i + 1}. [${r.option.name}](${abs(mdPath(optionHref(r.layer.id, r.option.id)))}) (${r.layer.name}, ${storyCount(r)}): ${r.latest.date} [${r.latest.title}](${r.latest.url})${r.option.affiliation ? ` (disclosure: ${r.option.affiliation})` : ""}`).join("\n") +
    "\n"
  );
}

// Trust pages share their copy between HTML and markdown.
export const ABOUT = `Stackprints is an open, community-maintained map of how AI agents are built. It breaks an agent into ${"{layers}"} layers, from the channels people reach it through to the model, the harness that runs the loop, the sandbox its code runs in, its memory, what wakes it up, its guardrails and where it is hosted. Each layer lists the real options people use today, and each stack shows which option a known agent picks in every layer. Stacks marked Example are designs written for this site to show how the parts fit together; they are not products, and the site counts them apart from real use.

Every pick in a real product's stack links to the source that backs it. Option datasheets are researched from public pages, such as the vendor links shown on each option, and each says when it was last researched. Open-source stacks are built from their public code; closed products are built only from what their makers and reputable press have published, and every layer they haven't disclosed is marked "Not disclosed" rather than guessed. Benchmark numbers that a vendor publishes about itself are labelled vendor-reported. Rankings and listings are never paid for.

The site is static and free: no accounts, no ads, no tracking. All data lives as JSON files in a public GitHub repository, anyone can propose a change by pull request, and a weekly job refreshes the news for every option.`;

// How to read a stack: the four disclosure levels and the two empty states. Rendered on /about/#disclosure.
export const READING = `Every stack carries a disclosure level, shown as a badge on its page and, for all but open source, next to its kind on its card:

- Open source: built from the public code, so a layer that isn't listed is not used.
- Open core: open source with closed parts (apps or a hosted service). The layers only those parts could fill are built from docs and read as not disclosed.
- Documented: built from the vendor's docs, for products that aren't fully open (closed code or hosted services).
- Closed: inferred from what the maker and reputable press have published.
- Example: a design written for this site, not a product. Its links are further reading, not evidence.

On the board, a hatched slot is not disclosed: the maker hasn't said, so the layer is unknown rather than absent. A slot outlined with a "?" is in use, but the maker hasn't said with what; a source confirms it's there. A dashed slot is not used. A part marked "Supported" or "Also supported" is one the stack can be configured to use rather than what it runs out of the box. Any model, Any provider and Any host mark stacks that work with whichever model, gateway or host you choose.`;

// The site's conflict of interest, said wherever it applies (see Option.affiliation) and in full here.
export const AFFILIATION = `Stackprints is built by the team behind past.dev, a memory API listed here. past.dev is the first suggestion in the Memory layer and the memory in example designs where a hosted memory API fits. Stacks of real products list past.dev only where a source shows they use it, and its benchmark numbers are marked vendor-reported like everyone else's.`;

export const PRIVACY = `Stackprints is a static website. It sets no cookies, runs no analytics or advertising scripts, and has no accounts, so we don't collect personal data about visitors.

Stacks you save with the Save button are kept in your own browser's local storage and never leave your device; clearing your browser data removes them. Share links encode the stack inside the URL itself, so whoever has the link can read that stack, and nothing is stored on a server.

The hosting provider may keep standard server logs (IP address, user agent, requested URL) for security and operations, under its own privacy policy. Links to other websites, logos of third-party products and the GitHub pull-request flow are subject to those services' own policies. If you contribute through GitHub, your contribution and GitHub username become part of the public repository history.`;

export const CONTACT = `Stackprints is maintained in the open on GitHub. To report a mistake, ask for a correction or suggest a product, open an issue or a pull request in the repository; every page also has an "Edit" link that opens the right file. Vendors who want their product listed can use the Submit form, which opens a pre-filled pull request, and can request corrections to a stack or an option the same way.

For questions about how the site works, see the About page and the contribution guide. Security issues should be reported privately through GitHub's security advisory form on the repository rather than in a public issue.`;

// Hand-written pages carry no last-updated: the build date would say nothing about the copy.
const pageMd = (title: string, path: string, body: string, description: string) =>
  frontmatter({ title, description, canonical: abs(path) }) + `${h1(title, path)}${body.replace("{layers}", String(getLayers().length))}\n`;

export const PRICING_MD = `# Pricing

Stackprints is free.

- Website: free, no account.
- JSON API (${"{api}"}): free, read-only, no API key, no rate-limit tiers. Please cache responses; data changes weekly.
- Listing a product: free, by pull request. Listings and rankings are never paid for.
- Data license: MIT, like the code.
`;

// The API page's copy, shared with its markdown twin. `code` spans render as <code> on the page.
export const API_ENDPOINTS: [string, string, string][] = [
  ["GET /api/stacks.json", "Every stack: name, kind, tagline, disclosure, links", "/api/stacks.json"],
  ["GET /api/stacks/{slug}.json", "One stack, layer by layer, with evidence URLs, sources, notDisclosed, inUseUndisclosed and notUsed", "/api/stacks/openclaw.json"],
  ["GET /api/layers.json", "Every layer with its options", "/api/layers.json"],
  ["GET /api/layers/{layer}.json", "One layer with option summaries", "/api/layers/memory.json"],
  ["GET /api/options/{layer}/{option}.json", "One option: datasheet facts, links, caveats, news, stacks that use it", "/api/options/router/openrouter.json"],
  ["GET /api/hot.json", "What people on X talk about the most this week: stacks and components, each ranked with its page and sources", "/api/hot.json"],
  ["GET /search.json", "Compact search index of every stack, layer and option", "/search.json"],
];

export const apiLede = () =>
  `Everything on ${SITE.name} is available as static JSON: ${getStacks().length} stacks with their sources, ${getLayers().length} layers, and every option with its links and research date. No authentication, no API key, no rate-limit tiers. It's free.`;

/** Layer ids never change, so some differ from the name a layer goes by now. */
export const layerIds = () =>
  `Use layer ids, not names, in \`{layer}\`: \`/api/layers.json\` lists them all. Some differ from the name shown: ${renamedLayers(getLayers())}.`;

export const API_READING = `Each stack has a \`disclosure\`: \`open-source\` and \`example\` stacks list everything they use, so a missing layer is not used. \`documented\` and \`closed\` stacks only list what their makers or reputable press have published; layers in \`notDisclosed\` are unknown, not absent. An open-source stack with closed parts lists the layers only those parts could fill under \`notDisclosed\` too. Layers in \`inUseUndisclosed\` are present, with evidence, but their component isn't named. A pick with \`"supported": true\` is something the stack can be configured to use, not what it runs by default. Every pick on a real product has evidence URLs in \`layers[].evidence\`. An \`example\` stack is a design written for this site, not a product: an option's \`usage\` counts examples apart from real stacks, so don't read them as adoption.`;

export const API_VERSIONING = `The API is version 1. Fields are only added, never renamed or removed, within a major version; a breaking change would ship under a new path with notice in the repository. Unknown slugs return a plain HTTP 404. Data is rebuilt on every deploy and the news refreshes weekly, so cache freely.`;

function apiMd() {
  return (
    frontmatter({ title: "API", description: "Free, read-only JSON API for AI agent stacks, layers and options.", canonical: abs("/api/") }) +
    `${h1("API", "/api/")}${apiLede()}\n\n## Endpoints\n\n${API_ENDPOINTS.map(([route, what, example]) => `- \`${route}\`: ${what}. Example: ${abs(example)}`).join("\n")}\n\n${layerIds()}\n\n` +
    `## Example\n\n\`\`\`\ncurl ${abs("/api/stacks/openclaw.json")}\n\`\`\`\n\n` +
    `## Reading stacks correctly\n\n${API_READING} See also [Reading a stack](${abs("/about.md")}).\n\n` +
    `## Machine-readable\n\n- OpenAPI 3.1: ${abs("/openapi.json")}\n- API catalog (RFC 9727): ${abs("/.well-known/api-catalog")}\n- Agent resource catalog: ${abs("/.well-known/ard.json")}\n- Agent skill: ${abs("/.well-known/agent-skills/index.json")}\n- Guides for AI readers: ${abs("/llms.txt")}, ${abs("/llms-full.txt")}; every content page also has a markdown twin: ${MD_RULE}\n\n` +
    `## Versioning and errors\n\n${API_VERSIONING}\n`
  );
}

/** The stack file the contribute page shows, shared with its markdown twin. */
export const STACK_EXAMPLE = `{
  "slug": "my-agent",
  "name": "My Agent",
  "kind": "Personal agent",
  "tagline": "One line people will read in the grid.",
  "description": "Two or three sentences on how it works.",
  "author": { "name": "Ada", "url": "https://x.com/ada" },
  "links": { "site": "https://my-agent.dev", "repo": "https://github.com/me/my-agent" },
  "disclosure": "open-source",
  "sources": [{ "title": "README", "url": "https://github.com/me/my-agent" }],
  "layers": {
    "channels": ["telegram", "email"],
    "model": "claude-sonnet-5-5",
    "harness": "pi",
    "memory": "memory-md"
  },
  "evidence": { "memory": ["https://github.com/me/my-agent"] },
  "notUsed": ["sandbox"],
  "researched": "YYYY-MM-DD"
}`;

// Mirrors app/contribute/page.tsx; change both together.
function contributeMd() {
  return (
    frontmatter({ title: "Contribute", description: "Add an agent stack, a layer or an option to Stackprints. Everything is plain JSON in a public repo.", canonical: abs("/contribute/") }) +
    `${h1("Contribute", "/contribute/")}Everything on this site is plain JSON in [a public repo](${SITE.repo}). No database. You need a GitHub account to open a pull request; it ships on merge.\n\n` +
    `## Publish your stack as a page\n\nBuild it on the [home page](${abs("/")}), press **Publish as a page**, add your name, a tagline and two sentences, and open the pull request. It becomes \`content/stacks/your-stack.json\` and, once merged, gets its own page at \`/stack/your-stack/\` with a preview image.\n\n\`\`\`json\n${STACK_EXAMPLE}\n\`\`\`\n\n` +
    `\`disclosure\` decides what an empty slot means: on \`open-source\` and \`example\` stacks it is not used; on \`documented\` and \`closed\` stacks it is not disclosed. \`evidence\` gives, for each layer the stack picks, the URLs that back the pick, taken from \`sources\`. \`notUsed\` lists layers a source confirms are absent. Three optional fields cover the in-between cases: \`inUseUndisclosed\` (present, component not named), \`closedLayers\` (open source with closed parts) and \`supports\` (configurable rather than default). The full rules are in [docs/RESEARCH.md](${SITE.repo}/blob/main/docs/RESEARCH.md).\n\n` +
    `## List your product\n\nUse the [submit form](${abs("/submit/")}): it writes the file and opens the pull request.\n\n` +
    `## Add a layer\n\nAdd it to \`content/layers.json\` with a band: \`surface\`, \`brain\`, \`hands\`, \`files\` or \`ops\`, and create \`content/options/<layer>/\`.\n\n` +
    `## Check before you push\n\n\`\`\`\nnpm run check\n\`\`\`\n\nIt checks ids, file names, logos, and that every stack points at layers and options that exist.\n\n` +
    `## House rules\n\nBe factual and link a source. For closed products, describe what is publicly reported and say so. No affiliate links. Keep notes short and neutral.\n`
  );
}

// ── llms.txt family ─────────────────────────────────────────────────────────

const stripFrontmatter = (m: string) => m.replace(/^---[\s\S]*?---\n\n/, "");
const SEP = "\n\n---\n\n";

/** A layer, then every option's datasheet, as one text. */
const layerFull = (l: Layer) => [layerMd(l), ...l.options.map((o) => optionMd(l, o))].map(stripFrontmatter).join(SEP);

// Everything in one file: home, stacks, then each layer followed by its options. It is large, so
// each layer is also published on its own at /layer/<id>/llms-full.txt.
let full: string | undefined;
const llmsFull = () =>
  (full ??=
    `# ${SITE.name}: full text\n\n> ${SITE.description}\n\n` +
    [...[homeMd(), ...getStacks().map(stackMd)].map(stripFrontmatter), ...getLayers().map(layerFull)].join(SEP));

function llmsTxt() {
  const layers = getLayers();
  const kb = Math.round(Buffer.byteLength(llmsFull()) / 1024);
  return `# ${SITE.name}

> ${SITE.description}

## When to use this

${WHEN_TO_USE.replace("{layers}", String(layers.length))}

## How to use it

- Read any content page as markdown: ${MD_RULE}. Cite the HTML URL; each twin names it under its title.
- Query the JSON API, no key needed: ${abs("/api/stacks.json")}, ${abs("/api/stacks/{slug}.json")}, ${abs("/api/layers/{layer}.json")}, ${abs("/api/options/{layer}/{option}.json")}. Spec: ${abs("/openapi.json")}. Docs: ${abs("/api/")}.
- Layer ids are fixed and some differ from the name shown: ${renamedLayers(layers)}. URLs and the API use ids; ${abs("/api/layers.json")} lists them all.
- In a browser with WebMCP, the pages expose tools: search_stackprints, list_stacks, get_hot, get_stack, get_layer, get_option, open_stack_in_editor.
- On a closed or documented product, a layer that isn't listed is "not disclosed", not "not used". In the API, read each stack's notDisclosed, inUseUndisclosed (present, but the component isn't named) and notUsed lists rather than inferring from the disclosure field.
- A pick with "supported": true is something the stack can be configured to use, not what it runs by default.
- Stacks with disclosure "example" are designs written for this site, not products. Don't count them as adoption: an option's API record counts them apart (usage.exampleDesigns).

## Disclosure

${AFFILIATION}

## Sections

- [Stacks index](${abs("/stack/llms.txt")}): every stack with its disclosure level
- [Layers index](${abs("/layer/llms.txt")}): every layer and its options
- [Everything in one file](${abs("/llms-full.txt")}): every stack, layer and option datasheet (about ${kb} KB)
- One layer with every option's datasheet: ${abs("/layer/{layer}/llms-full.txt")}, e.g. [Memory](${abs("/layer/memory/llms-full.txt")})

## Key pages

- [Home](${abs("/index.md")})
- [All layers](${abs("/layers.md")})
- [Trending](${abs("/trending.md")})
- [API docs](${abs("/api.md")})
- [About](${abs("/about.md")})
- [Contribute](${abs("/contribute.md")})
- [Pricing](${abs("/pricing.md")})
`;
}

const stacksLlms = () =>
  `# ${SITE.name}: stacks\n\n> How known AI agents are built, layer by layer, with sources.\n\n${getStacks()
    .map((s) => `- [${s.name}](${abs(mdPath(`/stack/${s.slug}/`))}): ${s.tagline} (${s.kind}; ${s.disclosure ?? "unknown"}${s.closedLayers?.length ? ", open core" : ""})`)
    .join("\n")}\n`;

const layersLlms = () =>
  `# ${SITE.name}: layers\n\n> The ${getLayers().length} layers of an AI agent stack and the options in each.\n\n${getLayers()
    .map((l) => `## [${l.name}](${abs(mdPath(`/layer/${l.id}/`))})\n\n${l.description}\n\n${l.options.map((o) => `- [${o.name}](${abs(mdPath(optionHref(l.id, o.id)))})${o.note ? `: ${o.note}` : ""}${o.affiliation ? ` (disclosure: ${o.affiliation})` : ""}`).join("\n")}`)
    .join("\n\n")}\n`;

// ── JSON API ────────────────────────────────────────────────────────────────

const stackSummary = (s: Stack) => ({
  slug: s.slug,
  name: s.name,
  kind: s.kind,
  tagline: s.tagline,
  disclosure: s.disclosure ?? null,
  researched: s.researched ?? null,
  version: s.version ?? null,
  links: s.links ?? {},
  url: abs(`/stack/${s.slug}/`),
  markdown: abs(mdPath(`/stack/${s.slug}/`)),
  api: abs(`/api/stacks/${s.slug}.json`),
});

const promptSummary = (s: Pick<Stack, "slug">, p: Prompt) => ({
  id: p.id,
  layer: p.layer,
  kind: p.kind,
  title: p.title,
  note: p.note ?? null,
  source: p.source,
  license: p.license,
  retrieved: p.retrieved,
  url: abs(promptHref(s.slug, p.id)),
  file: abs(promptFile(s.slug, p.id)),
});

function stackJson(s: Stack) {
  const layers = getLayers();
  const empty = emptyLayers(s, layers);
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
        // OptionSummary, as the spec says, so profile tells a pattern ("Any model") from a product.
        picks: asArray(s.layers[l.id]).map((id) => ({
          ...optionSummary(l, l.options.find((x) => x.id === id)!),
          ...(isSupported(s, l.id, id) ? { supported: true } : {}),
        })),
        evidence: s.evidence?.[l.id] ?? [],
      })),
    // Every unlisted layer is in exactly one list: unknown, present but unnamed, or absent.
    notDisclosed: empty.unknown.map((l) => l.id),
    inUseUndisclosed: empty.present.map((l) => ({ id: l.id, name: l.name, evidence: s.evidence?.[l.id] ?? [] })),
    notUsed: empty.unused.map((l) => l.id),
    // Numbered as cited: sources[n - 1] is citation [n] on the page and in the markdown.
    sources: stackSources(s),
    prompts: getPrompts(s.slug).map((p) => promptSummary(s, p)),
  };
}

// `url` is always this site's page; the vendor's site is `website`, host and path without the scheme,
// as the option file records it (links.site has the full URL when there is one).
const website = (o: Option) => o.url ?? null;

const optionSummary = (l: Layer, o: Option) => ({
  id: o.id,
  name: o.name,
  note: o.note ?? null,
  profile: o.profile ?? null,
  open: Boolean(o.open),
  ...(o.affiliation ? { affiliation: o.affiliation } : {}),
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
  options: l.options.map((o) => (full ? { ...optionSummary(l, o), summary: o.summary ?? null, website: website(o) } : optionSummary(l, o))),
  ...(full ? { prompts: layerPrompts(l.id).map(({ stack, prompt }) => ({ stack: stack.slug, ...promptSummary(stack, prompt) })) } : {}),
});

function optionJson(l: Layer, o: Option) {
  const { order: _order, ...rest } = o;
  const { stacks, examples } = usage(l.id, o.id);
  return {
    ...rest,
    layer: { id: l.id, name: l.name, band: l.band },
    url: abs(optionHref(l.id, o.id)),
    website: website(o),
    news: o.profile === "pattern" ? null : getNews(l.id, o.id) ?? null,
    // usedBy keeps every stack (API v1 never changes a field's meaning); usage counts examples apart.
    usage: { stacks: stacks.length, exampleDesigns: examples.length },
    usedBy: usedBy(l.id, o.id).map(stackSummary),
  };
}

function openapi() {
  const ok = (ref: string, description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } },
  });
  const param = (name: string, description: string, values?: string[]) => ({
    name,
    in: "path",
    required: true,
    description,
    schema: values ? { type: "string", enum: values } : { type: "string" },
  });
  // The paths are static files, so only exact ids resolve: list them, and the ones a name doesn't give away.
  const layers = getLayers();
  const layerIdList = layers.map((l) => l.id);
  const layerParam = param("layer", `Layer id, not the display name (see /api/layers.json): ${renamedLayers(layers)}`, layerIdList);
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
      "/api/hot.json": {
        get: { operationId: "getHot", summary: "The products people on X talk about the most this week", responses: { "200": ok("HotList", "The hot list, most talked about first") } },
      },
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
          parameters: [layerParam],
          responses: { "200": ok("Layer", "The layer"), "404": { description: "No such layer" } },
        },
      },
      "/api/options/{layer}/{option}.json": {
        get: {
          operationId: "getOption",
          summary: "Get one option: datasheet, links, news and the stacks that use it",
          parameters: [layerParam, param("option", "Option id, e.g. openrouter, e2b (listed by getLayer)")],
          responses: { "200": ok("Option", "The option"), "404": { description: "No such option" } },
        },
      },
      "/search.json": {
        get: {
          operationId: "searchIndex",
          summary: "Compact search index of every stack, layer and option",
          responses: { "200": { description: "Rows of [kind, title, subtitle, href, logo, extra, uses]; uses lists a stack's picks as \"Layer: Option\" joined by \"; \"", content: { "application/json": { schema: { type: "array", items: { type: "array", items: { type: "string" } } } } } } },
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
            disclosure: { type: ["string", "null"], enum: ["open-source", "documented", "closed", "example", null], description: "What an absent layer means: open-source/example = not used, documented/closed = not disclosed. An open-source stack with closed parts (open core) lists the layers only those parts could fill under notDisclosed. example = a design written for this site, not a product" },
            researched: { type: ["string", "null"], format: "date", description: "When the picks were last checked against the sources" },
            version: { type: ["string", "null"], description: "The product release the picks were mapped from, when recorded" },
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
                      picks: {
                        type: "array",
                        items: {
                          allOf: [
                            { $ref: "#/components/schemas/OptionSummary" },
                            { type: "object", properties: { supported: { type: "boolean", description: "Present and true when the stack can be configured to use this option but doesn't run it by default" } } },
                          ],
                        },
                      },
                      evidence: { type: "array", items: { type: "string", format: "uri" } },
                    },
                  },
                },
                notDisclosed: { type: "array", items: { type: "string" }, description: "Layer ids the maker hasn't disclosed: unknown, not absent" },
                inUseUndisclosed: {
                  type: "array",
                  description: "Layers a source confirms are present, but whose component the maker hasn't named",
                  items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, evidence: { type: "array", items: { type: "string", format: "uri" } } } },
                },
                notUsed: { type: "array", items: { type: "string" }, description: "Layer ids known not to be used" },
                sources: {
                  type: "array",
                  description: "Numbered as cited: sources[n - 1] is citation [n]. The curated list first, then any evidence URL it lacks, titled by the URL",
                  items: { type: "object", properties: { title: { type: "string" }, url: { type: "string", format: "uri" } } },
                },
                prompts: { type: "array", items: { $ref: "#/components/schemas/Prompt" }, description: "Prompts the makers publish, by layer" },
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
            affiliation: { type: "string", description: "Present only when the people behind this site also make the option" },
            url: { type: "string", format: "uri", description: "This option's page on the site" },
            api: { type: "string", format: "uri" },
            summary: { type: ["string", "null"], description: "Only in getLayer" },
            website: { type: ["string", "null"], description: "Only in getLayer: the vendor or project site as host and path, without the scheme, e.g. mem0.ai" },
          },
        },
        Layer: {
          type: "object",
          required: ["id", "name", "band", "options"],
          properties: {
            id: { type: "string", enum: layerIdList },
            name: { type: "string" },
            band: { type: "string", enum: BANDS.map(([b]) => b) },
            ref: { type: "string", description: "Board designator, e.g. U2" },
            description: { type: "string" },
            url: { type: "string", format: "uri" },
            options: { type: "array", items: { $ref: "#/components/schemas/OptionSummary" } },
            prompts: {
              type: "array",
              description: "Only in getLayer: prompts stacks' makers publish for this layer",
              items: { allOf: [{ $ref: "#/components/schemas/Prompt" }, { type: "object", properties: { stack: { type: "string", description: "The stack's slug" } } }] },
            },
          },
        },
        HotList: {
          type: "object",
          required: ["updated", "from", "stacks", "options"],
          properties: {
            updated: { type: "string", format: "date", description: "When the list was last checked" },
            from: { type: "string", format: "date", description: "Start of the window the conversation was measured over" },
            stacks: { type: "array", description: "Agent products, most talked about first", items: { $ref: "#/components/schemas/HotItem" } },
            options: { type: "array", description: "Components from the layers, most talked about first", items: { $ref: "#/components/schemas/HotItem" } },
          },
        },
        HotItem: {
          type: "object",
          required: ["rank", "name", "label", "why", "url", "sources"],
          properties: {
            rank: { type: "integer", description: "Within its row" },
            stack: { type: "string", description: "Slug, in the stacks row" },
            option: { type: "string", description: "layer/id, in the options row" },
            name: { type: "string" },
            label: { type: "string", description: "The stack's kind or the option's layer" },
            why: { type: "string" },
            since: { type: ["string", "null"], format: "date" },
            url: { type: "string", format: "uri", description: "The page on this site" },
            api: { type: "string", format: "uri" },
            sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string", format: "uri" }, date: { type: "string", format: "date" } } } },
          },
        },
        Prompt: {
          type: "object",
          description: "A prompt a stack's makers publish, copied word for word from the source. The text is at `file`.",
          required: ["id", "layer", "kind", "title", "source", "license", "retrieved", "file"],
          properties: {
            id: { type: "string" },
            layer: { type: "string", enum: layerIdList },
            kind: { type: "string", enum: Object.keys(PROMPT_KIND) },
            title: { type: "string" },
            note: { type: ["string", "null"] },
            source: { type: "string", format: "uri", description: "Where the text was copied from: a repository file pinned to a commit, or the vendor's docs" },
            license: { type: "string" },
            retrieved: { type: "string", format: "date" },
            url: { type: "string", format: "uri", description: "The prompt on the stack's page" },
            file: { type: "string", format: "uri", description: "Markdown: a front-matter header, then the prompt verbatim" },
          },
        },
        LayerList: { type: "object", required: ["layers"], properties: { layers: { type: "array", items: { $ref: "#/components/schemas/Layer" } } } },
        Option: {
          type: "object",
          description: "An option with its research: summary, facts as [label, value] pairs, links, goodFor, watchOut, how (patterns), model (models), news, usage and usedBy.",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            affiliation: { type: "string", description: "Present only when the people behind this site also make the option" },
            url: { type: "string", format: "uri", description: "This option's page on the site" },
            website: { type: ["string", "null"], description: "The vendor or project site as host and path, without the scheme, e.g. mem0.ai; links.site has the full URL when recorded" },
            links: { type: "object", additionalProperties: { type: "string", format: "uri" }, description: "site, docs, repo, pricing, changelog, …" },
            summary: { type: "string" },
            facts: { type: "array", items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 } },
            sources: { type: "array", description: "Pages the datasheet was researched from, when recorded", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string", format: "uri" } } } },
            evidence: {
              type: "object",
              description: "Which sources back which entry: keys are a fact label, model.<field> or watchOut.<n> (0-based); values are URLs listed in sources. Entries without a key cite nothing yet",
              additionalProperties: { type: "array", items: { type: "string", format: "uri" } },
            },
            news: { type: ["object", "null"] },
            usage: {
              type: "object",
              description: "How many stacks pick this option: real ones, and example designs written for this site, which are not adoption",
              properties: { stacks: { type: "integer" }, exampleDesigns: { type: "integer" } },
            },
            usedBy: { type: "array", description: "Every stack that picks this option, example designs included (disclosure: example)", items: { $ref: "#/components/schemas/StackSummary" } },
          },
        },
      },
    },
  };
}

// ── Discovery catalogs and the skill ───────────────────────────────────────

const SKILL_MD = () => `---
name: stackprints
description: Look up how AI agents are built and compare components for each layer of an agent stack (models, model gateways, harnesses, sandboxes, browser use, memory, retrieval, triggers, guardrails, payments, observability). Use when choosing infrastructure for an agent, comparing options in one layer, or explaining how a known agent (OpenClaw, Hermes, Pi, Claude Code, Codex, ChatGPT dots, Meta Muse, Manus, Poke…) is put together.
---

# Stackprints

Read-only data about AI agent stacks at ${SITE.url}. No key needed.

## Steps

1. Find things: GET ${abs("/search.json")} (rows of [kind, title, subtitle, href, logo, extra, uses], where uses is a stack's picks as "Layer: Option") or list them: GET ${abs("/api/stacks.json")}, ${abs("/api/layers.json")}.
2. Read a stack: GET ${abs("/api/stacks/{slug}.json")}. Each layer has picks and evidence URLs; cite those when you repeat a claim.
3. Compare a layer: GET ${abs("/api/layers/{layer}.json")}, then ${abs("/api/options/{layer}/{option}.json")} for datasheets, caveats ("watchOut") and recent news.
4. Respect disclosure: a layer listed in notDisclosed is unknown, not absent. Say "not disclosed" rather than guessing. A layer in inUseUndisclosed is present, but its component isn't named; cite its evidence. A pick marked "supported": true is configurable, not the default.
5. Link people to the HTML page (the url field) or its markdown twin: ${MD_RULE}.

## Notes

- Vendor-published benchmark numbers are marked "(vendor-reported)" in facts; keep that label.
- Stacks with disclosure "example" are designs written for this site, not products. Don't cite them as evidence that anyone uses an option; an option's usage field counts them apart.
- Disclosure: ${AFFILIATION}
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
      entry("api:stackprints", `${SITE.name} API`, "application/vnd.oai.openapi+json", abs("/openapi.json"), "Read-only JSON API: stacks with sources, layers, and options with vendor links and news. No key.", {
        tags: ["ai-agents", "agent-stack", "directory", "comparison"],
        capabilities: ["listStacks", "getStack", "listLayers", "getLayer", "getOption"],
        representativeQueries: ["how is OpenClaw built", "which sandboxes exist for AI agents", "compare memory APIs for agents", "what model does ChatGPT dots use"],
      }),
      entry("skill:stackprints", "Stackprints skill", "text/markdown", abs("/.well-known/agent-skills/stackprints/SKILL.md"), "Agent Skill: how to look up stacks and compare components, respecting disclosure."),
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
    frontmatter({ title: "Layers of an AI agent stack", canonical: abs("/layers/"), "last-updated": layersDate() ?? BUILT }) +
      `${h1("Layers", "/layers/")}${layers.map((l) => `- [${l.name}](${abs(mdPath(`/layer/${l.id}/`))}) (${l.ref}, ${l.band}): ${l.description}`).join("\n")}\n`,
  );
  files["/trending.md"] = md(trendingMd());
  files["/about.md"] = md(
    pageMd("About", "/about/", `${ABOUT}\n\n## Reading a stack\n\n${READING}\n\n## Affiliation\n\n${AFFILIATION}`, "What Stackprints is and how it is researched."),
  );
  files["/privacy.md"] = md(pageMd("Privacy", "/privacy/", PRIVACY, "What Stackprints does and doesn't collect."));
  files["/contact.md"] = md(pageMd("Contact", "/contact/", CONTACT, "How to reach the maintainers."));
  files["/api.md"] = md(apiMd());
  files["/contribute.md"] = md(contributeMd());
  files["/pricing.md"] = md(
    frontmatter({ title: "Pricing", description: "Stackprints is free.", canonical: abs("/pricing.md") }) +
      PRICING_MD.replace("{api}", abs("/api/")),
  );
  files["/404.md"] = md(frontmatter({ title: "Not found" }) + `# Not found\n\nThat page doesn't exist on ${SITE.name}. Start from ${abs("/llms.txt")}, the sitemap at ${abs("/sitemap.xml")}, or search at ${abs("/search.json")}.\n`);
  for (const s of stacks) files[mdPath(`/stack/${s.slug}/`)] = md(stackMd(s));
  for (const s of stacks)
    for (const p of getPrompts(s.slug))
      files[promptFile(s.slug, p.id)] = md(
        frontmatter({
          title: `${s.name}: ${p.title}`,
          stack: s.slug,
          layer: p.layer,
          kind: p.kind,
          source: p.source,
          license: p.license,
          retrieved: p.retrieved,
          canonical: abs(promptHref(s.slug, p.id)),
        }) + `${p.text}\n`,
      );
  for (const k of new Set(stacks.map((s) => s.kind))) files[mdPath(kindHref(k))] = md(kindMd(k));
  for (const l of layers) {
    files[mdPath(`/layer/${l.id}/`)] = md(layerMd(l));
    for (const o of l.options) files[mdPath(optionHref(l.id, o.id))] = md(optionMd(l, o));
  }

  // llms.txt family
  files["/llms-full.txt"] = txt(llmsFull());
  for (const l of layers)
    files[`/layer/${l.id}/llms-full.txt`] = txt(`# ${SITE.name}: ${l.name} in full\n\n> The ${l.name} layer and the datasheet of every option in it.\n\n${layerFull(l)}`);
  files["/stack/llms.txt"] = txt(stacksLlms());
  files["/layer/llms.txt"] = txt(layersLlms());

  // JSON API
  files["/api/stacks.json"] = json({ stacks: stacks.map(stackSummary) });
  const hot = getHot();
  if (hot) {
    const items = (key: "stack" | "option", cards: HotCard[]) =>
      cards.map((c, i) => ({
        rank: i + 1,
        [key]: c.id,
        name: c.name,
        label: c.label,
        why: c.item.why,
        since: c.item.since ?? null,
        url: abs(c.href),
        api: abs(key === "stack" ? `/api/stacks/${c.id}.json` : `/api/options/${c.id}.json`),
        sources: c.item.sources,
      }));
    files["/api/hot.json"] = json({ updated: hot.updated, from: hot.from, stacks: items("stack", hot.stacks), options: items("option", hot.options) });
  }
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
  // The catalogs name the host as did:web:<host>; this is the document that DID resolves to.
  files["/.well-known/did.json"] = json({ "@context": ["https://www.w3.org/ns/did/v1"], id: `did:web:${host}` });
  files["/.well-known/api-catalog"] = { ...json(apiCatalog()), type: 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"' };
  const skill = SKILL_MD();
  files["/.well-known/agent-skills/stackprints/SKILL.md"] = md(skill);
  files["/.well-known/agent-skills/index.json"] = json({
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "stackprints",
        type: "skill-md",
        description: skill.match(/^description: (.*)$/m)![1],
        url: "/.well-known/agent-skills/stackprints/SKILL.md",
        digest: `sha256:${crypto.createHash("sha256").update(skill).digest("hex")}`,
      },
    ],
  });
  return files;
}

export { llmsTxt };
