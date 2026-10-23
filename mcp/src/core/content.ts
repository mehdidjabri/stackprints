// Pure readers over the content files (no filesystem, no network), for the admin tools that work on
// the repository itself: freshness, staleness, duplicates and the raw files agents edit.
import { slugify } from "../../../lib/github";
import type { Files, Hot, Layer, News, Option, Stack } from "./types";

export type LayerRow = Omit<Layer, "options">;

export const paths = {
  layers: "content/layers.json",
  hot: "content/hot.json",
  option: (layer: string, id: string) => `content/options/${layer}/${id}.json`,
  news: (layer: string, id: string) => `content/news/${layer}/${id}.json`,
  stack: (slug: string) => `content/stacks/${slug}.json`,
  prompt: (slug: string, id: string) => `content/prompts/${slug}/${id}.md`,
  logo: (name: string) => `content/logos/${name}.svg`,
};

/** YYYY-MM-DD, UTC. */
export const day = (t: number) => new Date(t).toISOString().slice(0, 10);
export const daysBetween = (from: string, now: number) => Math.floor((now - Date.parse(`${from}T00:00:00Z`)) / 864e5);

export function readJson<T>(files: Files, path: string): T | undefined {
  const t = files.get(path);
  return t === undefined ? undefined : (JSON.parse(t) as T);
}

/** JSON written the way the repo writes it: two-space indent and a trailing newline. */
export const toJson = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

