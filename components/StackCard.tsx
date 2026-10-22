import Link from "next/link";
import { resolve } from "@/lib/data";
import { primaryLink, prettyUrl } from "@/lib/links";
import type { Stack } from "@/lib/types";
import { StackView } from "./StackView";

export function StackCard({ stack }: { stack: Stack }) {
  const rows = resolve(stack);
  const site = primaryLink(stack.links);
  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <Link href={`/stack/${stack.slug}/`} className="card-link">
            {stack.name}
          </Link>
        </h3>
        <span className="kind">{stack.kind}</span>
      </div>
      <p className="card-tag">{stack.tagline}</p>
      <StackView rows={rows} compact />
      {site && (
        <a className="card-site" href={site} rel="noopener">
          {prettyUrl(site)} ↗
        </a>
      )}
    </div>
  );
}
