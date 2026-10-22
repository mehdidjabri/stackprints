"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A link to a section of the home page. On the home page it scrolls there without touching the
 * URL hash, which holds the stack being edited (#s=… or #from=…), so a reload doesn't lose it.
 */
export function SectionLink({ id, current, children }: { id: string; current?: "page" | "true"; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <Link
      href={`/#${id}`}
      aria-current={current}
      onClick={(e) => {
        const el = path === "/" ? document.getElementById(id) : null;
        if (!el || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }}
    >
      {children}
    </Link>
  );
}
