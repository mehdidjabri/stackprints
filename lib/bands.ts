import type { Layer } from "./types";

// Ordered top (what users touch) to bottom (what keeps it running).
// Loosely after Guillermo Rauch's "brain, hands, files" framing of agents.
export const BANDS: [Layer["band"], string][] = [
  ["surface", "Surface"],
  ["brain", "Brain"],
  ["hands", "Hands"],
  ["files", "Files"],
  ["ops", "Ops"],
];
