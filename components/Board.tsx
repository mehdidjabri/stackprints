import Link from "next/link";
import { optionHref } from "@/lib/links";
import type { Layer, Option } from "@/lib/types";
import { Logo } from "./Logo";

export type Slot = Pick<Layer, "id" | "name" | "band" | "ref">;
export type Module = { layer: Slot; picks: Pick<Option, "id" | "name" | "note" | "logo">[] };

type Band = Layer["band"];

// The floorplan of an abstract motherboard. Each band of the stack is a region of the board:
// surface is the rear I/O strip, brain the processor area, hands the expansion slots,
// files the memory sticks down the side, ops the headers along the bottom edge.
const ZONE: Record<Band, string> = { surface: "io", brain: "cpu", hands: "pcie", files: "ram", ops: "power" };
const BAND_NAME: Record<Band, string> = { surface: "Surface", brain: "Brain", hands: "Hands", files: "Files", ops: "Ops" };
const BANDS: Band[] = ["surface", "brain", "hands", "files", "ops"];
// The processor area is two columns: the harness socket with what shapes it,
// the model socket with what feeds it.
const CPU_COLUMNS = [
  ["harness", "persona", "multiagent"],
  ["model", "router", "inference"],
];
const CORE = new Set(["model", "harness"]);
// Mini boards show one mark per module, except the I/O strip where channels are the fingerprint.
const MINI_MARKS: Record<string, number> = { channels: 4 };

/** grid-template-areas for whichever regions are drawn. */
function floorplan(has: Record<string, boolean>) {
  const side = has.ram && (has.cpu || has.pcie);
  const row = (a: string) => (side ? `"${a} ${a}"` : `"${a}"`);
  const rows: string[] = [];
  if (has.io) rows.push(row("io"));
  if (side) {
    if (has.cpu) rows.push(`"cpu ram"`);
    if (has.pcie) rows.push(`"pcie ram"`);
  } else {
    if (has.cpu) rows.push(row("cpu"));
    if (has.pcie) rows.push(row("pcie"));
    if (has.ram) rows.push(row("ram"));
  }
  if (has.power) rows.push(row("power"));
  return { areas: rows.join(" "), cols: side ? "minmax(0, 1fr) var(--ram-w)" : "minmax(0, 1fr)" };
}

type Props = {
  modules: Module[];
  /** Every layer. When given, the floorplan is fixed: unused layers draw as empty slots. */
  slots?: Slot[];
  mini?: boolean;
  label?: string;
  /** What an empty slot means on this stack ("Not disclosed"), or null when it just isn't used. */
  unknown?: string | null;
  /** Layers confirmed absent: always drawn as "not used", even on a closed stack. */
  notUsed?: string[];
  /** Editor hooks: remove a pick, add to a filled module, fill an empty slot. */
  onRemove?: (layerId: string, optionId: string) => void;
  addSlot?: (layerId: string) => React.ReactNode;
  emptySlot?: (layer: Slot) => React.ReactNode;
};

export function Board({ modules, slots, mini = false, label, unknown, notUsed = [], onRemove, addSlot, emptySlot }: Props) {
  const filled = new Map(modules.map((m) => [m.layer.id, m]));
  const all = slots ?? modules.map((m) => m.layer);

  const has: Record<string, boolean> = {};
  for (const l of all) has[ZONE[l.band]] = true;
  const { areas, cols } = floorplan(has);

  const renderSlot = (layer: Slot) => {
    const m = filled.get(layer.id);
    const core = CORE.has(layer.id);
    if (!m) {
      // Unknown (hatched) on closed stacks unless confirmed absent; otherwise simply not used (dashed).
      const unk = unknown && !notUsed.includes(layer.id) ? unknown : null;
      return (
        <section
          key={layer.id}
          className={`module empty${core ? " core" : ""}${unk ? " unknown" : ""}`}
          aria-label={`${layer.name}: ${unk ?? "not used"}`}
          title={mini ? `${layer.name}: ${unk ?? "not used"}` : undefined}
        >
          {!mini && (
            <header className="silk">
              <span className="ref">{layer.ref}</span>
              <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
            </header>
          )}
          {!mini && unk && !emptySlot && <span className="unknown-label">{unk}</span>}
          {!mini && emptySlot?.(layer)}
        </section>
      );
    }
    const picks = mini ? m.picks.filter((p) => p.logo).slice(0, MINI_MARKS[layer.id] ?? 1) : m.picks;
    return (
      <section
        key={layer.id}
        className={core ? "module core" : "module"}
        aria-label={layer.name}
        title={mini ? `${layer.name}: ${m.picks.map((p) => p.name).join(", ")}` : undefined}
      >
        {!mini && (
          <header className="silk">
            <span className="ref">{layer.ref}</span>
            <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
          </header>
        )}
        <div className="chips">
          {picks.map((p) => (
            <div key={p.id} className="chip">
              <Logo option={p} />
              {mini ? (
                <Link href={optionHref(layer.id, p.id)} className="chip-link" aria-label={p.name} />
              ) : (
                <span className="chip-text">
                  <Link href={optionHref(layer.id, p.id)} className="chip-link chip-name">
                    {p.name}
                  </Link>
                  {p.note && <span className="chip-note">{p.note}</span>}
                </span>
              )}
              {onRemove && (
                <button className="x" aria-label={`Remove ${p.name}`} onClick={() => onRemove(layer.id, p.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
          {!mini && addSlot?.(layer.id)}
        </div>
      </section>
    );
  };

  return (
    <div className={mini ? "board mini" : "board"} style={{ "--areas": areas, "--cols": cols } as React.CSSProperties}>
      {BANDS.map((band) => {
        const layers = all.filter((l) => l.band === band);
        if (!layers.length) return null;
        const zone = ZONE[band];
        return (
          <div key={band} className={`zone ${zone}`} role="group" aria-label={BAND_NAME[band]}>
            {band === "brain"
              ? CPU_COLUMNS.map((col) => {
                  const ls = col.map((id) => layers.find((l) => l.id === id)).filter((l): l is Slot => Boolean(l));
                  // Any brain layer not in the fixed columns (a future addition) joins the second column.
                  if (col === CPU_COLUMNS[1]) ls.push(...layers.filter((l) => !CPU_COLUMNS.flat().includes(l.id)));
                  return ls.length ? (
                    <div key={col[0]} className="cpu-col">
                      {ls.map(renderSlot)}
                    </div>
                  ) : null;
                })
              : layers.map(renderSlot)}
          </div>
        );
      })}
      {!mini && (
        <div className="legend" aria-hidden="true">
          {BANDS.filter((b) => all.some((l) => l.band === b)).map((band) => (
            <span key={band} className={`b-${band}`}>
              <i />
              {BAND_NAME[band]}
            </span>
          ))}
          {slots && all.some((l) => !filled.has(l.id) && unknown && !notUsed.includes(l.id)) && (
            <span className="lg-unknown">
              <i />
              {unknown}
            </span>
          )}
          {slots && all.some((l) => !filled.has(l.id) && (!unknown || notUsed.includes(l.id))) && (
            <span className="lg-empty">
              <i />
              Not used
            </span>
          )}
          {label && <span className="board-label">{label}</span>}
        </div>
      )}
    </div>
  );
}
