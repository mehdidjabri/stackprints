#!/usr/bin/env node
// Writes generated/bundle.json for the public Worker: the site's built JSON API (out/api/**/*.json and
// out/search.json) and the content and docs files it was built from, so the Worker answers from the
// same commit as the site. Run `npm run build` at the repo root first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "out");
const TARGET = path.join(ROOT, "mcp/generated/bundle.json");

/** Repo-relative posix paths of the files under a folder that pass `keep`, sorted. */
function walk(dir, keep) {
  const found = [];
  const visit = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) visit(p);
      else if (keep(e.name)) found.push(p);
    }
  };
  visit(dir);
  return found;
}
const rel = (from, abs) => path.relative(from, abs).split(path.sep).join("/");
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

if (!fs.existsSync(path.join(OUT, "api")) || !fs.existsSync(path.join(OUT, "search.json"))) {
  console.error("No built site in out/ (out/api and out/search.json): run npm run build at the repo root first.");
  process.exit(1);
}

const api = {};
for (const abs of walk(path.join(OUT, "api"), (n) => n.endsWith(".json"))) api[`/${rel(OUT, abs)}`] = JSON.parse(fs.readFileSync(abs, "utf8"));
api["/search.json"] = JSON.parse(fs.readFileSync(path.join(OUT, "search.json"), "utf8"));

const files = {};
let newest = 0;
for (const dir of ["content", "docs"]) {
  for (const abs of walk(path.join(ROOT, dir), (n) => /\.(json|md|svg)$/.test(n))) {
    files[rel(ROOT, abs)] = fs.readFileSync(abs, "utf8");
    if (dir === "content") newest = Math.max(newest, fs.statSync(abs).mtimeMs);
  }
}

// The API and the files must describe the same content; an old out/ would make the Worker disagree with itself.
if (newest > fs.statSync(path.join(OUT, "api/layers.json")).mtimeMs)
  console.warn("Warning: content/ changed after out/ was built; run npm run build at the repo root for a matching bundle.");

const text = JSON.stringify({ builtAt: new Date().toISOString(), api, files });
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, text);

const size = (o) => Buffer.byteLength(JSON.stringify(o));
console.log(`api:   ${Object.keys(api).length} paths, ${kb(size(api))}`);
console.log(`files: ${Object.keys(files).length} files, ${kb(size(files))}`);
console.log(`wrote ${rel(ROOT, TARGET)}: ${kb(Buffer.byteLength(text))}`);
