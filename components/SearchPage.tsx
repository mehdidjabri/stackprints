"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Row, loadIndex, search } from "@/lib/search";
import { Result } from "./SearchBox";

export function SearchPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    setQ(new URLSearchParams(location.search).get("q") ?? "");
    loadIndex().then(setRows);
  }, []);
  const results = search(rows, q, 100);
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
      <p className="muted small">{q ? `${results.length} results` : `${rows.length} things to search`}</p>
      <div className="results">
        {results.map((r) => (
          <Link key={r[3]} href={r[3]} className="chip">
            <Result r={r} />
          </Link>
        ))}
      </div>
    </>
  );
}
