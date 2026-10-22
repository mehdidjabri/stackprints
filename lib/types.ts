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

  // Research, see docs/RESEARCH.md. Everything below is optional and verified.
  /** Decides the layout of the option's page. */
  profile?: "model" | "product" | "protocol" | "pattern";
  summary?: string;
  /** Datasheet rows: [label, value]. */
  facts?: [string, string][];
  links?: Partial<Record<"site" | "docs" | "repo" | "pricing" | "changelog" | "blog" | "x", string>>;
  goodFor?: string[];
  watchOut?: string[];
  /** Pattern steps. */
  how?: string[];
  model?: {
    lab?: string;
    released?: string;
    context?: string;
    priceIn?: string;
    priceOut?: string;
    modalities?: string[];
    weights?: "open" | "closed";
    openrouter?: string;
  };
  researched?: string;
};

export type NewsItem = { date: string; title: string; url: string; source: string };
export type News = { updated: string; items: NewsItem[] };

export type Layer = {
  id: string;
  name: string;
  /** Which band of the stack the layer belongs to. */
  band: "surface" | "brain" | "hands" | "files" | "ops";
  /** Fixed silkscreen designator on the board, e.g. J1, U2, DIMM1, PS1. */
  ref: string;
  description: string;
  options: Option[];
};

export type Stack = {
  slug: string;
  name: string;
  /** The product's mark, a file name in content/logos (real products only). */
  logo?: string;
  tagline: string;
  description: string;
  kind: string;
  /**
   * How much of the stack is knowable, which decides what an empty slot means:
   * open-source and example stacks: not used; documented: not documented; closed: not disclosed.
   */
  disclosure?: "open-source" | "documented" | "closed" | "example";
  /** Public sources the stack is built from. */
  sources?: { title: string; url: string }[];
  /** Per layer: URLs (from sources) that back up the picks. */
  evidence?: Record<string, string[]>;
  /** Layers confirmed absent, even on a closed stack. */
  notUsed?: string[];
  researched?: string;
  /** Official links for stacks that are real products. Full https URLs. */
  links?: Partial<Record<"site" | "repo" | "docs" | "announcement", string>>;
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
