import { getLayers, getStacks } from "@/lib/data";
import { optionHref } from "@/lib/links";

export const dynamic = "force-static";

// Compact search index, fetched by the header search box on first focus.
// Rows: [kind, title, subtitle, href, logo, extra text searched but not shown]
export function GET() {
  const rows: [string, string, string, string, string, string][] = [];
  for (const l of getLayers()) {
    rows.push(["layer", l.name, l.description, `/layer/${l.id}/`, "", ""]);
    for (const o of l.options)
      rows.push(["option", o.name, `${l.name} · ${o.note ?? ""}`, optionHref(l.id, o.id), o.logo ?? "", `${o.url ?? ""} ${o.summary ?? ""}`]);
  }
  for (const s of getStacks()) rows.push(["stack", s.name, `${s.kind} · ${s.tagline}`, `/stack/${s.slug}/`, s.logo ?? "", s.description]);
  return Response.json(rows);
}
