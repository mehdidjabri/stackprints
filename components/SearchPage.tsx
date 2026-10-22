"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Row, type Why, loadIndex, search, why, whyText } from "@/lib/search";
import { Result } from "./SearchBox";

/** What matched, for a result whose name and subtitle don't show it. */
function Reason({ w }: { w: Why }) {
  if ("uses" in w) return <>{whyText(w)}</>;
  const [before, match, after] = w.snippet;
  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  );
}

export function SearchPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setQ(new URLSearchParams(location.search).get("q") ?? "");
    loadIndex().then((r) => {
      setRows(r);
      setLoaded(true);
    });
  }, []);
  const results = search(rows, q, 100);
  const layers = rows.filter((r) => r[0] === "layer");
  return (
    <>
      <form className="fields" role="search" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          value={q}
          autoFocus
          placeholder="Models, memory, sandboxes, stacks…"
          aria-label="Search"
          onChange={(e) => {
            setQ(e.target.value);
            history.replaceState(null, "", `?q=${encodeURIComponent(e.target.value)}`);
          }}
        />
      </form>
      <p className="muted small search-count" aria-live="polite">
        {!loaded ? (
          "Loading the index…"
        ) : !q.trim() ? (
          `${rows.length} things to search`
        ) : results.length ? (
          `${results.length} ${results.length === 1 ? "result" : "results"}`
        ) : (
          <>
            Nothing matches “{q.trim()}”. <Link href="/layers/">Browse all {layers.length} layers</Link> or, if something is
            missing, <Link href="/submit/">add it</Link>.
          </>
        )}
      </p>
      {loaded && !q.trim() && (
        <>
          <h2 className="block-head search-start">Start from a layer</h2>
          <div className="alts">
            {layers.map((r) => (
              <Link key={r[3]} href={r[3]} className="chip">
                <span className="chip-text">
                  <span className="chip-name">{r[1]}</span>
                  <span className="chip-note">{r[2]}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="results">
        {results.map((r) => {
          const w = why(r, q);
          return (
            <Link key={r[3]} href={r[3]} className="chip">
              <Result r={r} why={w && <Reason w={w} />} />
            </Link>
          );
        })}
      </div>
    </>
  );
}
