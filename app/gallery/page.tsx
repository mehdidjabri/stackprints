import type { Metadata } from "next";
import { Gallery, type Tile } from "@/components/Gallery";
import { Title } from "@/components/Title";
import { getStacks } from "@/lib/data";

export const metadata: Metadata = {
  title: "Gallery: every agent in its own stone",
  description: "Every AI agent stack as a square of polished ceramic, each with its own mix, its own colours and its own light. Open one to see how it is built.",
  alternates: { canonical: "/gallery/" },
  openGraph: { type: "website", url: "/gallery/", title: "Stackprints / Gallery", images: "/opengraph-image" },
};

/** The mark a tile wears without a logo: as components/Logo.tsx makes it. */
function monogram(name: string) {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return (words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((w) => w[0]).join("")).toUpperCase();
}

export default function GalleryPage() {
  const tiles: Tile[] = getStacks().map((s) => ({ slug: s.slug, name: s.name, logo: s.logo, mono: monogram(s.name) }));
  return (
    <>
      <Title detail="Gallery" />
      <Gallery tiles={tiles}>Every agent in its own stone: the mix, the colours in its grains and the light on it are its own. Open one to see how it is built.</Gallery>
    </>
  );
}
