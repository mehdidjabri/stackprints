"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionLink } from "./SectionLink";

/**
 * The header's links, with the section you're in marked: aria-current "page" on the section's own page,
 * "true" on the pages under it. Prerendered, so every page's HTML already carries its mark.
 */
export function PrimaryNav() {
  const p = (usePathname() || "/").replace(/\/+$/, "") || "/";
  const at = (page: string, under?: RegExp) => (p === page ? "page" : under?.test(p) ? "true" : undefined);
  return (
    <nav aria-label="Primary">
      <Link href="/trending/" aria-current={at("/trending")}>
        Trending
      </Link>
      {/* The stacks live on the home page (/#stacks): only a stack's or a kind's own page marks it. */}
      <SectionLink id="stacks" current={at("", /^\/stacks?\//)}>
        Stacks
      </SectionLink>
      <Link href="/gallery/" aria-current={at("/gallery")}>
        Gallery
      </Link>
      <Link href="/layers/" aria-current={at("/layers", /^\/layer\//)}>
        Layers
      </Link>
      <Link href="/mine/" aria-current={at("/mine")}>
        Mine
      </Link>
      <Link href="/contribute/" aria-current={at("/contribute", /^\/submit$/)}>
        Contribute
      </Link>
    </nav>
  );
}
