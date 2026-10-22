import type { Stack } from "./types";

type Disclosure = NonNullable<Stack["disclosure"]>;

// What an empty slot means depends on how much of the stack is knowable.
export const DISCLOSURE: Record<Disclosure, { badge: string; about: string; empty: string | null }> = {
  "open-source": { badge: "Open source", about: "Built from the public code", empty: null },
  documented: { badge: "Documented", about: "Closed, built from the vendor's docs", empty: "Not documented" },
  closed: { badge: "Closed", about: "Inferred from public sources", empty: "Not disclosed" },
  example: { badge: "Example", about: "An example design, not a product", empty: null },
};

/** The label an unused slot gets on this stack, or null when empty simply means "not used". */
export const unknownLabel = (d?: Stack["disclosure"]) => (d ? DISCLOSURE[d].empty : null);
