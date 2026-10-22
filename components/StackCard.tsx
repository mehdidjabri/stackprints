import Link from "next/link";
import { resolve } from "@/lib/data";
import { disclosureMark, disclosureOf } from "@/lib/disclosure";
import { primaryLink, prettyUrl } from "@/lib/links";
import type { Stack } from "@/lib/types";
import { Logo } from "./Logo";
import { StackView } from "./StackView";

export function StackCard({ stack }: { stack: Stack }) {
  const rows = resolve(stack);
  const site = primaryLink(stack.links);
  // Example designs, documented and closed stacks say so on the card, so none passes for an open, real product.
  const mark = disclosureMark(stack);
  return (
    <div className="card">
      <div className="card-head">
        <h3>
          {stack.logo && <Logo option={{ name: stack.name, logo: stack.logo }} />}
          <Link href={`/stack/${stack.slug}/`} className="card-link">
            {stack.name}
          </Link>
        </h3>
        <span className="kind">
          {stack.kind}
          {mark && (
            <>
              {" · "}
              <span title={disclosureOf(stack)!.about}>{mark}</span>
            </>
          )}
        </span>
      </div>
      <p className="card-tag">{stack.tagline}</p>
      <StackView rows={rows} stack={stack} compact />
      {site && (
        <a className="card-site" href={site} rel="noopener">
          {prettyUrl(site)} ↗
        </a>
      )}
    </div>
  );
}
