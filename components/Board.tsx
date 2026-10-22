import Link from "next/link";
import { EMPTY, type Knowable, emptyState, isSupported } from "@/lib/disclosure";
import { optionHref } from "@/lib/links";
import type { Layer, Option, Stack } from "@/lib/types";
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
  /** What the empty slots of this stack mean (see lib/disclosure), and which picks are only supported. */
  stack?: Knowable & Pick<Stack, "supports">;
  /** Whose disclosure the empty slots follow when it isn't this board's own (a remix): named in the legend. */
  source?: string;
  /** Editor hooks: remove a pick, add to a filled module, fill an empty slot. */
  onRemove?: (layerId: string, optionId: string) => void;
  addSlot?: (layerId: string) => React.ReactNode;
  emptySlot?: (layer: Slot) => React.ReactNode;
};

export function Board({ modules, slots, mini = false, label, stack, source, onRemove, addSlot, emptySlot }: Props) {
  const filled = new Map(modules.map((m) => [m.layer.id, m]));
  const all = slots ?? modules.map((m) => m.layer);
  // The kinds of empty slot this board draws, for the legend.
  const empties = new Set(slots ? all.filter((l) => !filled.has(l.id)).map((l) => emptyState(stack, l.id)) : []);

  const has: Record<string, boolean> = {};
  for (const l of all) has[ZONE[l.band]] = true;
  const { areas, cols } = floorplan(has);

  const renderSlot = (layer: Slot) => {
    const m = filled.get(layer.id);
    const core = CORE.has(layer.id);
    if (!m) {
      // Hatched: not disclosed. Outlined with a "?": in use, component not named. Dashed: not used.
      const state = emptyState(stack, layer.id);
      const text = EMPTY[state];
      return (
        <section
          key={layer.id}
          className={`module empty${core ? " core" : ""}${state === "unused" ? "" : ` ${state}`}`}
          aria-label={`${layer.name}: ${text.toLowerCase()}`}
          title={mini || state !== "unused" ? `${layer.name}: ${text.toLowerCase()}` : undefined}
        >
          {!mini && (
            <header className="silk">
              <span className="ref">{layer.ref}</span>
              <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
            </header>
          )}
          {/* Every empty state says what it is. In the editor a dashed slot's picker says it for "not used". */}
          {!mini && (!emptySlot || state !== "unused") && (
            <span className="unknown-label">
              {state === "present" && <b className="q" aria-hidden="true">?</b>}
              {text}
            </span>
          )}
          {mini && state === "present" && <b className="q" aria-hidden="true">?</b>}
          {!mini && emptySlot?.(layer)}
        </section>
      );
    }
    // What the stack runs comes first; picks it only supports follow, marked as such.
    const sup = (p: { id: string }) => isSupported(stack, layer.id, p.id);
    const ordered = [...m.picks.filter((p) => !sup(p)), ...m.picks.filter(sup)];
    const supportedLabel = m.picks.some((p) => !sup(p)) ? "Also supported" : "Supported";
    const picks = mini ? ordered.filter((p) => p.logo).slice(0, MINI_MARKS[layer.id] ?? 1) : ordered;
    return (
      <section
        key={layer.id}
        className={core ? "module core" : "module"}
        aria-label={layer.name}
        title={mini ? `${layer.name}: ${ordered.map((p) => (sup(p) ? `${p.name} (supported)` : p.name)).join(", ")}` : undefined}
      >
        {!mini && (
          <header className="silk">
            <span className="ref">{layer.ref}</span>
            <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
            {/* The add control sits on the label line, so it never takes a row of chips. */}
            {addSlot?.(layer.id)}
          </header>
        )}
        <div className="chips">
          {/* Notes are clamped on the board; the tooltip keeps all of it readable. */}
          {picks.map((p) => (
            <div key={p.id} className={sup(p) ? "chip supported" : "chip"} title={!mini && p.note ? `${p.name}: ${p.note}` : undefined}>
              <Logo option={p} />
              {mini ? (
                <Link href={optionHref(layer.id, p.id)} className="chip-link" aria-label={p.name} />
              ) : (
                <span className="chip-text">
                  <Link href={optionHref(layer.id, p.id)} className="chip-link chip-name">
                    {p.name}
                  </Link>
                  {sup(p) ? (
                    <span className="chip-note" title={p.note}>
                      {supportedLabel}
                    </span>
                  ) : (
                    p.note && <span className="chip-note">{p.note}</span>
                  )}
                </span>
              )}
              {onRemove && (
                <button className="x" aria-label={`Remove ${p.name}`} onClick={() => onRemove(layer.id, p.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
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
            {/* Each region names its band in text, so the band never rests on colour alone. */}
            {!mini && (
              <div className="zone-label silk" aria-hidden="true">
                {BAND_NAME[band]}
              </div>
            )}
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
          {empties.has("unknown") && (
            <span className="lg-unknown">
              <i />
              {EMPTY.unknown}
              {source && ` by ${source}`}
            </span>
          )}
          {empties.has("present") && (
            <span className="lg-present">
              <i />
              {EMPTY.present}
              {source && ` by ${source}`}
            </span>
          )}
          {empties.has("unused") && (
            <span className="lg-empty">
              <i />
              {EMPTY.unused}
            </span>
          )}
          {label && <span className="board-label">{label}</span>}
        </div>
      )}
    </div>
  );
}
