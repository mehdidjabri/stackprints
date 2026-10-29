import type { MetadataRoute } from "next";
import { BUILT } from "@/lib/agent";
import { SITE, getLayers, getStacks, layerDate, layersDate, newsDate, optionDate, siteDate, stacksDate } from "@/lib/data";
import { kindHref } from "@/lib/links";

export const dynamic = "force-static";

// lastmod is when a page last changed in substance (lib/data.ts dates), never just the build.
// Hand-written pages carry none: no date here would be honest without a changelog.
export default function sitemap(): MetadataRoute.Sitemap {
  const u = (p: string) => `${SITE.url}${p}`;
  const stacks = getStacks();
  return [
    { url: u("/"), priority: 1, changeFrequency: "weekly", lastModified: siteDate() ?? BUILT },
    { url: u("/layers/"), priority: 0.8, changeFrequency: "weekly", lastModified: layersDate() ?? BUILT },
    { url: u("/trending/"), priority: 0.8, changeFrequency: "weekly", lastModified: newsDate() ?? BUILT },
    { url: u("/gallery/"), priority: 0.6, changeFrequency: "weekly", lastModified: stacksDate(stacks) ?? BUILT },
    { url: u("/api/"), priority: 0.6 },
    { url: u("/about/"), priority: 0.4 },
    { url: u("/contact/"), priority: 0.3 },
    { url: u("/privacy/"), priority: 0.2 },
    { url: u("/submit/"), priority: 0.5 },
    { url: u("/contribute/"), priority: 0.3 },
    ...stacks.map((s) => ({ url: u(`/stack/${s.slug}/`), priority: 0.9, changeFrequency: "weekly" as const, lastModified: s.researched ?? BUILT })),
    ...[...new Set(stacks.map((s) => s.kind))].map((k) => ({
      url: u(kindHref(k)),
      priority: 0.7,
      changeFrequency: "weekly" as const,
      lastModified: stacksDate(stacks.filter((s) => s.kind === k)) ?? BUILT,
    })),
    ...getLayers().map((l) => ({ url: u(`/layer/${l.id}/`), priority: 0.7, changeFrequency: "weekly" as const, lastModified: layerDate(l) ?? BUILT })),
    ...getLayers().flatMap((l) =>
      l.options.map((o) => ({
        url: u(`/layer/${l.id}/${o.id}/`),
        priority: 0.6,
        changeFrequency: "weekly" as const,
        lastModified: optionDate(l.id, o) ?? BUILT,
      })),
    ),
  ];
}
