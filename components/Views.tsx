import { ViewMemory } from "./ViewMemory";

/**
 * Three depths of one stack: simple (the hourglass), exploded (the teardown, with how one run goes)
 * and the blueprint (every layer on the board). Radios switch them with CSS alone, so all three are in
 * the page for readers and search engines, it works without JavaScript, and anything labelled for a
 * radio (the line under the hourglass, say) switches to it. ViewMemory keeps the choice.
 */
export function Views({
  id,
  simple,
  exploded,
  blueprint,
  bar,
  after,
}: {
  id: string;
  simple: React.ReactNode;
  exploded: React.ReactNode;
  blueprint: React.ReactNode;
  /** The page's own buttons, on the switch's row at its left. */
  bar?: React.ReactNode;
  /** Anything those buttons open, between their row and the views. */
  after?: React.ReactNode;
}) {
  return (
    <div className="views" id={id}>
      <div className="view-bar">
        {bar}
        <div className="view-switch" role="radiogroup" aria-label="View">
          <input type="radio" name={id} id={`${id}-simple`} value="simple" defaultChecked className="sr-only" />
          <label htmlFor={`${id}-simple`}>Simple</label>
          <input type="radio" name={id} id={`${id}-exploded`} value="exploded" className="sr-only" />
          <label htmlFor={`${id}-exploded`}>Exploded</label>
          <input type="radio" name={id} id={`${id}-blueprint`} value="blueprint" className="sr-only" />
          <label htmlFor={`${id}-blueprint`}>Blueprint</label>
        </div>
      </div>
      {after}
      <div className="view view-simple">{simple}</div>
      <div className="view view-exploded">{exploded}</div>
      <div className="view view-blueprint">{blueprint}</div>
      <ViewMemory id={id} />
    </div>
  );
}

export const blueprintFor = (id: string) => `${id}-blueprint`;
