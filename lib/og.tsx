import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { resolve } from "./data";
import type { Layer, Option, Stack } from "./types";

export const OG_SIZE = { width: 1200, height: 630 };

const FG = "#0c0c0c";
const MUTED = "#8d8d88";
const LINE = "#cfcfca";
const BG = "#fafaf9";

const logoCache = new Map<string, string>();
function logoSrc(name: string) {
  if (!logoCache.has(name)) {
    const svg = fs
      .readFileSync(path.join(process.cwd(), "content/logos", `${name}.svg`), "utf8")
      .replace(/currentColor/g, FG)
      // The renderer can't resolve em sizes or inline styles on the root element.
      .replace(/<svg\b[^>]*>/, (root) => root.replace(/\s(width|height|style|fill)="[^"]*"/g, ""))
      .replace(/<svg\b/, `<svg width="64" height="64" fill="${FG}"`);
    logoCache.set(name, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  }
  return logoCache.get(name)!;
}

function Mark({ o, size }: { o: Option; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (o.logo) return <img src={logoSrc(o.logo)} width={size} height={size} alt="" />;
  return <div style={{ display: "flex", width: size - 6, height: size - 6, margin: 3, border: `1.5px solid ${MUTED}` }} />;
}

type Row = { layer: Layer; picks: Option[] };

// Like the site's mini boards: marks only, a few per module, so any stack fits the card.
function Mod({ r, grow = 0, core = false, column = false, basis }: { r: Row; grow?: number; core?: boolean; column?: boolean; basis?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: column ? "column" : "row",
        alignItems: "center",
        gap: 6,
        padding: core ? 9 : 6,
        border: `${core ? 2 : 1}px solid ${core ? FG : LINE}`,
        flexGrow: grow,
        flexShrink: 1,
        ...(basis ? { flexBasis: basis } : {}), // the renderer rejects undefined style values
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {r.picks.slice(0, core ? 4 : 3).map((p) => (
        <Mark key={p.id} o={p} size={core ? 26 : 18} />
      ))}
    </div>
  );
}

/** Shared 1200×630 card: title on the left, the stack as a motherboard on the right. */
export function ogImage(detail: string, stack?: Pick<Stack, "layers">) {
  const rows = stack ? resolve(stack) : [];
  const band = (b: Layer["band"]) => rows.filter((r) => r.layer.band === b);
  const [io, brain, hands, files, ops] = (["surface", "brain", "hands", "files", "ops"] as const).map(band);
  const cores = brain.filter((r) => r.layer.id === "model" || r.layer.id === "harness");
  const chipset = brain.filter((r) => !cores.includes(r));
  const gap = 8;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: BG, color: FG, padding: 56, fontSize: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: rows.length ? 400 : 1088 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", fontSize: 38, letterSpacing: -1 }}>Stackprints /</div>
            <div style={{ display: "flex", fontSize: 60, letterSpacing: -2, color: "#6b6b6b", lineHeight: 1.05 }}>{detail}</div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#6b6b6b" }}>stackprints.com</div>
        </div>
        {rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap, padding: 14, marginLeft: 40, border: `2px solid ${FG}` }}>
            {/* Rear I/O */}
            <div style={{ display: "flex", gap, overflow: "hidden" }}>
              {io.map((r) => (
                <Mod key={r.layer.id} r={r} grow={Math.min(r.picks.length, 3)} />
              ))}
            </div>
            <div style={{ display: "flex", flex: 1, gap }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, gap }}>
                {/* Processor area: sockets plus chipset column */}
                <div style={{ display: "flex", gap }}>
                  <div style={{ display: "flex", flexDirection: "column", flex: 2, gap }}>
                    {cores.map((r) => (
                      <Mod key={r.layer.id} r={r} core />
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, gap }}>
                    {chipset.map((r) => (
                      <Mod key={r.layer.id} r={r} />
                    ))}
                  </div>
                </div>
                {/* Expansion slots, two to a row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap }}>
                  {hands.map((r) => (
                    <Mod key={r.layer.id} r={r} grow={1} basis="45%" />
                  ))}
                </div>
              </div>
              {/* Memory sticks */}
              {files.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", width: 70, gap }}>
                  {files.map((r) => (
                    <Mod key={r.layer.id} r={r} grow={1} column />
                  ))}
                </div>
              )}
            </div>
            {/* Power */}
            <div style={{ display: "flex", gap, overflow: "hidden" }}>
              {ops.map((r) => (
                <Mod key={r.layer.id} r={r} grow={1} />
              ))}
            </div>
          </div>
        )}
      </div>
    ),
    OG_SIZE,
  );
}
