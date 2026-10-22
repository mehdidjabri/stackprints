"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Saved, encodeDraft, loadSaved, normalizeDraft, storeSaved } from "@/lib/share";

type LayerIds = { id: string; options: { id: string }[] };

/** Stacks saved in this browser. `presets` maps a stack's slug to its name, for "based on". */
export function Mine({ layers, presets }: { layers: LayerIds[]; presets: Record<string, string> }) {
  const [list, setList] = useState<Saved[] | null>(null);
  // The last deletion, undoable for a few seconds.
  const [undo, setUndo] = useState<{ item: Saved; at: number } | null>(null);
  const [status, setStatus] = useState("");
  // A share link the clipboard refused, left on screen to copy by hand.
  const [copyUrl, setCopyUrl] = useState<string | null>(null);
  useEffect(() => setList(loadSaved()), []);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 2200);
    return () => clearTimeout(t);
  }, [status]);

  if (!list) return null;

  const write = (next: Saved[]) => {
    storeSaved(next);
    setList(next);
  };
  const remove = (d: Saved) => {
    write(list.filter((x) => x.id !== d.id));
    setUndo({ item: d, at: list.indexOf(d) });
  };
  const restore = () => {
    if (!undo) return;
    write([...list.slice(0, undo.at), undo.item, ...list.slice(undo.at)]);
    setUndo(null);
  };
  const share = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyUrl(null);
      setStatus("Link copied");
    } catch {
      setCopyUrl(url);
    }
  };

  return (
    <>
      <div className="toolbar" aria-live="polite">
        <span className="status">
          {undo && (
            <>
              Deleted “{undo.item.name}” ·{" "}
              <button className="link" onClick={restore}>
                Undo
              </button>
            </>
          )}
          {!undo && status}
        </span>
        {copyUrl && (
          <span className="copy-link">
            <input readOnly value={copyUrl} aria-label="Share link" autoFocus onFocus={(e) => e.currentTarget.select()} />
            <button onClick={() => setCopyUrl(null)}>Done</button>
          </span>
        )}
      </div>
      {list.length ? (
        <div className="options">
          {list.map((d) => {
            // Saved before an option moved layer: open and count it as it reads today.
            const fixed = normalizeDraft(d, layers).draft;
            const href = `/#s=${encodeDraft(fixed)}`;
            const n = Object.keys(fixed.layers).length;
            return (
              <div key={d.id} className="opt">
                <div className="opt-name">
                  <a href={href}>{d.name || "Untitled stack"}</a>
                  {d.from && presets[d.from] && (
                    <span className="opt-aff muted">
                      based on <Link href={`/stack/${d.from}/`}>{presets[d.from]}</Link>
                    </span>
                  )}
                </div>
                <div className="opt-note">
                  {n} {n === 1 ? "layer" : "layers"}
                  {d.savedAt ? ` · saved ${new Date(d.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                </div>
                <div className="opt-used">
                  <button onClick={() => share(`${location.origin}${href}`)}>Share</button>{" "}
                  <button onClick={() => remove(d)} aria-label={`Delete ${d.name || "Untitled stack"}`}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="lede">
          Nothing saved yet. Open any stack, change it, and press <a href="/">Save</a>. Saved stacks stay in this
          browser; share a link to move them anywhere.
        </p>
      )}
    </>
  );
}
