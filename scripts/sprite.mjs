// Builds public/logos.svg: one cached sprite of every mark in content/logos, used via <use href="/logos.svg#name">.
import fs from "node:fs";

const dir = "content/logos";
const symbols = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".svg"))
  .sort()
  .map((f) => {
    const src = fs.readFileSync(`${dir}/${f}`, "utf8");
    const root = src.match(/<svg\b[^>]*>/)?.[0] ?? "";
    const viewBox = root.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 24 24";
    const rule = root.match(/fill-rule="([^"]+)"/)?.[1];
    const inner = src
      .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<title>[\s\S]*?<\/title>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const body = rule ? `<g fill-rule="${rule}">${inner}</g>` : inner;
    return `<symbol id="${f.slice(0, -4)}" viewBox="${viewBox}">${body}</symbol>`;
  });

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/logos.svg", `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>\n`);
console.log(`sprite: ${symbols.length} logos`);
