// Validates content/: layers, one file per option, stacks, logos. Run with `npm run check`.
import fs from "node:fs";

const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const jsonFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")) : []);
const layers = json("content/layers.json");
const bands = new Set(["surface", "brain", "hands", "files", "ops"]);
const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const errors = [];
const index = new Map();

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
    if (o.facts && !(Array.isArray(o.facts) && o.facts.every((f) => Array.isArray(f) && f.length === 2 && f.every((x) => typeof x === "string"))))
      errors.push(`${at}: facts must be [label, value] string pairs`);
    for (const [k, v] of Object.entries(o.links ?? {})) if (!/^https:\/\//.test(v)) errors.push(`${at}: links.${k} must be an https URL`);
    for (const k of ["goodFor", "watchOut", "how"]) if (o[k] && (!Array.isArray(o[k]) || o[k].length > 5)) errors.push(`${at}: ${k} must be a short list`);
    if (o.researched && !/^\d{4}-\d{2}-\d{2}$/.test(o.researched)) errors.push(`${at}: researched must be YYYY-MM-DD`);
    index.get(l.id).add(o.id);
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
  if (`${s.slug}.json` !== f) errors.push(`${f}: slug must match filename`);
  if (slugs.has(s.slug)) errors.push(`${f}: duplicate slug`);
  slugs.add(s.slug);
  for (const k of ["name", "kind", "tagline", "description"]) if (!s[k]) errors.push(`${f}: missing ${k}`);
  if (s.author && !s.author.name) errors.push(`${f}: author needs a name`);
  for (const [k, v] of Object.entries(s.links ?? {}))
    if (!["site", "repo", "docs", "announcement"].includes(k) || !/^https:\/\//.test(v)) errors.push(`${f}: links.${k} must be site/repo/docs/announcement with an https URL`);
  for (const [layer, v] of Object.entries(s.layers ?? {})) {
    const opts = index.get(layer);
    if (!opts) errors.push(`${f}: unknown layer "${layer}"`);
    else for (const id of [v].flat()) if (!opts.has(id)) errors.push(`${f}: unknown option ${layer}/${id}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ok: ${layers.length} layers, ${options} options, ${news} news files, ${slugs.size} stacks`);
