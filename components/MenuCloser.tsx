"use client";

import { useEffect } from "react";

/** Puts focus back on a dropdown's own toggle, so closing it never drops focus to the page. */
const refocus = (dd: Element) => dd.querySelector<HTMLElement>(":scope > summary")?.focus();

/** Closes open dropdowns on outside click, Escape, Tab out, or after picking an item. */
export function MenuCloser() {
  useEffect(() => {
    /** Closes every open dropdown but one; returns how many it closed. */
    const closeAll = (except?: Element | null) => {
      let n = 0;
      document.querySelectorAll("details.dd[open]").forEach((d) => d !== except && (d.removeAttribute("open"), n++));
      return n;
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      const dd = t.closest("details.dd");
      if (dd && t.closest(".dd-menu a, .dd-menu button")) {
        // A keyboard pick (Enter on a menu button) keeps focus on the menu's toggle.
        const inside = dd.contains(document.activeElement);
        closeAll();
        if (inside) refocus(dd);
        return;
      }
      closeAll(dd);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the menu focus is in and goes back to its toggle. Cancelling the key also
      // keeps a dialog around the menu (the component modal) open: one Escape, one layer.
      const dd = (document.activeElement as Element | null)?.closest("details.dd[open]");
      if (dd) {
        dd.removeAttribute("open");
        refocus(dd);
        e.preventDefault();
      } else if (closeAll()) e.preventDefault();
    };
    // Tabbing past a menu's last item closes it, so it never covers what has focus next.
    // No relatedTarget means a click on nothing focusable: the click handler covers that.
    const onFocusOut = (e: FocusEvent) => {
      const dd = (e.target as Element).closest?.("details.dd[open]");
      const to = e.relatedTarget as Node | null;
      if (dd && to && !dd.contains(to)) dd.removeAttribute("open");
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return null;
}
