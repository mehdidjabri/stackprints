import type { MetadataRoute } from "next";
import { SITE } from "@/lib/data";

export const dynamic = "force-static";

// Everything here is public and meant to be read and cited, by people and by agents.
// AI search crawlers and user-initiated agent fetches are named explicitly so the intent is unambiguous.
const AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }, ...AGENTS.map((userAgent) => ({ userAgent, allow: "/" }))],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
