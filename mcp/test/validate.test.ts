import { describe, expect, it } from "vitest";
import { bareUrl, httpsUrl, logoProblems, parseLogo, validateContent } from "../../lib/validate.mjs";
import type { Files } from "../src/core/types";
import { repoFiles } from "./helpers";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const svg = (inner: string, root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"') => `<svg ${root}>${inner}</svg>`;
const GOOD = svg('<path fill="currentColor" d="M0 0h24v24H0z"/>');

/** The repository's content with some files changed or added. */
function withFiles(changes: Record<string, string>): Files {
  const files = repoFiles();
  for (const [p, t] of Object.entries(changes)) files.set(p, t);
  return files;
}
const json = (files: Files, p: string) => JSON.parse(files.get(p)!);
const errorsFor = (files: Files, prefix: string) => validateContent(files, { now: NOW }).errors.filter((e) => e.startsWith(prefix));

describe("validateContent on this repository", () => {
  it("passes, and every logo parses into a tree the sprite can be built from", () => {
    const files = repoFiles();
    expect(validateContent(files, { now: NOW }).errors).toEqual([]);
    const logos = [...files].filter(([p]) => p.startsWith("content/logos/"));
    expect(logos.length).toBeGreaterThan(90);
    for (const [p, text] of logos) expect([p, parseLogo(text).problems, parseLogo(text).root?.name]).toEqual([p, [], "svg"]);
  });
});

describe("logos", () => {
  it("accepts plain shapes in currentColor, an XML declaration and in-file references", () => {
    expect(logoProblems(GOOD)).toEqual([]);
    expect(logoProblems(`<?xml version="1.0" encoding="UTF-8"?>\n${svg("<title>A &amp; B</title><path d=\"M0 0\"/>")}`)).toEqual([]);
    expect(
      logoProblems(
        svg(
          '<defs><clipPath id="a"><rect width="24" height="24" rx="4"/></clipPath></defs><g clip-path="url(#a)" opacity=".4"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><use xlink:href="#b"/><polygon id="b" points="0,0 1,1 2,0" transform="rotate(60) translate(1 2)"/></g>',
          'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1em" height="1em" fill="currentColor" fill-rule="evenodd" style="flex:none;line-height:1" viewBox="0 0 24 24"',
        ),
      ),
    ).toEqual([]);
  });

  it("refuses scripts however they are spelled", () => {
    expect(logoProblems(svg("<script>alert(1)</script>"))).toEqual([expect.stringMatching(/^<script> is not allowed/)]);
    expect(logoProblems(svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(document.domain)</x:script>'))).toEqual(
      expect.arrayContaining(["<x:script>: namespaced elements are not allowed", expect.stringMatching(/^<x:script> xmlns:x: namespaced attributes are not allowed/)]),
    );
    expect(logoProblems(svg("<svg:script>alert(1)</svg:script>"))).toEqual(["<svg:script>: namespaced elements are not allowed"]);
    expect(logoProblems(svg('<path onload="alert(1)" d="M0 0"/>'))).toEqual(["<path> onload: event handlers are not allowed"]);
    expect(logoProblems('<svg/onload=alert(1)>')).toEqual([expect.stringMatching(/^malformed tag/)]);
    expect(logoProblems(svg('<set attributeName="href" to="javascript:alert(1)"/>'))).toEqual(expect.arrayContaining([expect.stringMatching(/^<set> is not allowed/)]));
    expect(logoProblems(svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^<foreignObject> is not allowed/)]),
    );
  });

  it("refuses stylesheets and classes, which would restyle the other logos in the sprite", () => {
    expect(logoProblems(svg('<style>.cls-1{fill:none;stroke:currentColor}</style><path class="cls-1" d="M0 0"/>'))).toEqual([
      expect.stringMatching(/^<style> is not allowed/),
      expect.stringMatching(/^<path> class is not allowed/),
    ]);
    expect(logoProblems(svg("<style><![CDATA[.a{}]]></style>"))).toEqual(expect.arrayContaining(["no CDATA sections"]));
  });

  it("refuses links and url() that leave the file", () => {
    expect(logoProblems(svg('<use href="https://evil.example/x.svg#a"/>'))).toEqual(['<use> href="https://evil.example/x.svg#a": only links inside the file (#id) are allowed']);
    expect(logoProblems(svg('<a href="https://evil.example"><path d="M0 0"/></a>'))).toEqual(
      expect.arrayContaining(["<a> href: links are only allowed on <use>, as #id"]),
    );
    expect(logoProblems(svg('<use xlink:href="#a"/><path id="a" d="M0 0"/>'))).toEqual([expect.stringMatching(/xlink:href needs xmlns:xlink/)]);
    expect(logoProblems(svg('<path style="fill:url(https://evil.example/p.svg)" d="M0 0"/>'))).toEqual(["<path> style: url() may only point inside the file, as url(#id)"]);
    expect(logoProblems(svg('<path style="fill:u\\72l(//evil.example)" d="M0 0"/>'))).toEqual([expect.stringMatching(/no CSS escapes/)]);
    expect(logoProblems(svg('<path style="background:url(#a)" d="M0 0"/>'))).toEqual(
      expect.arrayContaining(["<path> style: background is not allowed", "#a points at no element in the file"]),
    );
    expect(logoProblems(svg('<path clip-path="url(https://evil.example/#a)" d="M0 0"/>'))).toEqual([expect.stringMatching(/clip-path=.*url\(#id\)/)]);
    expect(logoProblems(svg('<path xml:base="https://evil.example/" d="M0 0"/>'))).toEqual([expect.stringMatching(/xml:base: namespaced attributes/)]);
  });

  it("refuses DOCTYPEs, entities, comments and processing instructions", () => {
    expect(logoProblems(`<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>${GOOD}`)).toEqual(["no DOCTYPE or entity declarations"]);
    expect(logoProblems(svg('<path d="M0 0&x;"/>'))).toEqual(["<path> d: no entities or & in attribute values"]);
    expect(logoProblems(svg("<title>&x;</title>"))).toEqual([expect.stringMatching(/<title> may only use/)]);
    expect(logoProblems(svg('<!-- --><path d="M0 0"/>'))).toEqual(["no comments (run svgo)"]);
    expect(logoProblems(svg('<?xml-stylesheet href="https://evil.example/x.css"?>'))).toEqual([expect.stringMatching(/^no processing instructions/)]);
  });

  it("keeps the root to what the sprite carries: a double-quoted viewBox, no stroke", () => {
    expect(logoProblems(`<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 512 512'><path d="M0 0"/></svg>`)).toEqual(["<svg> viewBox must be in double quotes"]);
    expect(logoProblems(svg('<path d="M0 0"/>', 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"'))).toEqual([
      expect.stringMatching(/^<svg> stroke is not allowed on the root/),
      expect.stringMatching(/^<svg> stroke-width is not allowed on the root/),
    ]);
    expect(logoProblems(svg('<path d="M0 0"/>', 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="fill:none;stroke:currentColor"'))).toEqual([
      "<svg> style: stroke is not allowed on the root <svg>",
    ]);
    expect(logoProblems('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toEqual(["needs a viewBox on the <svg> element"]);
    expect(logoProblems(svg("", 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24"'))).toEqual([expect.stringMatching(/viewBox="0 0 24": four numbers/)]);
    expect(logoProblems(svg('<path d="M0 0"/>', 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"'))).toEqual([
      '<svg> fill="#000": logos are one colour that follows the theme: use currentColor or none',
    ]);
  });

  it("allows one colour only: currentColor, none or nothing", () => {
    expect(logoProblems(svg('<path fill="#000" stroke="red" style="fill: blue" d="M0 0"/>'))).toEqual([
      '<path> fill="#000": logos are one colour that follows the theme: use currentColor or none',
      '<path> stroke="red": logos are one colour that follows the theme: use currentColor or none',
      "<path> style fill: blue: logos are one colour that follows the theme: use currentColor or none",
    ]);
    expect(logoProblems(svg('<path style="color:red" d="M0 0"/>'))).toEqual(["<path> style: color is not allowed"]);
  });

  it("refuses a file that isn't one well-formed <svg>", () => {
    expect(logoProblems(`${GOOD}${GOOD}`)).toEqual(["only one <svg> element, with nothing after it"]);
    expect(logoProblems('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g>')).toEqual(["<g> is never closed"]);
    expect(logoProblems("<html><svg/></html>")).toEqual(["must be a single <svg> element"]);
    expect(logoProblems(svg("<svg/>"))).toEqual(["<svg> only as the root element"]);
    expect(logoProblems(svg('<path d="M0 0" d="M1 1"/>'))).toEqual(["<path> has d twice"]);
    expect(logoProblems(svg('<path id="a" d="M0 0"/><path id="a" d="M1 1"/>'))).toEqual(['id "a" is used twice']);
  });

  it("is quick on hostile input, and refuses big files", () => {
    const start = performance.now();
    logoProblems(svg(`<path transform="translate(${"1".repeat(5000)}x)" d="M0 0"/>`));
    logoProblems(svg("<g>".repeat(30000)));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(logoProblems(GOOD.replace("</svg>", `<path d="${"M0 0".repeat(2100)}"/></svg>`))).toEqual([expect.stringMatching(/^\d+ bytes; keep logos under 8000/)]);
  });

  it("fails npm run check for a bad logo in content/logos", () => {
    const files = withFiles({ "content/logos/evil.svg": svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>') });
    expect(errorsFor(files, "content/logos/evil.svg")).toContain("content/logos/evil.svg: <x:script>: namespaced elements are not allowed");
  });
});

describe("URLs", () => {
  it("httpsUrl wants https, a dotted host and no credentials", () => {
    for (const ok of ["https://example.com", "https://example.com/a?b=c#d", "https://sub.example.co.uk/x"]) expect([ok, httpsUrl(ok)]).toEqual([ok, true]);
    for (const bad of ["http://example.com", "javascript:alert(document.domain)", "data:text/html,x", "https://vendor.com@evil.example/login", "https://user:pw@example.com", "https://localhost/", "https://example.com/a b", "", 42, null])
      expect([bad, httpsUrl(bad)]).toEqual([bad, false]);
  });

  it("bareUrl wants a host and a plain path", () => {
    for (const ok of ["e2b.dev", "github.com/NousResearch/hermes-agent", "developers.cloudflare.com/agents/harnesses/think", "huggingface.co/collections/Qwen/qwen3-embedding"])
      expect([ok, bareUrl(ok)]).toEqual([ok, true]);
    for (const bad of ["https://e2b.dev", "e2b.dev@evil.example/login", "e2b.dev:8080", "/e2b.dev", "//evil.example", "e2b dev", "e2b.dev/a b", "localhost", "e2b.dev/x)[a](//evil.example", "e2b.dev?x=1", "e2b.dev\\@evil.example", ""])
      expect([bad, bareUrl(bad)]).toEqual([bad, false]);
  });

  it("checks a stack's author.url", () => {
    const base = repoFiles();
    const pi = json(base, "content/stacks/pi.json");
    const check = (url: unknown) => errorsFor(withFiles({ "content/stacks/pi.json": JSON.stringify({ ...pi, author: { name: "Mario", url } }) }), "pi.json");
    expect(check("https://mariozechner.at")).toEqual([]);
    for (const bad of ["javascript:alert(document.domain)", "http://mariozechner.at", "https://mariozechner.at@evil.example"]) expect(check(bad)).toEqual(["pi.json: author.url must be an https URL"]);
  });

  it("checks an option's url", () => {
    const base = repoFiles();
    const at = "content/options/sandbox/e2b.json";
    const e2b = json(base, at);
    const check = (url: string) => errorsFor(withFiles({ [at]: JSON.stringify({ ...e2b, url }) }), at);
    expect(check("e2b.dev/docs")).toEqual([]);
    for (const bad of ["e2b.dev@evil.example/login", "https://e2b.dev", "e2b.dev:443", " e2b.dev"]) expect(check(bad)).toEqual([expect.stringMatching(/^content\/options\/sandbox\/e2b\.json: url is a bare host/)]);
  });
});

describe("files that can't be read", () => {
  it("reports an invalid stack file as an error, and still checks everything else", () => {
    const files = withFiles({
      "content/stacks/zzz-broken.json": "{ not json",
      "content/logos/evil.svg": svg("<script>alert(1)</script>"),
    });
    const { errors, counts } = validateContent(files, { now: NOW });
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/^content\/stacks\/zzz-broken\.json: invalid JSON/), expect.stringMatching(/^content\/logos\/evil\.svg: <script> is not allowed/)]));
    expect(counts.stacks).toBe(validateContent(repoFiles(), { now: NOW }).counts.stacks);
  });

  it("reports files that aren't objects, or whose fields have the wrong shapes, instead of throwing", () => {
    const files = withFiles({
      "content/stacks/zzz-array.json": "[]",
      "content/stacks/zzz-shape.json": JSON.stringify({ slug: "zzz-shape", name: 5, kind: "agent", tagline: "t", description: "d", notUsed: 5 }),
      "content/options/sandbox/zzz-null.json": "null",
      "content/options/sandbox/zzz-shape.json": JSON.stringify({ id: "zzz-shape", name: "Z", sources: 5 }),
      "content/news/sandbox/e2b.json": JSON.stringify({ updated: "2026-10-21", items: [null] }),
      "content/hot.json": JSON.stringify({ updated: "2026-10-21", from: "2026-10-14", stacks: [null] }),
    });
    let result: ReturnType<typeof validateContent> | undefined;
    expect(() => (result = validateContent(files, { now: NOW }))).not.toThrow();
    expect(result!.errors).toEqual(
      expect.arrayContaining([
        "content/stacks/zzz-array.json: must be a JSON object",
        expect.stringMatching(/^content\/stacks\/zzz-shape\.json: could not be checked/),
        "content/options/sandbox/zzz-null.json: must be a JSON object",
        expect.stringMatching(/^content\/options\/sandbox\/zzz-shape\.json: could not be checked/),
        "content/news/sandbox/e2b.json: each item needs date (YYYY-MM-DD), title, https url, source",
        expect.stringMatching(/^content\/hot\.json: could not be checked/),
      ]),
    );
  });
});

describe("news", () => {
  it("warns about items from more than 12 months before updated, without failing", () => {
    const at = "content/news/sandbox/e2b.json";
    const n = json(repoFiles(), at);
    const old = { ...n.items[0], date: "2025-09-01", title: "An old story", url: "https://e2b.dev/blog/old" };
    const { errors, warnings } = validateContent(withFiles({ [at]: JSON.stringify({ ...n, items: [n.items[0], old] }) }), { now: NOW });
    expect(errors.filter((e) => e.startsWith(at))).toEqual([]);
    expect(warnings).toContain(`${at}: 1 item from more than 12 months before updated (2025-09-01); news covers the last 12 months`);
  });
});
