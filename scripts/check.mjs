// Validates content/: layers, one file per option, stacks, logos. Run with `npm run check`.
import fs from "node:fs";

const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const jsonFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")) : []);
const layers = json("content/layers.json");
const bands = new Set(["surface", "brain", "hands", "files", "ops"]);
const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const errors = [];
const warnings = []; // reported, but don't fail the run
const index = new Map();
const usedBy = []; // hand-written "Used by" facts, checked against the stacks' picks
const stacks = [];
const exclusive = new Set(); // "layer/option" ids that mean the layer is absent or minimal

for (const l of layers) {
  if (index.has(l.id)) errors.push(`duplicate layer id: ${l.id}`);
  if (!bands.has(l.band)) errors.push(`${l.id}: unknown band "${l.band}"`);
  if (!l.name || !l.description) errors.push(`${l.id}: needs name and description`);
  if (!/^[A-Z]+\d+$/.test(l.ref ?? "")) errors.push(`${l.id}: needs a board designator like J1, U2, DIMM1`);
  if (layers.filter((x) => x.ref === l.ref).length > 1) errors.push(`${l.id}: designator ${l.ref} is already used`);
  index.set(l.id, new Set());
}
for (const dir of fs.readdirSync("content/options")) {
  if (!index.has(dir)) errors.push(`content/options/${dir}: no such layer in layers.json`);
}

