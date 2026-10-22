import Link from "next/link";
import type { Layer, Option } from "@/lib/types";
import { optionHref } from "@/lib/links";
import { Logo } from "./Logo";

export type Module = { layer: Pick<Layer, "id" | "name" | "band">; picks: Pick<Option, "id" | "name" | "note" | "logo">[] };

type Band = Layer["band"];

// The floorplan of an abstract motherboard. Each band of the stack is a region of the board:
// surface is the rear I/O strip, brain the processor area, hands the expansion slots,
// files the memory slots down the side, ops the power components along the bottom.
const ZONE: Record<Band, string> = { surface: "io", brain: "cpu", hands: "pcie", files: "ram", ops: "power" };
// Silkscreen reference designators: J connectors, U chips, Q drivers, M memory, P power.
const PREFIX: Record<Band, string> = { surface: "J", brain: "U", hands: "Q", files: "M", ops: "P" };
const BANDS: Band[] = ["surface", "brain", "hands", "files", "ops"];
// The processor sockets.
const CORE = new Set(["model", "harness"]);

/** grid-template-areas for whichever regions this stack actually uses. */
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
  mini?: boolean;
  label?: string;
  /** Editor hooks: when present, chips get a remove button and modules an add slot. */
  onRemove?: (layerId: string, optionId: string) => void;
  addSlot?: (layerId: string) => React.ReactNode;
  /** Extra slots, placed with the power components. */
  children?: React.ReactNode;
};

export function Board({ modules, mini = false, label, onRemove, addSlot, children }: Props) {
  const byBand = BANDS.map((band) => ({ band, mods: modules.filter((m) => m.layer.band === band) }));
  const has: Record<string, boolean> = {};
  for (const { band, mods } of byBand) has[ZONE[band]] = mods.length > 0;
  if (children) has.power = true;
  const { areas, cols } = floorplan(has);

  return (
    <div
      className={mini ? "board mini" : "board"}
      style={{ "--areas": areas, "--cols": cols } as React.CSSProperties}
    >
      {byBand.map(({ band, mods }) => {
        const extra = band === "ops" ? children : null;
        if (!mods.length && !extra) return null;
        return (
          <div key={band} className={`zone ${ZONE[band]}`}>
            {mods.map((m, i) => {
              const core = CORE.has(m.layer.id);
              return (
                <section
                  key={m.layer.id}
                  className={core ? "module core" : "module"}
                  aria-label={m.layer.name}
                  title={mini ? `${m.layer.name}: ${m.picks.map((p) => p.name).join(", ")}` : undefined}
                >
                  {!mini && (
                    <header className="silk">
                      <span className="ref">
                        {PREFIX[band]}
                        {i + 1}
                      </span>
                      <Link href={`/layer/${m.layer.id}/`}>{m.layer.name}</Link>
                    </header>
                  )}
                  <div className="chips">
                    {m.picks.map((p) => (
                      <div key={p.id} className="chip">
                        <Logo option={p} />
                        {mini ? (
                          <Link href={optionHref(m.layer.id, p.id)} className="chip-link" aria-label={p.name} />
                        ) : (
                          <span className="chip-text">
                            <Link href={optionHref(m.layer.id, p.id)} className="chip-link chip-name">
                              {p.name}
                            </Link>
                            {p.note && <span className="chip-note">{p.note}</span>}
                          </span>
                        )}
                        {onRemove && (
                          <button
                            className="x"
                            aria-label={`Remove ${p.name}`}
                            onClick={() => onRemove(m.layer.id, p.id)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {addSlot?.(m.layer.id)}
                  </div>
                </section>
              );
            })}
            {extra}
          </div>
        );
      })}
      {label && !mini && <div className="board-label">{label}</div>}
    </div>
  );
}
