import { SITE, getLayers, getStacks, resolve } from "@/lib/data";

export const dynamic = "force-static";

// Agent-readable summary of the whole site (llmstxt.org).
export function GET() {
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    "Machine-readable data: /stacks.json",
    "",
    "## Stacks",
    "",
    ...getStacks().flatMap((s) => [
      `### ${s.name} (${s.kind})`,
      "",
      s.description,
      "",
      ...resolve(s).map((r) => `- ${r.layer.name}: ${r.picks.map((p) => p.name).join(", ")}`),
      "",
    ]),
    "## Layers",
    "",
    ...getLayers().map(
      (l) => `- [${l.name}](${SITE.url}/layer/${l.id}/): ${l.description} Options: ${l.options.map((o) => o.name).join(", ")}.`,
    ),
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
