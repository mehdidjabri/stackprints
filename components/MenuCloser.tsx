"use client";

import { useEffect } from "react";

/** Closes open dropdowns on outside click, Escape, or after picking an item. */
export function MenuCloser() {
  useEffect(() => {
    const closeAll = (except?: Element | null) =>
      document.querySelectorAll("details.dd[open]").forEach((d) => d !== except && d.removeAttribute("open"));
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      const dd = t.closest("details.dd");
      if (dd && t.closest(".dd-menu a, .dd-menu button")) return closeAll();
      closeAll(dd);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAll();
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
