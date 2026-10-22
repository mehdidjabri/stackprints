import Link from "next/link";
import { BANDS } from "@/lib/bands";
import type { Layer, Option } from "@/lib/types";


type Row = { layer: Layer; picks: Option[] };

/** Full stack diagram: bands of thin-ruled rows, top (surface) to bottom (foundation). */
export function StackView({ rows, compact = false }: { rows: Row[]; compact?: boolean }) {
  const bands = BANDS.map(([band, label]) => ({ band, label, rows: rows.filter((r) => r.layer.band === band) }))
    .filter((b) => b.rows.length);
  return (
    <div className={compact ? "stack compact" : "stack"}>
      {bands.map(({ band, label, rows }) => (
        <section key={band} className="band" aria-label={label}>
          {!compact && <div className="band-name">{label}</div>}
          {rows.map(({ layer, picks }) => (
            <div key={layer.id} className="row">
              <div className="row-label">
                {compact ? layer.name : <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>}
              </div>
              <div className="row-picks">
                {picks.map((p) => (
                  <span key={p.id} className="pick" title={p.note}>
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
