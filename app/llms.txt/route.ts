import { llmsTxt } from "@/lib/agent";

export const dynamic = "force-static";

// Agent-readable guide to the whole site (llmstxt.org).
export function GET() {
  return new Response(llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
