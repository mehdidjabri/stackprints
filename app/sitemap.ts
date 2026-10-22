import type { MetadataRoute } from "next";
import { BUILT } from "@/lib/agent";
import { SITE, getLayers, getStacks } from "@/lib/data";
import { kindHref } from "@/lib/links";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const u = (p: string) => `${SITE.url}${p}`;
  return [
    { url: u("/"), priority: 1, changeFrequency: "weekly", lastModified: BUILT },
    { url: u("/layers/"), priority: 0.8, changeFrequency: "weekly", lastModified: BUILT },
    { url: u("/trending/"), priority: 0.8, changeFrequency: "daily", lastModified: BUILT },
    { url: u("/api/"), priority: 0.6, lastModified: BUILT },
    { url: u("/about/"), priority: 0.4, lastModified: BUILT },
    { url: u("/contact/"), priority: 0.3, lastModified: BUILT },
    { url: u("/privacy/"), priority: 0.2, lastModified: BUILT },
    { url: u("/submit/"), priority: 0.5, lastModified: BUILT },
    { url: u("/contribute/"), priority: 0.3, lastModified: BUILT },
    ...getStacks().map((s) => ({ url: u(`/stack/${s.slug}/`), priority: 0.9, changeFrequency: "weekly" as const, lastModified: s.researched ?? BUILT })),
    ...[...new Set(getStacks().map((s) => s.kind))].map((k) => ({ url: u(kindHref(k)), priority: 0.7, changeFrequency: "weekly" as const, lastModified: BUILT })),
    ...getLayers().map((l) => ({ url: u(`/layer/${l.id}/`), priority: 0.7, changeFrequency: "weekly" as const, lastModified: BUILT })),
    ...getLayers().flatMap((l) =>
      l.options.map((o) => ({
        url: u(`/layer/${l.id}/${o.id}/`),
        priority: 0.6,
        changeFrequency: "weekly" as const,
        lastModified: o.researched ?? BUILT,
      })),
    ),
  ];
}
