import { Fragment } from "react";
import { type Part, type Slot, type Token, lines, strip } from "@/lib/simple";

/** A part in a sentence: its mark when it has one (no monogram tiles here), and how it's said. */
function PartWord({ part }: { part: Part }) {
  return (
    <span className="t" title={`${part.name}${part.note ? `: ${part.note}` : ""}${part.supported ? " (configurable, not the default)" : ""}`}>
      {part.logo && (
        <svg className="logo" aria-hidden="true">
          <use href={`/logos.svg#${part.logo}`} />
        </svg>
      )}
      {part.say ?? part.name}
      {part.supported && <span className="sup">configurable</span>}
    </span>
  );
}

function Word({ token, blueprint }: { token: Token; blueprint: string }) {
  if (typeof token === "string") return <>{token}</>;
  if ("part" in token && !("verb" in token)) return <PartWord part={token.part} />;
  if ("verb" in token)
    return (
      <span className="v" title={token.title}>
        {token.verb}
        {token.part && (
          <>
            {" "}
            <PartWord part={token.part} /> tools
          </>
        )}
      </span>
    );
  if ("unknown" in token) return <span className="nd">{token.unknown}</span>;
  if ("present" in token)
    return (
      <span className="q">
        <b aria-hidden="true">?</b>
        {token.present}
      </span>
    );
  if ("unused" in token) return <span className="nu">{token.unused}</span>;
  // The rest of a long list is in the blueprint, which this switches to.
  return (
    <label htmlFor={blueprint} className="more" title={token.names.join(", ")}>
      {token.more}
    </label>
  );
}

/**
 * The simple view: the stack in five sentences, one per band, in board order. Glue words recede and
 * the parts stand out, so reading only the dark words gives the stack. The strip under them is every
 * layer as a cell, the blueprint's fingerprint, and switches to it.
 */
export function Simple({ name, slots, blueprint }: { name: string; slots: Slot[]; blueprint: string }) {
  const { summary, bands } = strip(slots);
  return (
    <div className="simple">
      <ul className="lines">
        {lines(name, slots).map(({ band, tokens }) => (
          <li key={band} className={`b-${band}`}>
            {tokens.map((t, i) => (
              <Fragment key={i}>
                <Word token={t} blueprint={blueprint} />
              </Fragment>
            ))}
          </li>
        ))}
      </ul>
      <label htmlFor={blueprint} className="print">
        <span className="cells" aria-hidden="true">
          {bands.map(({ band, cells }) => (
            <span key={band} className={`band b-${band}`}>
              {cells.map((c) => (
                <span key={c.id} className={`cell ${c.state}`} title={c.title} />
              ))}
            </span>
          ))}
        </span>
        <span>{summary}</span>
        <span className="go">Blueprint →</span>
      </label>
    </div>
  );
}
