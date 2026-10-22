// Tiny client-side search over /search.json. No dependencies.
export type Row = [kind: string, title: string, subtitle: string, href: string, logo: string, extra: string, uses: string];

let index: Promise<Row[]> | undefined;
export const loadIndex = () => (index ??= fetch("/search.json").then((r) => r.json() as Promise<Row[]>));

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s.]/g, " ");
const terms = (q: string) => norm(q).split(/\s+/).filter(Boolean);

export function search(rows: Row[], q: string, limit = 12): Row[] {
  const ts = terms(q);
  if (!ts.length) return [];
  const scored: [number, Row][] = [];
  for (const r of rows) {
    const title = norm(r[1]);
    const sub = norm(r[2]);
    const uses = norm(r[6] ?? "");
    const extra = norm(r[5]);
    let score = 0;
    for (const t of ts) {
      if (title === t) score += 12;
      else if (title.startsWith(t)) score += 8;
      else if (title.split(" ").some((w) => w.startsWith(t))) score += 6;
      else if (title.includes(t)) score += 4;
      else if (sub.includes(t)) score += 2;
      else if (uses.includes(t)) score += 1;
      else if (extra.includes(t)) score += 0.5;
      else {
        score = 0;
        break;
      }
    }
    // Small tie-breakers: layers, then stacks, then options.
    if (score) scored.push([score + (r[0] === "layer" ? 0.2 : r[0] === "stack" ? 0.1 : 0), r]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, r]) => r);
}

/** Why a row matched, when its title and subtitle don't show it: the parts a stack uses, or a line of its text. */
export type Why = { uses: string[] } | { snippet: [before: string, match: string, after: string] };

export function why(r: Row, q: string): Why | undefined {
  const t = terms(q).find((x) => !norm(r[1]).includes(x) && !norm(r[2]).includes(x));
  if (!t) return undefined;
  const uses = (r[6] ?? "").split("; ").filter((u) => norm(u).includes(t));
  if (uses.length) return { uses };
  const text = r[5].trim();
  const i = text.toLowerCase().indexOf(t);
  if (i < 0) return undefined;
  // About 40 characters either side, widened to whole words.
  let a = Math.max(0, i - 40);
  let b = Math.min(text.length, i + t.length + 40);
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  return { snippet: [`${a > 0 ? "…" : ""}${text.slice(a, i)}`, text.slice(i, i + t.length), `${text.slice(i + t.length, b)}${b < text.length ? "…" : ""}`] };
}

/** "Uses Memory: MEMORY.md, Honcho": a stack's matching parts, grouped by layer, at most four named. */
function usesText(uses: string[]) {
  const by = new Map<string, string[]>();
  for (const u of uses.slice(0, 4)) {
    const i = u.indexOf(": ");
    by.set(u.slice(0, i), [...(by.get(u.slice(0, i)) ?? []), u.slice(i + 2)]);
  }
  const more = uses.length > 4 ? ` and ${uses.length - 4} more` : "";
  return `Uses ${[...by].map(([layer, names]) => `${layer}: ${names.join(", ")}`).join("; ")}${more}`;
}

/** The same, as plain text. */
export const whyText = (w: Why) => ("uses" in w ? usesText(w.uses) : w.snippet.join(""));
