// Lists options whose news is missing or oldest, so a refresh run knows where to start.
// Usage: node scripts/news-stale.mjs [--days 7] [--limit 60] [--json]
import fs from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const days = Number(arg("days", 7));
const limit = Number(arg("limit", 60));
const today = new Date();

const layers = JSON.parse(fs.readFileSync("content/layers.json", "utf8"));
const rows = [];
for (const l of layers) {
  const dir = `content/options/${l.id}`;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const o = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
    if (o.profile === "pattern") continue;
    const newsPath = `content/news/${l.id}/${o.id}.json`;
    const updated = fs.existsSync(newsPath) ? JSON.parse(fs.readFileSync(newsPath, "utf8")).updated : null;
    const age = updated ? Math.floor((today - new Date(updated)) / 864e5) : Infinity;
    if (age >= days) rows.push({ layer: l.id, id: o.id, name: o.name, url: o.url ?? null, updated, age });
  }
}
rows.sort((a, b) => b.age - a.age || a.layer.localeCompare(b.layer));
const out = rows.slice(0, limit);

if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${rows.length} options need news (older than ${days} days or never checked); showing ${out.length}`);
  for (const r of out) console.log(`${r.layer}/${r.id}\t${r.updated ?? "never"}\t${r.name}`);
}
