// Validates content/: layers, one file per option, stacks, logos, news, prompts, the hot list.
// Run with `npm run check`. The checks themselves are in lib/validate.mjs, shared with the MCP servers.
import fs from "node:fs";
import path from "node:path";
import { validateContent } from "../lib/validate.mjs";

const files = new Map();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(json|svg|md)$/.test(e.name)) files.set(p, fs.readFileSync(p, "utf8"));
  }
};
walk("content");

const { errors, warnings, counts: c } = validateContent(files);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (warnings.length) console.warn(warnings.join("\n"));
console.log(`ok: ${c.layers} layers, ${c.options} options, ${c.news} news files, ${c.stacks} stacks, ${c.prompts} prompts, ${c.hot} hot`);
