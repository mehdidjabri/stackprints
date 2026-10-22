import type { Layer } from "./types";

// Ordered top (what starts a run and where results land) to bottom (what keeps it running).
// Brain and hands follow Anthropic's Managed Agents split: brain = model + harness, hands = tools and sandboxes.
export const BANDS: [Layer["band"], string][] = [
  ["surface", "Surface"],
  ["brain", "Brain"],
  ["hands", "Hands"],
  ["files", "Files"],
  ["ops", "Ops"],
];
