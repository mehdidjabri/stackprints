import type { MetadataRoute } from "next";
import { SITE, getLayers, getStacks } from "@/lib/data";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const u = (p: string) => `${SITE.url}${p}`;
  return [
    { url: u("/"), priority: 1, changeFrequency: "weekly" },
    { url: u("/layers/"), priority: 0.8, changeFrequency: "weekly" },
    { url: u("/submit/"), priority: 0.5 },
    { url: u("/contribute/"), priority: 0.3 },
    ...getStacks().map((s) => ({ url: u(`/stack/${s.slug}/`), priority: 0.9, changeFrequency: "weekly" as const })),
    ...getLayers().map((l) => ({ url: u(`/layer/${l.id}/`), priority: 0.7, changeFrequency: "weekly" as const })),
  ];
}
