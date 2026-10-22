"use client";

import { useEffect, useState } from "react";
import { encodeDraft, loadSaved, storeSaved } from "@/lib/share";
import type { Draft } from "@/lib/types";

export function Mine() {
  const [list, setList] = useState<Draft[] | null>(null);
  useEffect(() => setList(loadSaved()), []);

  if (!list) return null;
  if (!list.length)
    return (
      <p className="lede">
        Nothing saved yet. Open any stack, change it, and press <a href="/">Save</a>. Saved stacks stay in this
        browser; share a link to move them anywhere.
      </p>
    );

  const remove = (name: string) => {
    const next = list.filter((d) => d.name !== name);
    storeSaved(next);
    setList(next);
  };

  return (
    <div className="options">
      {list.map((d) => (
        <div key={d.name} className="opt">
          <div className="opt-name">
            <a href={`/#s=${encodeDraft(d)}`}>{d.name}</a>
          </div>
          <div className="opt-note">{Object.keys(d.layers).length} layers</div>
          <div className="opt-used">
            <button onClick={() => remove(d.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
