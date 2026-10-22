"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Row, loadIndex, search } from "@/lib/search";
import { Logo } from "./Logo";

/** One result. `why` is a line saying what matched, when the name and subtitle don't show it. */
export function Result({ r, why }: { r: Row; why?: React.ReactNode }) {
  return (
    <>
      <Logo option={{ name: r[1], logo: r[4] || undefined }} />
      <span className="chip-text">
        <span className="chip-name">{r[1]}</span>
        <span className="chip-note">{r[2]}</span>
        {why && <span className="chip-why">{why}</span>}
      </span>
      <span className="kind">{r[0]}</span>
    </>
  );
}

/**
 * Header search: an ARIA combobox. Loads the index on first focus, ⌘K / Ctrl+K to focus,
 * arrows to move through the suggestions, Enter to open one, Escape to close them.
 */
export function SearchBox() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [mod, setMod] = useState("⌘K");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A modifier shortcut only: a bare "/" would fire for speech input and can't be turned off (WCAG 2.1.4).
    if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setMod("Ctrl K");
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
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

  const shown = open && Boolean(q);
  const all = `/search/?q=${encodeURIComponent(q.trim())}`;

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
      aria-label="Site"
      action="/search/"
      onSubmit={(e) => {
        e.preventDefault();
        if (shown && results[active]) go(results[active][3]);
        else if (q.trim()) go(all);
      }}
      // Close when focus leaves the whole form, not the input: Tab can still reach "All results".
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        ref={input}
        name="q"
        type="search"
        role="combobox"
        value={q}
        placeholder="Search"
        aria-label="Search stacks, layers and tools"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown && results.length ? "search-listbox" : undefined}
        aria-activedescendant={shown && results[active] ? `sr-${active}` : undefined}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          loadIndex().then(setRows);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            if (shown) setActive((a) => Math.min(a + 1, results.length - 1));
            else setOpen(true);
          } else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          // Escape closes the suggestions first, then clears the box. Focus stays put.
          else if (e.key === "Escape") {
            if (shown) setOpen(false);
            else if (q) setQ("");
            else return;
          } else return;
          e.preventDefault();
        }}
      />
      <kbd aria-hidden="true">{mod}</kbd>
      {/* Always in the page, so screen readers hear the count change as you type. */}
      <span role="status" className="sr-only">
        {shown && rows.length
          ? results.length
            ? `${results.length} ${results.length === 1 ? "suggestion" : "suggestions"}, use up and down arrows`
            : "No suggestions, press Enter to search everything"
          : ""}
      </span>
      {shown && (
        <div className="search-popover">
          {results.length > 0 && (
            <ul id="search-listbox" className="search-results" role="listbox" aria-label="Suggestions">
              {results.map((r, i) => (
                <li key={r[3]} role="none">
                  {/* Options stay links (middle-click, prefetch) but out of the Tab order: arrows move between them. */}
                  <Link
                    href={r[3]}
                    id={`sr-${i}`}
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    className="chip"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setOpen(false)}
                  >
                    <Result r={r} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link className="search-all" href={all} onMouseDown={(e) => e.preventDefault()}>
            {results.length ? "All results" : "No matches. Search everything"} →
          </Link>
        </div>
      )}
    </form>
  );
}
