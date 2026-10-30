"use client";

import { useEffect } from "react";

/** Opens every fold around an element, so a link into one (a citation, a layer's prompt) lands on it. */
const reveal = (id: string) => {
  const el = id && document.getElementById(id);
  if (!el) return null;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  return el;
};

/** Unfolds what an in-page link points at, before the browser scrolls to it; and on arrival at a hash. */
export function OpenOnHash() {
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
      if (a) reveal(decodeURIComponent(a.hash.slice(1)));
    };
    // A hash typed, shared or gone back to: the browser already scrolled, to a fold still shut.
    const arrive = () => reveal(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" });
    arrive();
    document.addEventListener("click", click);
    addEventListener("hashchange", arrive);
    return () => {
      document.removeEventListener("click", click);
      removeEventListener("hashchange", arrive);
    };
  }, []);
  return null;
}
