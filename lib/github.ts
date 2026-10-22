/** GitHub's "create new file" page, prefilled. Non-maintainers get a fork and a pull request automatically. */
export const newFileUrl = (repo: string, filename: string, value: string) =>
  `${repo}/new/main?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(value)}`;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
