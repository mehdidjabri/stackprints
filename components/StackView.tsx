import { getLayers } from "@/lib/data";
import { unknownLabel } from "@/lib/disclosure";
import type { Layer, Option, Stack } from "@/lib/types";
import { Board } from "./Board";

type Row = { layer: Layer; picks: Option[] };

/** Server-rendered board with the fixed floorplan: every layer has a slot, used or not. */
export function StackView({
  rows,
  stack,
  compact = false,
  label,
}: {
  rows: Row[];
  stack?: Pick<Stack, "disclosure" | "notUsed">;
  compact?: boolean;
  label?: string;
}) {
  const slots = getLayers().map(({ id, name, band, ref }) => ({ id, name, band, ref }));
  return (
    <Board
      modules={rows}
      slots={slots}
      mini={compact}
      label={label}
      unknown={unknownLabel(stack?.disclosure)}
      notUsed={stack?.notUsed}
    />
  );
}
