"use client";

import { useEffect } from "react";

const KEY = "stackprints:view";

/** Remembers Simple or Blueprint across pages, and opens the one a link asks for (#blueprint, #simple). */
export function ViewMemory({ id }: { id: string }) {
  useEffect(() => {
    const root = document.getElementById(id);
    if (!root) return;
    const pick = (view: string | null) => {
      const input = root.querySelector<HTMLInputElement>(`input[name="${id}"][value="${view}"]`);
      if (input) input.checked = true;
    };
    const fromHash = () => {
      if (location.hash === "#blueprint" || location.hash === "#simple") pick(location.hash.slice(1));
    };
    try {
      pick(localStorage.getItem(KEY));
    } catch {}
    fromHash();
    const remember = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.name !== id) return;
      try {
        localStorage.setItem(KEY, t.value);
      } catch {}
    };
    root.addEventListener("change", remember);
    window.addEventListener("hashchange", fromHash);
    return () => {
      root.removeEventListener("change", remember);
      window.removeEventListener("hashchange", fromHash);
    };
  }, [id]);
  return null;
}
