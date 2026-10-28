import { type Slot, lines, sentence, strip } from "@/lib/simple";
import { Hourglass } from "./Hourglass";

/**
 * The simple view: the stack as an hourglass, memory at its heart (see Hourglass). The five sentences
 * it stands for stay in the page for screen readers and search; the line under it counts what is
 * known and switches to the blueprint.
 */
export function Simple({ name, slots, blueprint }: { name: string; slots: Slot[]; blueprint: string }) {
  const said = lines(name, slots).map((l) => sentence(l.tokens));
  const { summary } = strip(slots);
  return (
    <div className="simple">
      <Hourglass slots={slots} label={said.join(" ")} />
      <ul className="sr-only">
        {said.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <label htmlFor={blueprint} className="print">
        <span>{summary}</span>
        <span className="go">Blueprint →</span>
      </label>
    </div>
  );
}
