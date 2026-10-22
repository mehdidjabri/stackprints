export type Option = {
  /** Must match the file name in content/options/<layer>/. */
  id: string;
  /** Position within the layer. Leave it out when submitting; you'll be listed alphabetically after curated options. */
  order?: number;
  name: string;
  /** Domain or URL, no protocol needed. */
  url?: string;
  /** 3–8 word descriptor. */
  note?: string;
  /** File name (no extension) of a mark in content/logos. */
  logo?: string;
  /** Open source / open weights. */
  open?: boolean;
};

export type Layer = {
  id: string;
  name: string;
  /** Which band of the stack the layer belongs to. */
  band: "surface" | "brain" | "hands" | "files" | "ops";
  description: string;
  options: Option[];
};

export type Stack = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  kind: string;
  source?: string;
  /** Who made or submitted the stack. Personal stacks are welcome. */
  author?: { name: string; url?: string };
  /** layerId -> optionId (or several). Missing layers are simply not part of the stack. */
  layers: Record<string, string | string[]>;
};

/** A user-made stack, stored locally and in share links. */
export type Draft = {
  name: string;
  from?: string;
  layers: Record<string, string[]>;
};