const oneLine = (o: Record<string, unknown>) => `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;

/** A news file with one item per line, as some of the repo's news files are written. */
export const toNewsLines = (n: News) =>
  `{\n  "updated": ${JSON.stringify(n.updated)},\n  "items": ${n.items.length ? `[\n${n.items.map((i) => `    ${oneLine(i)}`).join(",\n")}\n  ]` : "[]"}\n}\n`;

/** A news file in the layout it already has, so a re-check changes one line rather than every item. */
export function toNewsJson(n: News, previous?: string) {
  if (previous !== undefined) {
    try {
      if (toNewsLines(JSON.parse(previous) as News) === previous) return toNewsLines(n);
    } catch {}
  }
  return toJson(n);
}

export const layers = (files: Files) => readJson<LayerRow[]>(files, paths.layers) ?? [];

/** Files directly inside a folder with a given extension, as names without the extension. */
export function namesIn(files: Files, dir: string, ext: string) {
  const out: string[] = [];
  for (const k of files.keys()) {
    if (!k.startsWith(`${dir}/`) || !k.endsWith(ext)) continue;
    const rest = k.slice(dir.length + 1);
    if (!rest.includes("/")) out.push(rest.slice(0, -ext.length));
  }
  return out.sort();
}

export function options(files: Files, layer: string): Option[] {
  return namesIn(files, `content/options/${layer}`, ".json").map((id) => readJson<Option>(files, paths.option(layer, id))!);
}

export function allOptions(files: Files) {
  return layers(files).flatMap((l) => options(files, l.id).map((o) => ({ layer: l, option: o })));
}

export const option = (files: Files, layer: string, id: string) => readJson<Option>(files, paths.option(layer, id));
export const news = (files: Files, layer: string, id: string) => readJson<News>(files, paths.news(layer, id));
export const stack = (files: Files, slug: string) => readJson<Stack>(files, paths.stack(slug));
export const stacks = (files: Files) => namesIn(files, "content/stacks", ".json").map((s) => stack(files, s)!);
export const hot = (files: Files) => readJson<Hot>(files, paths.hot);

export type StaleRow = { kind: "news" | "option" | "stack"; layer?: string; id: string; name: string; url: string | null; date: string | null; ageDays: number | null };

/**
 * Items whose news or research is older than `olderThanDays`, oldest first (never-checked first of all).
 * News skips patterns, which have no news, as scripts/news-stale.mjs does.
 */
export function listStale(
  files: Files,
  { kind, olderThanDays, layer, limit = 50, now }: { kind: StaleRow["kind"]; olderThanDays: number; layer?: string; limit?: number; now: number },
) {
  const rows: StaleRow[] = [];
  const age = (d?: string | null) => (d ? daysBetween(d, now) : null);
  const old = (a: number | null) => a === null || a >= olderThanDays;
  if (kind === "stack") {
    for (const s of stacks(files)) {
      const a = age(s.researched);
      if (old(a)) rows.push({ kind, id: s.slug, name: s.name, url: s.links?.site ?? null, date: s.researched ?? null, ageDays: a });
    }
  } else {
    for (const { layer: l, option: o } of allOptions(files)) {
      if (layer && l.id !== layer) continue;
      if (kind === "news" && o.profile === "pattern") continue;
      const date = kind === "news" ? (news(files, l.id, o.id)?.updated ?? null) : (o.researched ?? null);
      const a = age(date);
      if (old(a)) rows.push({ kind, layer: l.id, id: o.id, name: o.name, url: o.url ?? null, date, ageDays: a });
    }
  }
  rows.sort((a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity) || (a.layer ?? "").localeCompare(b.layer ?? "") || a.id.localeCompare(b.id));
  return { total: rows.length, rows: rows.slice(0, limit) };
}

/** The starting point of a run: how much of each kind is stale, and how old the hot list is. */
export function freshness(files: Files, now: number) {
  const count = (kind: StaleRow["kind"], d: number) => listStale(files, { kind, olderThanDays: d, limit: 0, now }).total;
  const h = hot(files);
  return {
    today: day(now),
    news: { olderThan7Days: count("news", 7), olderThan30Days: count("news", 30) },
    options: { researchOlderThan90Days: count("option", 90), total: allOptions(files).length },
    stacks: { researchOlderThan90Days: count("stack", 90), total: stacks(files).length },
    hot: h ? { updated: h.updated, ageDays: daysBetween(h.updated, now), stacks: h.stacks.length, options: h.options.length } : null,
  };
}

const host = (u?: string | null) => {
  if (!u) return "";
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const repoOf = (u?: string | null) => u?.match(/github\.com\/([^/]+\/[^/#?]+)/i)?.[1]?.toLowerCase().replace(/\.git$/, "") ?? "";
const words = (s: string) => slugify(s).split("-").filter(Boolean);

/**
 * Options and stacks that may already be the thing an agent is about to add: same slug, same
 * domain, same GitHub repo, or a name that contains or is contained in the other (RESEARCH.md rule 4).
 */
export function checkDuplicate(files: Files, q: { name: string; url?: string; repo?: string }) {
  const name = slugify(q.name);
  const qHost = host(q.url);
  const qRepo = repoOf(q.repo) || repoOf(q.url);
  const matches: { kind: "option" | "stack"; layer?: string; id: string; name: string; why: string[] }[] = [];
  const test = (n: string, url?: string | null, repo?: string | null) => {
    const why: string[] = [];
    const s = slugify(n);
    if (s === name) why.push("same name");
    else if (words(n).length && words(q.name).length && (s.includes(name) || name.includes(s)) && Math.min(s.length, name.length) >= 4) why.push("similar name");
    if (qHost && host(url) === qHost) why.push(`same domain ${qHost}`);
    const r = repoOf(repo) || repoOf(url);
    if (qRepo && r === qRepo) why.push(`same repo ${qRepo}`);
    return why;
  };
  for (const { layer, option: o } of allOptions(files)) {
    const why = test(o.name, o.url, o.links?.repo);
    if (o.id === name && !why.includes("same name")) why.push("same id");
    if (why.length) matches.push({ kind: "option", layer: layer.id, id: o.id, name: o.name, why });
  }
  for (const s of stacks(files)) {
    const why = test(s.name, s.links?.site, s.links?.repo);
    if (why.length) matches.push({ kind: "stack", id: s.slug, name: s.name, why });
  }
  return matches;
}
