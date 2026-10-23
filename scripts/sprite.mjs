// Builds public/logos.svg: one cached sprite of every mark in content/logos, used via <use href="/logos.svg#name">.
// Each symbol is rebuilt from the validator's parse (lib/validate.mjs), never pasted as text, so the
// sprite holds only what the logo rules allow and renders each logo as its own file would.
import fs from "node:fs";
import { parseLogo } from "../lib/validate.mjs";

const dir = "content/logos";
const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Root attributes the symbol keeps on a <g>; viewBox goes on the symbol, the rest only size the file.
const CARRIED = new Set(["fill", "fill-rule", "clip-rule"]);
// Root style that only lays out the file as an <img> or inline icon, not its shapes.
const LAYOUT = /^\s*(flex|line-height|vertical-align)\s*:/i;

/** One element, ids made unique to the logo: the sprite is one document, so two logos' "a" would collide. */
function element(node, name) {
  if (node.name === "title") return "";
  // A dot can't occur in a logo's name ([a-z0-9-]), so "a" + "b-c" and "a-b" + "c" stay apart.
  const own = (id) => `${name}.${id}`;
  const attrs = node.attrs
    .filter(([k]) => k !== "xmlns" && k !== "xmlns:xlink")
    // One href per element, whichever spelling the file used.
    .filter(([k], _, all) => k !== "xlink:href" || !all.some(([a]) => a === "href"))
    .map(([k, v]) => {
      if (k === "id") return ` id="${esc(own(v))}"`;
      if (k === "href" || k === "xlink:href") return ` href="#${esc(own(v.slice(1)))}"`;
      return ` ${k}="${esc(v.replace(/url\(\s*#([\w.-]+)\s*\)/g, (_, id) => `url(#${own(id)})`))}"`;
    })
    .join("");
  const inner = node.children.map((c) => element(c, name)).join("");
  return inner ? `<${node.name}${attrs}>${inner}</${node.name}>` : `<${node.name}${attrs}/>`;
}

function symbol(root, name) {
  const attr = (k) => root.attrs.find(([a]) => a === k)?.[1];
  const carried = root.attrs.filter(([k]) => CARRIED.has(k));
  const style = (attr("style") ?? "")
    .split(";")
    .filter((d) => d.trim() && !LAYOUT.test(d))
    .join(";");
  if (style) carried.push(["style", style]);
  const inner = root.children.map((c) => element(c, name)).join("");
  const body = carried.length ? `<g${carried.map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}>${inner}</g>` : inner;
  return `<symbol id="${name}" viewBox="${esc(attr("viewBox") ?? "0 0 24 24")}">${body}</symbol>`;
}

const skipped = [];
const symbols = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".svg"))
  .sort()
  .flatMap((f) => {
    const { problems, root } = parseLogo(fs.readFileSync(`${dir}/${f}`, "utf8"));
    if (!root) {
      skipped.push(`${dir}/${f}: ${problems.join("; ")}`);
      return [];
    }
    return [symbol(root, f.slice(0, -4))];
  });

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/logos.svg", `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>\n`);
if (skipped.length) console.warn(`sprite: left out, fix and run npm run check:\n${skipped.join("\n")}`);
console.log(`sprite: ${symbols.length} logos`);
