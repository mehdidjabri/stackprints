import Link from "next/link";
import type { Layer, Option } from "@/lib/types";
import { Logo } from "./Logo";

export type Module = { layer: Pick<Layer, "id" | "name" | "band">; picks: Pick<Option, "id" | "name" | "note" | "logo">[] };

// Silkscreen reference designators, like on a PCB: J connectors, U chips, Q drivers, M memory, P power.
const PREFIX: Record<Layer["band"], string> = { surface: "J", brain: "U", hands: "Q", files: "M", ops: "P" };
const ORDER: Layer["band"][] = ["surface", "brain", "hands", "files", "ops"];
// The processor sockets of the board get the big tiles.
const CORE = new Set(["model", "harness"]);

const span = (m: Module) => (CORE.has(m.layer.id) ? 6 : Math.min(12, Math.max(3, m.picks.length * 3)));

type Props = {
  modules: Module[];
  mini?: boolean;
  label?: string;
  /** Editor hooks: when present, chips get a remove button and modules an add slot. */
  onRemove?: (layerId: string, optionId: string) => void;
  addSlot?: (layerId: string) => React.ReactNode;
  children?: React.ReactNode;
};

export function Board({ modules, mini = false, label, onRemove, addSlot, children }: Props) {
  const count: Partial<Record<Layer["band"], number>> = {};
  const sorted = [...modules].sort((a, b) => ORDER.indexOf(a.layer.band) - ORDER.indexOf(b.layer.band));
  return (
    <div className={mini ? "board mini" : "board"}>
      {sorted.map((m) => {
        const n = (count[m.layer.band] = (count[m.layer.band] ?? 0) + 1);
        const ref = `${PREFIX[m.layer.band]}${n}`;
        const core = CORE.has(m.layer.id);
        return (
          <section
            key={m.layer.id}
            className={`module s${span(m)} b-${m.layer.band}${core ? " core" : ""}`}
            aria-label={m.layer.name}
            title={mini ? `${m.layer.name}: ${m.picks.map((p) => p.name).join(", ")}` : undefined}
          >
            {!mini && (
              <header className="silk">
                <span className="ref">{ref}</span>
                <Link href={`/layer/${m.layer.id}/`}>{m.layer.name}</Link>
              </header>
            )}
            <div className="chips">
              {m.picks.map((p) => (
                <div key={p.id} className="chip">
                  <Logo option={p} />
                  {!mini && (
                    <span className="chip-text">
                      <span className="chip-name">{p.name}</span>
                      {p.note && <span className="chip-note">{p.note}</span>}
                    </span>
                  )}
                  {onRemove && (
                    <button className="x" aria-label={`Remove ${p.name}`} onClick={() => onRemove(m.layer.id, p.id)}>
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
      {children}
      {label && !mini && <div className="board-label">{label}</div>}
    </div>
  );
}
