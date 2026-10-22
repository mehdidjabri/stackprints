import { getLayers } from "@/lib/data";
import type { Knowable } from "@/lib/disclosure";
import type { Layer, Option, Stack } from "@/lib/types";
import { Board } from "./Board";

type Row = { layer: Layer; picks: Option[] };

/** Server-rendered board with the fixed floorplan: every layer has a slot, used or not. */
export function StackView({
  rows,
  stack,
  compact = false,
  label,
  prompts,
}: {
  rows: Row[];
  stack?: Knowable & Pick<Stack, "supports">;
  compact?: boolean;
  label?: string;
  prompts?: string[];
}) {
  const slots = getLayers().map(({ id, name, band, ref }) => ({ id, name, band, ref }));
  return <Board modules={rows} slots={slots} mini={compact} label={label} stack={stack} prompts={prompts} />;
}
