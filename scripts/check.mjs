// Validates content/: unique ids, known bands, and every stack pick points at a real option.
import fs from "node:fs";

const layers = JSON.parse(fs.readFileSync("content/layers.json", "utf8"));
const bands = new Set(["surface", "brain", "hands", "files", "ops"]);
const errors = [];
const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const index = new Map();

for (const l of layers) {
  if (index.has(l.id)) errors.push(`duplicate layer id: ${l.id}`);
  if (!bands.has(l.band)) errors.push(`${l.id}: unknown band "${l.band}"`);
  if (!l.name || !l.description) errors.push(`${l.id}: needs name and description`);
  const ids = new Set();
  for (const o of l.options) {
    if (!kebab.test(o.id)) errors.push(`${l.id}/${o.id}: id must be kebab-case`);
    if (ids.has(o.id)) errors.push(`${l.id}: duplicate option ${o.id}`);
    if (o.url && /^https?:/.test(o.url)) errors.push(`${l.id}/${o.id}: url without protocol please`);
    ids.add(o.id);
  }
  index.set(l.id, ids);
}

const slugs = new Set();
for (const f of fs.readdirSync("content/stacks").filter((f) => f.endsWith(".json"))) {
  const s = JSON.parse(fs.readFileSync(`content/stacks/${f}`, "utf8"));
  if (`${s.slug}.json` !== f) errors.push(`${f}: slug must match filename`);
  if (slugs.has(s.slug)) errors.push(`${f}: duplicate slug`);
  slugs.add(s.slug);
  for (const k of ["name", "kind", "tagline", "description"]) if (!s[k]) errors.push(`${f}: missing ${k}`);
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
console.log(`ok: ${layers.length} layers, ${slugs.size} stacks`);
