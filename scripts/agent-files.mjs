// After `next build`: write the agent-facing files (markdown twins, llms.txt set, JSON API,
// OpenAPI, discovery catalogs, skill) from out/agent-files.json into out/, then remove it.
import fs from "node:fs";
import path from "node:path";

const src = "out/agent-files.json";
const files = JSON.parse(fs.readFileSync(src, "utf8"));
for (const [p, { body }] of Object.entries(files)) {
  const dest = path.join("out", p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
}
fs.rmSync(src);
// Content types, content negotiation and Link headers come from vercel.json, not from these files.
console.log(`agent files: ${Object.keys(files).length}`);
