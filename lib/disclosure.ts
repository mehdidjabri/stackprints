import type { Stack } from "./types";

type Disclosure = NonNullable<Stack["disclosure"]>;

// What an empty slot means depends on how much of the stack is knowable.
// Two empty states only: hatched = not disclosed (unknown), dashed = not used.
export const DISCLOSURE: Record<Disclosure, { badge: string; about: string; empty: string | null }> = {
  "open-source": { badge: "Open source", about: "Built from the public code", empty: null },
  documented: { badge: "Documented", about: "Built from the vendor's docs", empty: "Not disclosed" },
  closed: { badge: "Closed", about: "Inferred from public sources", empty: "Not disclosed" },
  example: { badge: "Example", about: "An example design, not a product", empty: null },
};

/** The label an unused slot gets on this stack, or null when empty simply means "not used". */
export const unknownLabel = (d?: Stack["disclosure"]) => (d ? DISCLOSURE[d].empty : null);

/** Lowercase marker for cards and menus. Open source is the plain case and goes unmarked. */
export const disclosureMark = (d?: Stack["disclosure"]) => (d && d !== "open-source" ? DISCLOSURE[d].badge.toLowerCase() : null);

/** One sentence on how to read the empty slots of a stack. */
export function slotsNote(d: Stack["disclosure"], confirmedAbsent: number) {
  if (!unknownLabel(d)) return "Dashed slots are not used.";
  return `Hatched slots are not disclosed: unknown, not absent.${confirmedAbsent ? " Dashed slots are confirmed not used." : ""}`;
}
