import Link from "next/link";
import { type HotCard, getHot } from "@/lib/data";
import { Logo } from "./Logo";

// Short names for the places a conversation happens; anything else shows its domain.
const PLACES: Record<string, string> = {
  "x.com": "X",
  "twitter.com": "X",
  "news.ycombinator.com": "HN",
  "github.com": "GitHub",
  "reddit.com": "Reddit",
  "old.reddit.com": "Reddit",
  "producthunt.com": "Product Hunt",
  "youtube.com": "YouTube",
};
const place = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return PLACES[host] ?? host;
};
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** One row of cards, its designators prefixed like a board's (S1 for stacks, L1 for layers). */
function Row({ title, prefix, cards }: { title: string; prefix: string; cards: HotCard[] }) {
  if (!cards.length) return null;
  return (
    <div className="hot-row">
      <h3 className="silk">{title}</h3>
      <ol className="hot-cards">
        {cards.map(({ item, name, logo, label, band, href, affiliation }, i) => {
          // One link per place, in the order the list gives them: an X post first when there is one.
          const sources = item.sources.filter((s, n, all) => all.findIndex((x) => place(x.url) === place(s.url)) === n).slice(0, 3);
          return (
            <li key={href} className={band ? `module hot-card b-${band}` : "module hot-card"}>
              <span className="silk">
                <span className="ref">
                  {prefix}
                  {i + 1}
                </span>
                <span className="hot-label">{label}</span>
              </span>
              <Logo option={{ name, logo }} />
              <Link href={href} className="hot-name">
                {name}
              </Link>
              <p className="hot-why">{item.why}</p>
              <p className="hot-src">
                {item.since && <time dateTime={item.since}>{day(item.since)}</time>}
                {sources.map((s) => (
                  <a key={s.url} href={s.url} rel="noopener" title={s.title} aria-label={`${place(s.url)}: ${s.title}`}>
                    {place(s.url)}
                  </a>
                ))}
                {/* Ranked on the same evidence as everything else; the card still says who makes it. */}
                {affiliation && <span title={affiliation}>affiliated</span>}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Two rows of cards for what people on X talk about the most this week, from content/hot.json. */
export function Hot() {
  const hot = getHot();
  if (!hot || !(hot.stacks.length + hot.options.length)) return null;
  return (
    <section className="hot" aria-labelledby="hot">
      <div className="hot-head">
        <h2 id="hot">Hot right now</h2>
        <span className="muted">
          Most talked about on X, {day(hot.from)} to {day(hot.updated)}
        </span>
      </div>
      <Row title="Stacks" prefix="S" cards={hot.stacks} />
      <Row title="Layers" prefix="L" cards={hot.options} />
    </section>
  );
}
