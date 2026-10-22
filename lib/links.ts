// Client-safe URL helpers (no fs).
export const optionHref = (layerId: string, optionId: string) => `/layer/${layerId}/${optionId}/`;

/** The link a stack is best known by: its site, else its announcement, repo or docs. */
export const primaryLink = (links?: Partial<Record<"site" | "repo" | "docs" | "announcement", string>>) =>
  links?.site ?? links?.announcement ?? links?.repo ?? links?.docs;

/** "https://www.perplexity.ai/comet" → "perplexity.ai/comet"; long paths collapse to the domain. */
export const prettyUrl = (u: string) => {
  const [host, ...rest] = u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").split("/");
  const path = rest.join("/");
  return path && path.length <= 20 ? `${host}/${path}` : host;
};
