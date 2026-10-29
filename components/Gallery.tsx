"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type Tile = { slug: string; name: string; logo?: string; mono: string };

/**
 * Every agent as a square of polished ceramic, its own: the mix of the stone, the colours in its
 * grains and the light on it all come from the agent (components/gallery/granite.wgsl). WebGPU draws
 * them; until it does, and where it can't, each tile is its logo on a dark square in CSS.
 */
export function Gallery({ tiles, children }: { tiles: Tile[]; children: React.ReactNode }) {
  const root = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let gone = false;
    let stop: (() => void) | undefined;
    (async () => {
      // vgpu is WebGPU only: without an adapter the CSS tiles stay, and the renderer is never loaded.
      if (!navigator.gpu || !(await navigator.gpu.requestAdapter().catch(() => null))) return;
      const { mountTiles } = await import("./gallery/render");
      // React may have unmounted us meanwhile (and in development mounts twice): start nothing then
      if (gone) return;
      const off = await mountTiles(el, matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (gone) off();
      else stop = off;
    })().catch(() => {});
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  return (
    <div className="gallery">
      <p className="lede">{children}</p>
      <ul className="gallery-grid" ref={root}>
        {tiles.map((t) => (
          <li key={t.slug}>
            <Link href={`/stack/${t.slug}/#exploded`} className="gallery-tile">
              <span className="gallery-square">
                <span className="gallery-css" aria-hidden="true">
                  {t.logo ? (
                    <svg>
                      <use href={`/logos.svg#${t.logo}`} />
                    </svg>
                  ) : (
                    <b>{t.mono}</b>
                  )}
                </span>
                <canvas data-slug={t.slug} data-logo={t.logo} data-mono={t.mono} aria-hidden="true" />
              </span>
              <span className="gallery-name">{t.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
