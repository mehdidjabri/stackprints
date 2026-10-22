import type { Stack } from "./types";

type Disclosure = NonNullable<Stack["disclosure"]>;
type Badge = { badge: string; about: string; empty: string | null };
/** What decides how a stack's empty slots read. */
export type Knowable = Pick<Stack, "disclosure" | "notUsed" | "inUseUndisclosed" | "closedLayers">;

// What an empty slot means depends on how much of the stack is knowable.
// Hatched = not disclosed (unknown), dashed = not used; a slot outlined with a "?" is in use but unnamed.
export const DISCLOSURE: Record<Disclosure, Badge> = {
  "open-source": { badge: "Open source", about: "Built from the public code", empty: null },
  documented: { badge: "Documented", about: "Built from the vendor's docs", empty: "Not disclosed" },
  closed: { badge: "Closed", about: "Inferred from public sources", empty: "Not disclosed" },
  example: { badge: "Example", about: "An example design, not a product", empty: null },
};

// Open source with closed parts (closedLayers): not a fifth level, a reading of the first.
const OPEN_CORE: Badge = { badge: "Open core", about: "Open-source core; hosted parts built from the vendor's docs", empty: null };

/** Badge and one-line reading for a stack, open core included. */
export const disclosureOf = (s: Pick<Stack, "disclosure" | "closedLayers">): Badge | undefined =>
  s.disclosure === "open-source" && s.closedLayers?.length ? OPEN_CORE : s.disclosure ? DISCLOSURE[s.disclosure] : undefined;

/** The label an unused slot gets on this stack, or null when empty simply means "not used". */
export const unknownLabel = (d?: Stack["disclosure"]) => (d ? DISCLOSURE[d].empty : null);

/** Lowercase marker for cards and menus. Open source is the plain case and goes unmarked. */
export const disclosureMark = (s: Pick<Stack, "disclosure" | "closedLayers">) => {
  const b = disclosureOf(s);
  return b && b !== DISCLOSURE["open-source"] ? b.badge.toLowerCase() : null;
};

/** A kind's count for menus: "3", or "2 examples" when all its stacks are example designs, as each example says. */
export const kindCount = (xs: Pick<Stack, "disclosure">[]) =>
  xs.every((x) => x.disclosure === "example") ? `${xs.length} example${xs.length > 1 ? "s" : ""}` : String(xs.length);

/** The three ways a slot can be empty, named the same everywhere (board, prose, markdown, API). */
export type Empty = "unknown" | "present" | "unused";
export const EMPTY: Record<Empty, string> = { unknown: "Not disclosed", present: "In use · not disclosed", unused: "Not used" };

/** What an empty slot means on this stack, layer by layer. */
export function emptyState(s: Knowable | undefined, layerId: string): Empty {
  if (s?.inUseUndisclosed?.includes(layerId)) return "present";
  if (s?.notUsed?.includes(layerId)) return "unused";
  return unknownLabel(s?.disclosure) || s?.closedLayers?.includes(layerId) ? "unknown" : "unused";
}

/** A stack's empty layers, grouped by what the emptiness means. */
export function emptyLayers<L extends { id: string }>(s: Knowable & Pick<Stack, "layers">, layers: L[]) {
  const out: Record<Empty, L[]> = { unknown: [], present: [], unused: [] };
  for (const l of layers) if (!(l.id in s.layers)) out[emptyState(s, l.id)].push(l);
  return out;
}

/** One sentence per kind of empty slot on the board, so every style is explained. */
export function slotsNote(e: Record<Empty, unknown[]>) {
  const out = [];
  if (e.unknown.length) out.push("Hatched slots are not disclosed: unknown, not absent.");
  if (e.present.length) out.push("Slots marked ? are in use, but the maker hasn't said with what.");
  if (e.unused.length) out.push(e.unknown.length || e.present.length ? "Dashed slots are confirmed not used." : "Dashed slots are not used.");
  return out.join(" ");
}

/** Whether a pick is only supported (configurable) on this stack, not what it runs by default. */
export const isSupported = (s: Pick<Stack, "supports"> | undefined, layerId: string, optionId: string) =>
  Boolean(s?.supports?.[layerId]?.includes(optionId));
