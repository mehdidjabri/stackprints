// Client-safe URL helpers (no fs).
import { slugify } from "./github";

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

/** "/stack/pi/" → "/stack/pi.md"; "/" → "/index.md". Every content page has a markdown twin. */
export const mdPath = (page: string) => (page === "/" ? "/index.md" : `${page.replace(/\/$/, "")}.md`);

/** Metadata alternates: canonical URL plus the page's markdown twin. */
export const withMarkdown = (page: string) => ({ canonical: page, types: { "text/markdown": mdPath(page) } });
