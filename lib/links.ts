// Client-safe URL helpers (no fs).
import { slugify } from "./github";
import type { Stack } from "./types";

export const optionHref = (layerId: string, optionId: string) => `/layer/${layerId}/${optionId}/`;

/** A kind of stack ("Coding agent") lists its stacks at /stacks/coding-agent/. */
export const kindHref = (kind: string) => `/stacks/${slugify(kind)}/`;

/** The link a stack is best known by: its site, else its announcement, repo or docs. */
export const primaryLink = (links?: Partial<Record<"site" | "repo" | "docs" | "announcement", string>>) =>
  links?.site ?? links?.announcement ?? links?.repo ?? links?.docs;

/** "https://www.perplexity.ai/comet" → "perplexity.ai/comet"; long paths collapse to the domain. */
export const prettyUrl = (u: string) => {
  const [host, ...rest] = u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").split("/");
  const path = rest.join("/");
  return path && path.length <= 20 ? `${host}/${path}` : host;
};

/** "https://docs.openclaw.ai/concepts/memory/" → "docs.openclaw.ai/concepts/memory": the whole path, so sources can be told apart. */
export const bareUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

type Source = { title: string; url: string };

/**
 * Numbered sources: the curated list, then every evidence URL it doesn't hold yet, titled by its bare URL,
 * so each citation resolves. Citation [n] is entry n - 1 on the page, in markdown and in the API alike.
 */
export function numberedSources(sources: Source[] = [], evidence: Record<string, string[]> = {}): Source[] {
  const out = [...sources];
  for (const u of Object.values(evidence).flat()) if (!out.some((x) => x.url === u)) out.push({ title: bareUrl(u), url: u });
  return out;
}
export const stackSources = (s: Pick<Stack, "sources" | "evidence">) => numberedSources(s.sources, s.evidence);

/** The citation numbers for some evidence URLs, in source order. */
export const citeNumbers = (sources: Source[], urls: string[] = []) =>
  urls.map((u) => sources.findIndex((x) => x.url === u) + 1).sort((a, b) => a - b);

/** "/stack/pi/" → "/stack/pi.md"; "/" → "/index.md". Every content page has a markdown twin. */
export const mdPath = (page: string) => (page === "/" ? "/index.md" : `${page.replace(/\/$/, "")}.md`);

/** Metadata alternates: canonical URL plus the page's markdown twin. */
export const withMarkdown = (page: string) => ({ canonical: page, types: { "text/markdown": mdPath(page) } });
