import { ImageResponse } from "next/og";
import { resolve } from "./data";
import type { Stack } from "./types";

export const OG_SIZE = { width: 1200, height: 630 };

/** Shared 1200×630 card: title on the left, the stack as thin-ruled rows on the right. */
export function ogImage(detail: string, stack?: Pick<Stack, "layers">) {
  const rows = stack ? resolve(stack).slice(0, 11) : [];
  const fg = "#0c0c0c";
  const line = "#d0d0cc";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fafaf9", color: fg, padding: 64, fontSize: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: rows.length ? 480 : 1072 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", fontSize: 40, letterSpacing: -1 }}>Agentic Stack /</div>
            <div style={{ display: "flex", fontSize: 64, letterSpacing: -2, color: "#6b6b6b", lineHeight: 1.05 }}>{detail}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 56 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", height: 14, border: `2px solid ${fg}` }} />
            ))}
          </div>
        </div>
        {rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, border: `2px solid ${fg}`, marginLeft: 48 }}>
            {rows.map(({ layer, picks }, i) => (
              <div key={layer.id} style={{ display: "flex", flex: 1, alignItems: "center", borderTop: i ? `1px solid ${line}` : "none", fontSize: 18 }}>
                <div style={{ display: "flex", width: 170, flexShrink: 0, padding: "0 14px", color: "#6b6b6b", borderRight: `1px solid ${line}`, height: "100%", alignItems: "center" }}>
                  {layer.name}
                </div>
                <div style={{ display: "flex", gap: 8, padding: "0 10px", overflow: "hidden" }}>
                  {picks.slice(0, 2).map((p) => (
                    <div key={p.id} style={{ display: "flex", border: `1px solid ${fg}`, padding: "2px 8px", whiteSpace: "nowrap" }}>
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    OG_SIZE,
  );
}