let options = 0;
for (const l of layers) {
  for (const f of jsonFiles(`content/options/${l.id}`)) {
    const at = `content/options/${l.id}/${f}`;
    let o;
    try {
      o = json(at);
    } catch (e) {
      errors.push(`${at}: invalid JSON (${e.message})`);
      continue;
    }
    options++;
    if (`${o.id}.json` !== f) errors.push(`${at}: id must match file name`);
    if (!kebab.test(o.id ?? "")) errors.push(`${at}: id must be kebab-case`);
    if (!o.name) errors.push(`${at}: missing name`);
    if (o.note && o.note.length > 60) errors.push(`${at}: keep note under 60 characters`);
    if (o.url && /^https?:/.test(o.url)) errors.push(`${at}: url without protocol please`);
    if (o.logo && !fs.existsSync(`content/logos/${o.logo}.svg`)) errors.push(`${at}: missing content/logos/${o.logo}.svg`);
    if (o.profile && !["model", "product", "protocol", "pattern"].includes(o.profile)) errors.push(`${at}: unknown profile`);
    if (o.affiliation !== undefined && (typeof o.affiliation !== "string" || !o.affiliation)) errors.push(`${at}: affiliation must be one sentence`);
    if (o.exclusive !== undefined && o.exclusive !== true) errors.push(`${at}: exclusive is true or left out`);
    if (o.exclusive) exclusive.add(`${l.id}/${o.id}`);
    if (o.facts && !(Array.isArray(o.facts) && o.facts.every((f) => Array.isArray(f) && f.length === 2 && f.every((x) => typeof x === "string"))))
      errors.push(`${at}: facts must be [label, value] string pairs`);
    for (const [k, v] of Object.entries(o.links ?? {})) if (!/^https:\/\//.test(v)) errors.push(`${at}: links.${k} must be an https URL`);
    for (const k of ["goodFor", "watchOut", "how"]) if (o[k] && (!Array.isArray(o[k]) || o[k].length > 5)) errors.push(`${at}: ${k} must be a short list`);
    if (o.researched && !/^\d{4}-\d{2}-\d{2}$/.test(o.researched)) errors.push(`${at}: researched must be YYYY-MM-DD`);
    // Datasheet citations: each key names an entry on the page, each URL is one of the option's sources.
    for (const src of o.sources ?? [])
      if (!src.title || !/^https:\/\//.test(src.url ?? "")) errors.push(`${at}: each source needs a title and an https url`);
    const cited = new Set([
      ...(Array.isArray(o.facts) ? o.facts.map(([k]) => k) : []),
      ...Object.keys(o.model ?? {}).map((k) => `model.${k}`),
      ...(o.watchOut ?? []).map((_, i) => `watchOut.${i}`),
    ]);
    for (const [key, urls] of Object.entries(o.evidence ?? {})) {
      if (!cited.has(key)) errors.push(`${at}: evidence "${key}" is not a fact label, model.<field> or watchOut.<n> on this option`);
      if (!Array.isArray(urls) || !urls.every((u) => o.sources?.some((s) => s.url === u)))
        errors.push(`${at}: evidence.${key} must list URLs from sources`);
    }
    index.get(l.id).add(o.id);
    for (const [k, v] of Array.isArray(o.facts) ? o.facts : []) if (k === "Used by" && typeof v === "string") usedBy.push({ layer: l.id, id: o.id, value: v });
  }
}

for (const f of fs.readdirSync("content/logos").filter((f) => f.endsWith(".svg"))) {
  const svg = fs.readFileSync(`content/logos/${f}`, "utf8");
  if (!/viewBox=/.test(svg)) errors.push(`content/logos/${f}: needs a viewBox`);
  if (/<script|on\w+=|href="(?!#)/i.test(svg)) errors.push(`content/logos/${f}: no scripts, handlers or external refs`);
  if (svg.length > 8000) errors.push(`content/logos/${f}: keep logos under 8 KB (run svgo)`);
}

let news = 0;
for (const l of layers) {
  for (const f of jsonFiles(`content/news/${l.id}`)) {
    const at = `content/news/${l.id}/${f}`;
    let n;
    try {
      n = json(at);
    } catch (e) {
      errors.push(`${at}: invalid JSON (${e.message})`);
      continue;
    }
    news++;
    if (!index.get(l.id).has(f.slice(0, -5))) errors.push(`${at}: no matching option`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.updated ?? "")) errors.push(`${at}: updated must be YYYY-MM-DD`);
    if (!Array.isArray(n.items) || n.items.length > 5) errors.push(`${at}: items must be a list of at most 5`);
    for (const i of n.items ?? [])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date ?? "") || !i.title || !/^https:\/\//.test(i.url ?? "") || !i.source)
        errors.push(`${at}: each item needs date (YYYY-MM-DD), title, https url, source`);
  }
}

const slugs = new Set();
for (const f of jsonFiles("content/stacks")) {
  const s = json(`content/stacks/${f}`);
  stacks.push(s);
  if (`${s.slug}.json` !== f) errors.push(`${f}: slug must match filename`);
  if (slugs.has(s.slug)) errors.push(`${f}: duplicate slug`);
  slugs.add(s.slug);
  for (const k of ["name", "kind", "tagline", "description"]) if (!s[k]) errors.push(`${f}: missing ${k}`);
  if (s.author && !s.author.name) errors.push(`${f}: author needs a name`);
  if (s.logo && !fs.existsSync(`content/logos/${s.logo}.svg`)) errors.push(`${f}: missing content/logos/${s.logo}.svg`);
  for (const [k, v] of Object.entries(s.links ?? {}))
    if (!["site", "repo", "docs", "announcement"].includes(k) || !/^https:\/\//.test(v)) errors.push(`${f}: links.${k} must be site/repo/docs/announcement with an https URL`);
  if (s.disclosure && !["open-source", "documented", "closed", "example"].includes(s.disclosure))
    errors.push(`${f}: disclosure must be open-source, documented, closed or example`);
  for (const src of s.sources ?? [])
    if (!src.title || !/^https:\/\//.test(src.url ?? "")) errors.push(`${f}: each source needs a title and an https url`);
  for (const [layer, urls] of Object.entries(s.evidence ?? {})) {
    if (!(layer in (s.layers ?? {})) && !s.inUseUndisclosed?.includes(layer)) errors.push(`${f}: evidence for "${layer}" but the stack doesn't pick it`);
    if (!Array.isArray(urls) || !urls.every((u) => /^https:\/\//.test(u))) errors.push(`${f}: evidence.${layer} must be a list of https URLs`);
  }
  for (const layer of s.notUsed ?? []) {
    if (!index.has(layer)) errors.push(`${f}: notUsed has unknown layer "${layer}"`);
    if (layer in (s.layers ?? {})) errors.push(`${f}: "${layer}" is both picked and notUsed`);
  }
  // In use, not disclosed: a presence claim, so it needs a source like any pick.
  for (const layer of s.inUseUndisclosed ?? []) {
    if (!index.has(layer)) errors.push(`${f}: inUseUndisclosed has unknown layer "${layer}"`);
    if (layer in (s.layers ?? {})) errors.push(`${f}: "${layer}" is both picked and inUseUndisclosed`);
    if (s.notUsed?.includes(layer)) errors.push(`${f}: "${layer}" is both notUsed and inUseUndisclosed`);
    if (!s.evidence?.[layer]?.length) errors.push(`${f}: inUseUndisclosed "${layer}" needs an evidence URL`);
  }
  // Open core: the layers only an open-source stack's closed parts could fill.
  if (s.closedLayers && s.disclosure !== "open-source") errors.push(`${f}: closedLayers only applies to open-source stacks`);
  for (const layer of s.closedLayers ?? []) {
    if (!index.has(layer)) errors.push(`${f}: closedLayers has unknown layer "${layer}"`);
    if (s.notUsed?.includes(layer)) errors.push(`${f}: "${layer}" is both closedLayers and notUsed`);
  }
  // Supported picks are a subset of the layer's picks.
  for (const [layer, ids] of Object.entries(s.supports ?? {})) {
    const picked = [s.layers?.[layer] ?? []].flat();
    if (!Array.isArray(ids) || !ids.every((id) => picked.includes(id))) errors.push(`${f}: supports.${layer} must list ids the stack picks in ${layer}`);
  }
  // Any model, Any provider and Any host stand alone, or next to a default as a supported pick.
  for (const [layer, v] of Object.entries(s.layers ?? {})) {
    const picks = [v].flat();
    for (const id of picks)
      if (/^any-/.test(id) && picks.length > 1 && !s.supports?.[layer]?.includes(id))
        errors.push(`${f}: ${layer}/${id} next to other picks must be listed in supports.${layer}`);
  }
  // "None", "Single agent" and the like stand alone in their layer, as the editor enforces.
  for (const [layer, v] of Object.entries(s.layers ?? {})) {
    const picks = [v].flat();
    for (const id of picks) if (exclusive.has(`${layer}/${id}`) && picks.length > 1) errors.push(`${f}: ${layer}/${id} is exclusive: it stands alone in its layer`);
  }
  if (s.researched && !/^\d{4}-\d{2}-\d{2}$/.test(s.researched)) errors.push(`${f}: researched must be YYYY-MM-DD`);
  if (s.version !== undefined && (typeof s.version !== "string" || !s.version)) errors.push(`${f}: version is a release name like "2026.10.10" or left out`);
  if (s.version && s.disclosure === "example") errors.push(`${f}: an example design has no release, so no version`);
  for (const [layer, v] of Object.entries(s.layers ?? {})) {
    const opts = index.get(layer);
    if (!opts) errors.push(`${f}: unknown layer "${layer}"`);
    else for (const id of [v].flat()) if (!opts.has(id)) errors.push(`${f}: unknown option ${layer}/${id}`);
  }
  // On an example an empty slot means "not used", which is false for these core layers.
  if (s.disclosure === "example")
    for (const layer of ["harness", "model", "persona", "mcp"])
      if (!(layer in (s.layers ?? {}))) warnings.push(`${f}: example leaves ${layer} empty, which reads as 'not used'`);
}

// A "Used by" fact must not name a catalog stack that doesn't pick the option, or it contradicts
// the computed "Stacks using X" list. Match full stack names only, case-sensitive, and not as the
// tail of a longer name ("Raspberry Pi"), so "1Password for Claude" or "Gemini CLI" don't count.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const s of stacks) {
  if (!s.name) continue;
  const re = new RegExp(`(?<![\\w-]|[A-Z][\\w-]* )${escapeRe(s.name)}(?![\\w-])`);
  for (const { layer, id, value } of usedBy)
    if (re.test(value) && ![s.layers?.[layer] ?? []].flat().includes(id))
      errors.push(`${layer}/${id}: 'Used by' names ${s.name} but that stack does not pick it`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (warnings.length) console.warn(warnings.join("\n"));
console.log(`ok: ${layers.length} layers, ${options} options, ${news} news files, ${slugs.size} stacks`);
