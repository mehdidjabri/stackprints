// Tiny client-side search over /search.json. No dependencies.
export type Row = [kind: string, title: string, subtitle: string, href: string, logo: string, extra: string];

let index: Promise<Row[]> | undefined;
export const loadIndex = () => (index ??= fetch("/search.json").then((r) => r.json() as Promise<Row[]>));

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s.]/g, " ");

export function search(rows: Row[], q: string, limit = 12): Row[] {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: [number, Row][] = [];
  for (const r of rows) {
    const title = norm(r[1]);
    const sub = norm(r[2]);
    const extra = norm(r[5]);
    let score = 0;
    for (const t of terms) {
      if (title === t) score += 12;
      else if (title.startsWith(t)) score += 8;
      else if (title.split(" ").some((w) => w.startsWith(t))) score += 6;
      else if (title.includes(t)) score += 4;
      else if (sub.includes(t)) score += 2;
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
