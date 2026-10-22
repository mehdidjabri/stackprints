import Link from "next/link";
import { getTrending } from "@/lib/data";
import { optionHref } from "@/lib/links";
import { Logo } from "./Logo";

/** Ranked rows: silkscreen rank, the chip, and the headline that put it there. */
export function Trending({ limit = 8 }: { limit?: number }) {
  const rows = getTrending().slice(0, limit);
  if (!rows.length) return <p className="muted">Nothing in the news yet.</p>;
  return (
    <ol className="trending">
      {rows.map(({ layer, option, latest, count }, i) => (
        <li key={`${layer.id}/${option.id}`} className="module">
          <span className="silk">
            <span className="ref">R{i + 1}</span>
          </span>
          <Link href={optionHref(layer.id, option.id)} className="chip">
            <Logo option={option} />
            <span className="chip-text">
              <span className="chip-name">{option.name}</span>
              <span className="chip-note">
                {layer.name} · {count} {count === 1 ? "story" : "stories"}
              </span>
            </span>
          </Link>
          <a className="trend-news" href={latest.url} rel="noopener">
            <time dateTime={latest.date}>{latest.date}</time> {latest.title}
          </a>
        </li>
      ))}
    </ol>
  );
}
