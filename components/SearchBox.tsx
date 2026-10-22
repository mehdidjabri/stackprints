"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Row, loadIndex, search } from "@/lib/search";
import { Logo } from "./Logo";

export function Result({ r }: { r: Row }) {
  return (
    <>
      <Logo option={{ name: r[1], logo: r[4] || undefined }} />
      <span className="chip-text">
        <span className="chip-name">{r[1]}</span>
        <span className="chip-note">{r[2]}</span>
      </span>
      <span className="kind">{r[0]}</span>
    </>
  );
}

/** Header search: loads the index on first focus, "/" or ⌘K to focus, arrows + Enter to pick. */
export function SearchBox() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setResults(search(rows, q, 8));
    setActive(0);
  }, [rows, q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    window.location.href = href;
  };

  return (
    <form
      className="search"
      role="search"
      action="/search/"
      onSubmit={(e) => {
        e.preventDefault();
        if (results[active]) go(results[active][3]);
        else if (q.trim()) go(`/search/?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        ref={input}
        name="q"
        type="search"
        value={q}
        placeholder="Search"
        aria-label="Search stacks, layers and tools"
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          loadIndex().then(setRows);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Escape") input.current?.blur();
          else return;
          e.preventDefault();
        }}
      />
      <kbd aria-hidden="true">/</kbd>
      {open && q && (
        <ul className="search-results" role="listbox">
          {results.map((r, i) => (
            <li key={r[3]} role="option" aria-selected={i === active}>
              <Link href={r[3]} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>
                <Result r={r} />
              </Link>
            </li>
          ))}
          <li>
            <Link className="search-all" href={`/search/?q=${encodeURIComponent(q)}`} onMouseDown={(e) => e.preventDefault()}>
              {results.length ? "All results" : "No matches. Search everything"} →
            </Link>
          </li>
        </ul>
      )}
    </form>
  );
}
