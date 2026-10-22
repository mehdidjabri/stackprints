import Link from "next/link";
import { getLayers, resolve } from "@/lib/data";
import { EMPTY, disclosureMark, disclosureOf, emptyLayers } from "@/lib/disclosure";
import { primaryLink, prettyUrl } from "@/lib/links";
import type { Stack } from "@/lib/types";
import { Logo } from "./Logo";
import { StackView } from "./StackView";
import { Ext } from "./Ext";

export function StackCard({ stack }: { stack: Stack }) {
  const rows = resolve(stack);
  const site = primaryLink(stack.links);
  // Example designs, documented and closed stacks say so on the card, so none passes for an open, real product.
  const mark = disclosureMark(stack);
  // The board in words, as the stack page's meta line says it: the mini board is a picture only.
  const empty = emptyLayers(stack, getLayers());
  const summary = [
    `${rows.length} ${empty.unknown.length + empty.present.length ? "known layers" : "layers"}`,
    empty.present.length && `${empty.present.length} in use, undisclosed`,
    empty.unknown.length && `${empty.unknown.length} ${EMPTY.unknown.toLowerCase()}`,
    empty.unused.length && `${empty.unused.length} ${EMPTY.unused.toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");
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
      <p className="card-summary" title={summary}>
        {summary}
      </p>
      {/* The board goes to the stack too. Above the card's link so its slots keep their tooltips;
          hidden from the keyboard and screen readers, which have the title link and the line above. */}
      <Link href={`/stack/${stack.slug}/`} className="card-board" tabIndex={-1} aria-hidden="true">
        <StackView rows={rows} stack={stack} compact />
      </Link>
      {site && (
        <a className="card-site" href={site} rel="noopener">
          {prettyUrl(site)}
          <Ext />
        </a>
      )}
    </div>
  );
}

/** The empty states the cards use, same swatches as the board legend. */
export function CardLegend({ stacks }: { stacks: Stack[] }) {
  return (
    <span className="legend">
      <span className="lg-unknown">
        <i />
        {EMPTY.unknown}
      </span>
      {stacks.some((s) => s.inUseUndisclosed?.length) && (
        <span className="lg-present">
          <i />
          {EMPTY.present}
        </span>
      )}
      <span className="lg-empty">
        <i />
        {EMPTY.unused}
      </span>
    </span>
  );
}
