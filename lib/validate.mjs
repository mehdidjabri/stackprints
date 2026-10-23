// Validates the content of Stackprints from a map of files, with no filesystem access, so the same
// checks run in `npm run check` (scripts/check.mjs), in CI and in the MCP servers before anything is written.
// The logo parser below is also what scripts/sprite.mjs builds the sprite from.

/**
 * @param {Map<string, string>} files repo-relative path ("content/layers.json") to text
 * @param {{ now?: number }} [options] the time staleness warnings are measured against
 * @returns {{ errors: string[], warnings: string[], counts: { layers: number, options: number, news: number, stacks: number, prompts: number, hot: number } }}
 */
export function validateContent(files, { now = Date.now() } = {}) {
  const read = (p) => {
    const t = files.get(p);
    if (t === undefined) throw new Error(`${p}: missing`);
    return t;
  };
  const json = (p) => JSON.parse(read(p));
  // A path exists as a file, or as a folder some file sits under.
  const exists = (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`));
  // The names directly inside a folder, files and folders alike, sorted like a directory listing.
  const readdir = (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1).split("/")[0]))].sort();
  const jsonFiles = (d) => (exists(d) ? readdir(d).filter((f) => f.endsWith(".json")) : []);
  const errors = [];
  const warnings = []; // reported, but don't fail the run
  // A file that isn't a JSON object is an error in that file, as is one whose fields have shapes the
  // checks can't read: the run goes on, so one broken file never hides the rest.
  const parsed = (at) => {
    let v;
    try {
      v = json(at);
    } catch (e) {
      errors.push(`${at}: invalid JSON (${e.message})`);
      return null;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      errors.push(`${at}: must be a JSON object`);
      return null;
    }
    return v;
  };
  const guarded = (at, check) => {
    try {
      check();
    } catch (e) {
      errors.push(`${at}: could not be checked (${e.message})`);
    }
  };
  const layers = json("content/layers.json");
  const bands = new Set(["surface", "brain", "hands", "files", "ops"]);
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const index = new Map();
  const usedBy = []; // hand-written "Used by" facts, checked against the stacks' picks
  const stacks = [];
  const exclusive = new Set(); // "layer/option" ids that mean the layer is absent or minimal

  for (const l of layers) {
    if (index.has(l.id)) errors.push(`duplicate layer id: ${l.id}`);
    if (!bands.has(l.band)) errors.push(`${l.id}: unknown band "${l.band}"`);
    if (!l.name || !l.description) errors.push(`${l.id}: needs name and description`);
    if (!/^[A-Z]+\d+$/.test(l.ref ?? "")) errors.push(`${l.id}: needs a board designator like J1, U2, DIMM1`);
    if (layers.filter((x) => x.ref === l.ref).length > 1) errors.push(`${l.id}: designator ${l.ref} is already used`);
    index.set(l.id, new Set());
  }
  for (const dir of readdir("content/options")) {
    if (!index.has(dir)) errors.push(`content/options/${dir}: no such layer in layers.json`);
  }

  let options = 0;
  for (const l of layers) {
    for (const f of jsonFiles(`content/options/${l.id}`)) {
      const at = `content/options/${l.id}/${f}`;
      const o = parsed(at);
      if (!o) continue;
      options++;
      guarded(at, () => {
        if (`${o.id}.json` !== f) errors.push(`${at}: id must match file name`);
        if (!kebab.test(o.id ?? "")) errors.push(`${at}: id must be kebab-case`);
        if (!o.name) errors.push(`${at}: missing name`);
        if (o.note && o.note.length > 60) errors.push(`${at}: keep note under 60 characters`);
        if (o.url !== undefined && !bareUrl(o.url)) errors.push(`${at}: url is a bare host and optional path, like example.com/docs (no scheme, @, :, spaces or leading /)`);
        if (o.logo && !exists(`content/logos/${o.logo}.svg`)) errors.push(`${at}: missing content/logos/${o.logo}.svg`);
        if (o.profile && !["model", "product", "protocol", "pattern"].includes(o.profile)) errors.push(`${at}: unknown profile`);
        if (o.affiliation !== undefined && (typeof o.affiliation !== "string" || !o.affiliation)) errors.push(`${at}: affiliation must be one sentence`);
        if (o.exclusive !== undefined && o.exclusive !== true) errors.push(`${at}: exclusive is true or left out`);
        if (o.exclusive) exclusive.add(`${l.id}/${o.id}`);
        if (o.facts && !(Array.isArray(o.facts) && o.facts.every((f) => Array.isArray(f) && f.length === 2 && f.every((x) => typeof x === "string"))))
          errors.push(`${at}: facts must be [label, value] string pairs`);
        for (const [k, v] of Object.entries(o.links ?? {})) if (!httpsUrl(v)) errors.push(`${at}: links.${k} must be an https URL`);
        for (const k of ["goodFor", "watchOut", "how"]) if (o[k] && (!Array.isArray(o[k]) || o[k].length > 5)) errors.push(`${at}: ${k} must be a short list`);
        if (o.researched && !/^\d{4}-\d{2}-\d{2}$/.test(o.researched)) errors.push(`${at}: researched must be YYYY-MM-DD`);
        // Datasheet citations: each key names an entry on the page, each URL is one of the option's sources.
        for (const src of o.sources ?? [])
          if (!src.title || !httpsUrl(src.url)) errors.push(`${at}: each source needs a title and an https url`);
        const cited = new Set([
          ...(Array.isArray(o.facts) ? o.facts.map(([k]) => k) : []),
          ...Object.keys(o.model ?? {}).map((k) => `model.${k}`),
          ...(o.watchOut ?? []).map((_, i) => `watchOut.${i}`),
        ]);
        for (const [key, urls] of Object.entries(o.evidence ?? {})) {
          if (!cited.has(key)) errors.push(`${at}: evidence "${key}" is not a fact label, model.<field> or watchOut.<n> on this option`);
          if (!Array.isArray(urls) || !urls.every((u) => o.sources?.some((s) => s.url === u)))
            errors.push(`${at}: evidence.${key} must list URLs from sources`);
        }
        index.get(l.id).add(o.id);
        for (const [k, v] of Array.isArray(o.facts) ? o.facts : []) if (k === "Used by" && typeof v === "string") usedBy.push({ layer: l.id, id: o.id, value: v });
      });
    }
  }

  for (const f of readdir("content/logos").filter((f) => f.endsWith(".svg")))
    for (const p of logoProblems(read(`content/logos/${f}`))) errors.push(`content/logos/${f}: ${p}`);

  let news = 0;
  for (const l of layers) {
    for (const f of jsonFiles(`content/news/${l.id}`)) {
      const at = `content/news/${l.id}/${f}`;
      const n = parsed(at);
      if (!n) continue;
      news++;
      guarded(at, () => {
        if (!index.get(l.id).has(f.slice(0, -5))) errors.push(`${at}: no matching option`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(n.updated ?? "")) errors.push(`${at}: updated must be YYYY-MM-DD`);
        // The 5 newest, plus any other story from the 30 days before `updated` (Trending counts them all).
        if (!Array.isArray(n.items)) errors.push(`${at}: items must be a list`);
        else if (n.items.slice(5).some((i) => (new Date(n.updated) - new Date(i.date)) / 864e5 > 30))
          errors.push(`${at}: beyond the 5 newest, keep only items from the 30 days before updated`);
        for (const i of n.items ?? [])
          if (!/^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "") || !i.title || !httpsUrl(i.url) || !i.source)
            errors.push(`${at}: each item needs date (YYYY-MM-DD), title, https url, source`);
        // RESEARCH.md keeps the last 12 months: older items are flagged, not refused, so old files still build.
        const old = Array.isArray(n.items) ? n.items.filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "") && (Date.parse(n.updated) - Date.parse(i.date)) / 864e5 > 365) : [];
        if (old.length) warnings.push(`${at}: ${old.length} item${old.length > 1 ? "s" : ""} from more than 12 months before updated (${old.map((i) => i.date).join(", ")}); news covers the last 12 months`);
      });
    }
  }

  const slugs = new Set();
  for (const f of jsonFiles("content/stacks")) {
    const s = parsed(`content/stacks/${f}`);
    if (!s) continue;
    stacks.push(s);
    guarded(`content/stacks/${f}`, () => {
      if (`${s.slug}.json` !== f) errors.push(`${f}: slug must match filename`);
      if (slugs.has(s.slug)) errors.push(`${f}: duplicate slug`);
      slugs.add(s.slug);
      for (const k of ["name", "kind", "tagline", "description"]) if (!s[k]) errors.push(`${f}: missing ${k}`);
      if (s.author && !s.author.name) errors.push(`${f}: author needs a name`);
      if (s.author?.url !== undefined && !httpsUrl(s.author.url)) errors.push(`${f}: author.url must be an https URL`);
      if (s.logo && !exists(`content/logos/${s.logo}.svg`)) errors.push(`${f}: missing content/logos/${s.logo}.svg`);
      for (const [k, v] of Object.entries(s.links ?? {}))
        if (!["site", "repo", "docs", "announcement"].includes(k) || !httpsUrl(v)) errors.push(`${f}: links.${k} must be site/repo/docs/announcement with an https URL`);
      if (s.disclosure && !["open-source", "documented", "closed", "example"].includes(s.disclosure))
        errors.push(`${f}: disclosure must be open-source, documented, closed or example`);
      for (const src of s.sources ?? [])
        if (!src.title || !httpsUrl(src.url)) errors.push(`${f}: each source needs a title and an https url`);
      for (const [layer, urls] of Object.entries(s.evidence ?? {})) {
        if (!(layer in (s.layers ?? {})) && !s.inUseUndisclosed?.includes(layer)) errors.push(`${f}: evidence for "${layer}" but the stack doesn't pick it`);
        if (!Array.isArray(urls) || !urls.every((u) => httpsUrl(u))) errors.push(`${f}: evidence.${layer} must be a list of https URLs`);
      }
      for (const layer of s.notUsed ?? []) {
        if (!index.has(layer)) errors.push(`${f}: notUsed has unknown layer "${layer}"`);
        if (layer in (s.layers ?? {})) errors.push(`${f}: "${layer}" is both picked and notUsed`);
      }
      // In use, not disclosed: a presence claim, so it needs a source like any pick.
      for (const layer of s.inUseUndisclosed ?? []) {
        if (!index.has(layer)) errors.push(`${f}: inUseUndisclosed has unknown layer "${layer}"`);
        if (layer in (s.layers ?? {})) errors.push(`${f}: "${layer}" is both picked and inUseUndisclosed`);
        if (s.notUsed?.includes(layer)) errors.push(`${f}: "${layer}" is both notUsed and inUseUndisclosed`);
        if (!s.evidence?.[layer]?.length) errors.push(`${f}: inUseUndisclosed "${layer}" needs an evidence URL`);
      }
      // Open core: the layers only an open-source stack's closed parts could fill.
      if (s.closedLayers && s.disclosure !== "open-source") errors.push(`${f}: closedLayers only applies to open-source stacks`);
      for (const layer of s.closedLayers ?? []) {
        if (!index.has(layer)) errors.push(`${f}: closedLayers has unknown layer "${layer}"`);
        if (s.notUsed?.includes(layer)) errors.push(`${f}: "${layer}" is both closedLayers and notUsed`);
      }
      // Supported picks are a subset of the layer's picks.
      for (const [layer, ids] of Object.entries(s.supports ?? {})) {
        const picked = [s.layers?.[layer] ?? []].flat();
        if (!Array.isArray(ids) || !ids.every((id) => picked.includes(id))) errors.push(`${f}: supports.${layer} must list ids the stack picks in ${layer}`);
      }
      // Any model, Any provider and Any host stand alone, or next to a default as a supported pick.
      for (const [layer, v] of Object.entries(s.layers ?? {})) {
        const picks = [v].flat();
        for (const id of picks)
          if (/^any-/.test(id) && picks.length > 1 && !s.supports?.[layer]?.includes(id))
            errors.push(`${f}: ${layer}/${id} next to other picks must be listed in supports.${layer}`);
      }
      // "None", "Single agent" and the like stand alone in their layer, as the editor enforces.
      for (const [layer, v] of Object.entries(s.layers ?? {})) {
        const picks = [v].flat();
        for (const id of picks) if (exclusive.has(`${layer}/${id}`) && picks.length > 1) errors.push(`${f}: ${layer}/${id} is exclusive: it stands alone in its layer`);
      }
      if (s.researched && !/^\d{4}-\d{2}-\d{2}$/.test(s.researched)) errors.push(`${f}: researched must be YYYY-MM-DD`);
      if (s.version !== undefined && (typeof s.version !== "string" || !s.version)) errors.push(`${f}: version is a release name like "2026.10.10" or left out`);
      if (s.version && s.disclosure === "example") errors.push(`${f}: an example design has no release, so no version`);
      for (const [layer, v] of Object.entries(s.layers ?? {})) {
        const opts = index.get(layer);
        if (!opts) errors.push(`${f}: unknown layer "${layer}"`);
        else for (const id of [v].flat()) if (!opts.has(id)) errors.push(`${f}: unknown option ${layer}/${id}`);
      }
      // On an example an empty slot means "not used", which is false for these core layers.
      if (s.disclosure === "example")
        for (const layer of ["harness", "model", "persona", "mcp"])
          if (!(layer in (s.layers ?? {}))) warnings.push(`${f}: example leaves ${layer} empty, which reads as 'not used'`);
    });
  }

  // A "Used by" fact must not name a catalog stack that doesn't pick the option, or it contradicts
  // the computed "Stacks using X" list. Match full stack names only, case-sensitive, and not as the
  // tail of a longer name ("Raspberry Pi"), so "1Password for Claude" or "Gemini CLI" don't count.
  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const s of stacks) {
    if (typeof s.name !== "string" || !s.name) continue;
    const re = new RegExp(`(?<![\\w-]|[A-Z][\\w-]* )${escapeRe(s.name)}(?![\\w-])`);
    for (const { layer, id, value } of usedBy)
      if (re.test(value) && ![s.layers?.[layer] ?? []].flat().includes(id))
        errors.push(`${layer}/${id}: 'Used by' names ${s.name} but that stack does not pick it`);
  }

  // Prompts: content/prompts/<stack>/<id>.md, verbatim prompt text from an official source, with a front-matter header.
  const PROMPT_KINDS = new Set(["system-prompt", "instruction-file", "tool-prompt", "template"]);
  let prompts = 0;
  if (exists("content/prompts")) {
    for (const slug of readdir("content/prompts")) {
      if (slug.startsWith(".")) continue;
      if (!slugs.has(slug)) errors.push(`content/prompts/${slug}: no stack with that slug`);
      for (const f of readdir(`content/prompts/${slug}`).filter((f) => f.endsWith(".md"))) {
        const at = `content/prompts/${slug}/${f}`;
        const raw = read(at);
        const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!m) {
          errors.push(`${at}: needs a --- front-matter header`);
          continue;
        }
        prompts++;
        const fm = Object.fromEntries(m[1].split("\n").map((l) => l.match(/^([a-z]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
        if (!kebab.test(f.slice(0, -3))) errors.push(`${at}: file name must be kebab-case`);
        if (!index.has(fm.layer)) errors.push(`${at}: layer "${fm.layer}" doesn't exist`);
        if (!PROMPT_KINDS.has(fm.kind)) errors.push(`${at}: kind must be one of ${[...PROMPT_KINDS].join(", ")}`);
        if (!fm.title) errors.push(`${at}: needs a title`);
        if (!httpsUrl(fm.source)) errors.push(`${at}: source must be an https URL`);
        if (/github\.com\/[^/]+\/[^/]+\/blob\//.test(fm.source ?? "") && !/\/blob\/[0-9a-f]{40}\//.test(fm.source))
          errors.push(`${at}: GitHub sources must be pinned to a full commit SHA`);
        if (!fm.license) errors.push(`${at}: needs a license (e.g. MIT, Apache-2.0, or "published by <vendor>")`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.retrieved ?? "")) errors.push(`${at}: retrieved must be YYYY-MM-DD`);
        if (!m[2].trim()) errors.push(`${at}: empty prompt text`);
        if (raw.length > 60000) errors.push(`${at}: over 60 KB; keep the relevant part and link the rest`);
      }
    }
  }

  // Hot list: content/hot.json, rewritten by the research agent (docs/HOT.md). Each card links to a page on the site.
  let hot = 0;
  if (exists("content/hot.json")) {
    const at = "content/hot.json";
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const HYPE = /\b(revolutionary|game[- ]chang\w*|insane|mind[- ]blowing|groundbreaking|incredible|unbelievable|crushing|killer)\b/i;
    const h = parsed(at);
    if (h)
      guarded(at, () => {
        if (!day.test(h.updated ?? "") || !day.test(h.from ?? "") || h.from > h.updated) errors.push(`${at}: needs updated and from as YYYY-MM-DD, from first`);
        // Two rows of cards: agent products (stacks), then components from the layers (options).
        const rows = { stacks: h.stacks ?? [], options: h.options ?? [] };
        for (const [row, list] of Object.entries(rows)) if (!Array.isArray(list) || list.length > 6) errors.push(`${at}: ${row} is a list of at most 6`);
        if (!rows.stacks.length && !rows.options.length) errors.push(`${at}: needs at least one stack or option`);
        const seen = new Set();
        const items = [...rows.stacks.map((it, i) => [it, `stacks ${i + 1}`]), ...rows.options.map((it, i) => [it, `options ${i + 1}`])];
        for (const [it, n] of items) {
          const where = `${at} ${n}`;
          hot++;
          if (n.startsWith("stacks") && !slugs.has(it.stack)) errors.push(`${where}: no stack "${it.stack}"`);
          if (n.startsWith("options")) {
            const [layer, id] = (it.option ?? "").split("/");
            if (!index.get(layer)?.has(id)) errors.push(`${where}: no option "${it.option}" (use layer/id)`);
          }
          const key = it.stack ?? it.option;
          if (seen.has(key)) errors.push(`${where}: ${key} is listed twice`);
          seen.add(key);
          if (!it.why || it.why.length > 120) errors.push(`${where}: why is one sentence of at most 120 characters`);
          if (HYPE.test(it.why ?? "")) errors.push(`${where}: say what happened, without hype words`);
          if (it.since && (!day.test(it.since) || it.since > h.updated)) errors.push(`${where}: since must be YYYY-MM-DD, not after updated`);
          const src = Array.isArray(it.sources) ? it.sources : [];
          if (!src.length || src.length > 4) errors.push(`${where}: needs 1 to 4 sources`);
          for (const s of src) {
            if (!httpsUrl(s.url) || !s.title || !day.test(s.date ?? "")) errors.push(`${where}: each source needs title, https url and date`);
            else if (s.date > h.updated) errors.push(`${where}: source dated after updated: ${s.url}`);
          }
          // The list is about this week's conversation: at least one source from inside the window.
          if (src.length && !src.some((s) => s.date >= h.from)) errors.push(`${where}: no source dated inside the window (from ${h.from})`);
        }
        const age = Math.floor((now - Date.parse(h.updated)) / 864e5);
        if (age > 3) warnings.push(`${at}: last updated ${age} days ago; the home page shows it as "hot right now"`);
      });
  }

  return { errors, warnings, counts: { layers: layers.length, options, news, stacks: slugs.size, prompts, hot } };
}

/** An https URL that opens where it says: no credentials (https://vendor.com@evil.example), no spaces, a dotted host. */
export function httpsUrl(v) {
  if (typeof v !== "string" || !/^https:\/\/\S+$/.test(v)) return false;
  let u;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
}

// An option's url is shown as is and linked as https://<url>, so it is a host and a plain path:
// no scheme, @, :, query, brackets or quotes that could point the link, or the markdown, elsewhere.
const BARE_URL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[\w\-.~%!$&*+,;=/]*)?$/i;

/** A bare host with an optional path, like "example.com/docs". */
export const bareUrl = (v) => typeof v === "string" && BARE_URL.test(v);

// ---- Logos ----
// Every logo is copied into one shared sprite (scripts/sprite.mjs), served from the site's origin,
// so a logo is parsed strictly and only plain shapes in one theme colour get through: an allowlist
// of elements and attributes by exact name, nothing namespaced, no stylesheet, class, script,
// entity, comment or link outside the file. The sprite is built from the same parse.

export const LOGO_MAX_BYTES = 8000;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const LOGO_ELEMENTS = ["svg", "title", "path", "g", "defs", "clipPath", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use"];
const NUM = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
const NUMBER = new RegExp(`^\\s*${NUM}\\s*$`);
const LENGTH = new RegExp(`^\\s*${NUM}(?:px|em|ex|rem|pt|%)?\\s*$`);
// Linear on purpose: a pattern of repeated numbers would backtrack for ever on "translate(1111…x)".
const TRANSFORM = /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.eE+-]*\)\s*(?:,\s*)?)*$/;
const ID = /^[A-Za-z_][\w.-]*$/;
const URL_REF = /^\s*url\(\s*#([A-Za-z_][\w.-]*)\s*\)\s*$/;
const words = (...w) => new RegExp(`^\\s*(?:${w.join("|")})\\s*$`, "i");

const length = [(v) => LENGTH.test(v), "a number, or a length in px, em or %"];
const number = [(v) => NUMBER.test(v), "a number"];
const paint = [(v) => words("currentColor", "none").test(v), "logos are one colour that follows the theme: use currentColor or none"];
const rule = [(v) => words("nonzero", "evenodd", "inherit").test(v), "nonzero or evenodd"];
const clipRef = [(v) => URL_REF.test(v), "url(#id), pointing inside the file"];
const linecap = [(v) => words("butt", "round", "square", "inherit").test(v), "butt, round or square"];
const linejoin = [(v) => words("miter", "round", "bevel", "miter-clip", "arcs", "inherit").test(v), "miter, round or bevel"];
const plain = [(v) => /^[\w.%\s-]+$/.test(v), "a plain value"];

/** The attributes a logo may use, each with the values it may take. */
const LOGO_ATTRS = {
  xmlns: [(v) => v === SVG_NS, `only ${SVG_NS}`],
  "xmlns:xlink": [(v) => v === XLINK_NS, `only ${XLINK_NS}`],
  viewBox: [
    (v) => {
      const n = v.trim().split(/[\s,]+/);
      return n.length === 4 && n.every((x) => NUMBER.test(x)) && +n[2] > 0 && +n[3] > 0;
    },
    "four numbers, width and height positive",
  ],
  width: length,
  height: length,
  x: length,
  y: length,
  rx: length,
  ry: length,
  cx: length,
  cy: length,
  r: length,
  x1: length,
  y1: length,
  x2: length,
  y2: length,
  "stroke-width": length,
  opacity: number,
  fill: paint,
  stroke: paint,
  "fill-rule": rule,
  "clip-rule": rule,
  "clip-path": clipRef,
  "stroke-linecap": linecap,
  "stroke-linejoin": linejoin,
  d: [(v) => /^[MmZzLlHhVvCcSsQqTtAa\d\s,.eE+-]*$/.test(v), "path data"],
  points: [(v) => /^[\d\s,.eE+-]*$/.test(v), "numbers"],
  transform: [(v) => TRANSFORM.test(v), "translate, scale, rotate, skewX, skewY or matrix, with numbers"],
  id: [(v) => ID.test(v), "a letter or _, then letters, digits, _, . or -"],
};
// The sprite carries the root's viewBox and these onto the symbol; anything else there would be lost.
const ROOT_ATTRS = new Set(["xmlns", "xmlns:xlink", "viewBox", "width", "height", "fill", "fill-rule", "clip-rule", "style"]);
const STYLE_PROPS = {
  fill: paint,
  stroke: paint,
  "fill-rule": rule,
  "clip-rule": rule,
  "clip-path": [(v) => URL_REF.test(v) || words("none").test(v), "url(#id) or none"],
  opacity: number,
  "stroke-width": length,
  "stroke-linecap": linecap,
  "stroke-linejoin": linejoin,
  // Layout only, as icon exports write them on the root.
  flex: plain,
  "line-height": plain,
  "vertical-align": plain,
};
const ROOT_STYLE = new Set(["fill", "fill-rule", "clip-rule", "flex", "line-height", "vertical-align"]);

const clip = (v) => (v.length > 40 ? `${v.slice(0, 39)}…` : v);

function styleProblems(style, at, root) {
  if (/url\(\s*(?!#)/i.test(style)) return [`${at} style: url() may only point inside the file, as url(#id)`];
  if (/expression|behavior|binding|javascript:/i.test(style)) return [`${at} style: no expression(), behavior or bindings`];
  // Escapes and comments can spell any of the above; at-rules and blocks are stylesheets.
  if (/[\\<>&@{}"']|\/\*/.test(style)) return [`${at} style: no CSS escapes, comments, quotes, @import or blocks`];
  const out = [];
  for (const decl of style.split(";")) {
    if (!decl.trim()) continue;
    const m = decl.match(/^\s*([A-Za-z-]+)\s*:([^]*)$/);
    if (!m) {
      out.push(`${at} style "${clip(decl.trim())}" is not property: value`);
      continue;
    }
    const prop = m[1].toLowerCase();
    const check = STYLE_PROPS[prop];
    if (!check || (root && !ROOT_STYLE.has(prop))) out.push(`${at} style: ${prop} is not allowed${root ? " on the root <svg>" : ""}`);
    else if (!check[0](m[2])) out.push(`${at} style ${prop}: ${clip(m[2].trim())}: ${check[1]}`);
  }
  return out;
}

const START_TAG = /<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const END_TAG = /<\/([^\s>]+)\s*>/y;
const ATTR = /\s+([^\s=/>]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;
const XML_DECL = /^\uFEFF?\s*<\?xml((?:\s+[^\s=?>]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*\?>/;
const TEXT_REF = /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/;

/**
 * Parses a logo with the strict rules above. Returns every problem found (none when it can be a
 * logo) and, when it parses as XML, its tree: elements with their attributes in order and their
 * text (kept for <title> only).
 * @param {string} svg
 * @returns {{ problems: string[], root: SvgNode | null }}
 * @typedef {{ name: string, attrs: [string, string][], children: SvgNode[], text: string }} SvgNode
 */
export function parseLogo(svg) {
  const problems = [];
  const done = (root) => ({ problems: [...new Set(problems)], root: problems.length ? null : root });
  const fail = (why) => {
    problems.push(why);
    return done(null);
  };
  if (typeof svg !== "string") return fail("not text");
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > LOGO_MAX_BYTES) problems.push(`${bytes} bytes; keep logos under ${LOGO_MAX_BYTES} (run svgo)`);
  if (bytes > 16 * LOGO_MAX_BYTES) return done(null);

  let i = 0;
  const decl = svg.match(XML_DECL);
  if (decl) {
    for (const m of decl[1].matchAll(ATTR))
      if (!["version", "encoding", "standalone"].includes(m[1])) problems.push(`the XML declaration may only say version, encoding and standalone`);
    i = decl[0].length;
  }
  let root = null;
  const stack = [];
  const ids = new Set();
  const refs = new Set();
  while (i < svg.length) {
    const lt = svg.indexOf("<", i);
    const text = svg.slice(i, lt < 0 ? svg.length : lt);
    const parent = stack.at(-1);
    if (parent?.name === "title") {
      if (TEXT_REF.test(text)) return fail("a <title> may only use &amp; &lt; &gt; &quot; &apos; and numeric character references");
      parent.text += text;
    } else if (/\S/.test(text) && !parent?.bad) return fail(parent ? `no text inside <${parent.name}>` : "nothing but one <svg> element (and an XML declaration before it)");
    if (lt < 0) break;
    i = lt;
    if (svg.startsWith("<!--", i)) return fail("no comments (run svgo)");
    if (svg.startsWith("<![CDATA[", i)) return fail("no CDATA sections");
    if (svg.startsWith("<!", i)) return fail("no DOCTYPE or entity declarations");
    if (svg.startsWith("<?", i)) return fail("no processing instructions (only an XML declaration, at the very start)");
    if (svg.startsWith("</", i)) {
      END_TAG.lastIndex = i;
      const end = END_TAG.exec(svg);
      if (!end || stack.at(-1)?.name !== end[1]) return fail(`unbalanced tags near "${clip(svg.slice(i, i + 40))}"`);
      stack.pop();
      i = END_TAG.lastIndex;
      continue;
    }
    START_TAG.lastIndex = i;
    const tag = START_TAG.exec(svg);
    if (!tag) return fail(`malformed tag near "${clip(svg.slice(i, i + 40))}"`);
    i = START_TAG.lastIndex;
    const [, name, attrText, selfClosing] = tag;
    if (root && !stack.length) return fail("only one <svg> element, with nothing after it");
    if (!root && name !== "svg") return fail("must be a single <svg> element");
    const node = { name, attrs: [], children: [], text: "" };
    const at = `<${name}>`;
    if (!NAME.test(name)) return fail(`${at} is not a valid element name`);
    if (name.includes(":")) problems.push(`${at}: namespaced elements are not allowed`);
    else if (name === "style") problems.push("<style> is not allowed: every logo shares one sprite, where a stylesheet would restyle the others; use attributes");
    else if (!LOGO_ELEMENTS.includes(name)) problems.push(`${at} is not allowed (only ${LOGO_ELEMENTS.join(", ")})`);
    else if (name === "svg" && root) problems.push("<svg> only as the root element");
    node.bad = !LOGO_ELEMENTS.includes(name);

    const isRoot = !root;
    // xmlns:xlink declared here or on an ancestor, which passes it down.
    node.xlink = stack.at(-1)?.xlink ?? false;
    const seen = new Set();
    for (const [, attr, dq, sq] of attrText.matchAll(ATTR)) {
      if (seen.has(attr)) return fail(`${at} has ${attr} twice`);
      seen.add(attr);
      node.attrs.push([attr, dq ?? sq]);
      if (attr === "xmlns:xlink") node.xlink = true;
    }
    // The sprite writes both as href: one element can't carry two.
    if (seen.has("href") && seen.has("xlink:href")) problems.push(`${at} has both href and xlink:href: keep one`);
    for (const [attr, v] of node.attrs) {
      if (!NAME.test(attr)) problems.push(`${at} ${attr}: not a valid attribute name`);
      else if (/^on/i.test(attr)) problems.push(`${at} ${attr}: event handlers are not allowed`);
      else if (attr === "href" || attr === "xlink:href") {
        if (name !== "use") problems.push(`${at} ${attr}: links are only allowed on <use>, as #id`);
        else if (!/^#[A-Za-z_][\w.-]*$/.test(v)) problems.push(`${at} ${attr}="${clip(v)}": only links inside the file (#id) are allowed`);
        else if (attr === "xlink:href" && !node.xlink) problems.push(`${at} xlink:href needs xmlns:xlink="${XLINK_NS}" on the <svg> element`);
        else refs.add(v.slice(1));
      } else if (attr.includes(":") && attr !== "xmlns:xlink") problems.push(`${at} ${attr}: namespaced attributes are not allowed (only xmlns:xlink, and xlink:href="#id" on <use>)`);
      else if (attr === "class") problems.push(`${at} class is not allowed: every logo shares one sprite, where classes would collide; use attributes`);
      else if (isRoot && !ROOT_ATTRS.has(attr)) problems.push(`<svg> ${attr} is not allowed on the root: only ${[...ROOT_ATTRS].join(", ")}`);
      else if (v.includes("&")) problems.push(`${at} ${attr}: no entities or & in attribute values`);
      else if (attr === "style") problems.push(...styleProblems(v, at, isRoot));
      else if (!(attr in LOGO_ATTRS)) problems.push(`${at} ${attr} is not allowed`);
      else if (!LOGO_ATTRS[attr][0](v)) problems.push(`${at} ${attr}="${clip(v)}": ${LOGO_ATTRS[attr][1]}`);
      else if (attr === "id") {
        if (ids.has(v)) problems.push(`id "${v}" is used twice`);
        ids.add(v);
      }
      if (attr === "clip-path" || attr === "style") for (const r of v.matchAll(/url\(\s*#([A-Za-z_][\w.-]*)\s*\)/g)) refs.add(r[1]);
    }
    if (isRoot) {
      root = node;
      if (!seen.has("viewBox")) problems.push("needs a viewBox on the <svg> element");
      // scripts/sprite.mjs once read it with a double-quoted pattern; keep files that simple.
      else if (!/\sviewBox\s*=\s*"/.test(attrText)) problems.push("<svg> viewBox must be in double quotes");
    } else stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (!root) return fail("must be a single <svg> element");
  if (stack.length) return fail(`<${stack.at(-1).name}> is never closed`);
  for (const r of refs) if (!ids.has(r)) problems.push(`#${r} points at no element in the file`);
  return done(strip(root));
}

/** The tree without the parser's bookkeeping. */
const strip = (n) => ({ name: n.name, attrs: n.attrs, children: n.children.map(strip), text: n.text });

/** Why an SVG can't be a logo, one line each; empty when it can. */
export const logoProblems = (svg) => parseLogo(svg).problems;
