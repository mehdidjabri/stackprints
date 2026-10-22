import type { Layer, Option } from "@/lib/types";
import { Board } from "./Board";

type Row = { layer: Layer; picks: Option[] };

export function StackView({ rows, compact = false, label }: { rows: Row[]; compact?: boolean; label?: string }) {
  return <Board modules={rows} mini={compact} label={label} />;
}
