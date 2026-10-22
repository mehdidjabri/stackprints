export type Option = {
  id: string;
  name: string;
  /** Domain or URL, no protocol needed. */
  url?: string;
  /** 3–8 word descriptor. */
  note?: string;
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
  /** layerId -> optionId (or several). Missing layers are simply not part of the stack. */
  layers: Record<string, string | string[]>;
};

/** A user-made stack, stored locally and in share links. */
export type Draft = {
  name: string;
  from?: string;
  layers: Record<string, string[]>;
};
