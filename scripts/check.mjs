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
    index.get(l.id).add(o.id);
  }
}

for (const f of fs.readdirSync("content/logos").filter((f) => f.endsWith(".svg"))) {
  const svg = fs.readFileSync(`content/logos/${f}`, "utf8");
  if (!/viewBox=/.test(svg)) errors.push(`content/logos/${f}: needs a viewBox`);
  if (/<script|on\w+=|href="(?!#)/i.test(svg)) errors.push(`content/logos/${f}: no scripts, handlers or external refs`);
  if (svg.length > 8000) errors.push(`content/logos/${f}: keep logos under 8 KB (run svgo)`);
}

const slugs = new Set();
for (const f of jsonFiles("content/stacks")) {
  const s = json(`content/stacks/${f}`);
  if (`${s.slug}.json` !== f) errors.push(`${f}: slug must match filename`);
  if (slugs.has(s.slug)) errors.push(`${f}: duplicate slug`);
  slugs.add(s.slug);
  for (const k of ["name", "kind", "tagline", "description"]) if (!s[k]) errors.push(`${f}: missing ${k}`);
  if (s.author && !s.author.name) errors.push(`${f}: author needs a name`);
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
console.log(`ok: ${layers.length} layers, ${options} options, ${slugs.size} stacks`);
