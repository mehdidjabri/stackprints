import { agentFiles } from "@/lib/agent";

export const dynamic = "force-static";

// Build-time only: scripts/agent-files.mjs splits this into individual files in out/ and deletes it.
export function GET() {
  return Response.json(agentFiles());
}
