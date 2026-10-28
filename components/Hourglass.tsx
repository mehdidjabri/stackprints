import type { ReactNode } from "react";
import type { Part, Slot } from "@/lib/simple";

// The simple view as a figure: an hourglass. What you say pours in at the top through the channels,
// passes the brain at the waist (the harness is the square the glass passes through, the model the
// disc inside it), and settles below as memory: the one solid shape, a pile split by the ways the
// agent remembers. Retrieval is the thread that climbs back up; sessions and files are the floor;
// the ground is where it runs; the arm to the right is what it can do. Every shape is drawn in the
// board's four states: solid (named), outlined with "?" (in use, not named), hatched (not
// disclosed), dashed (not used). Server-rendered SVG with fixed geometry: one drawing for wide
// screens with its labels, one for phones with a key under it.

type State = Slot["state"];
type Band = Slot["band"];
type Slots = Record<string, Slot | undefined>;

const PHI = 1.618;
const HANDS: [string, string][] = [
  ["tools", "Tools"],
  ["search", "Search"],
  ["sandbox", "Sandbox"],
  ["browser", "Browser"],
  ["mcp", "MCP"],
  ["connectors", "Apps"],
  ["payments", "Payments"],
  ["skills", "Skills"],
];
const SAYS: Record<State, string> = { picked: "", unknown: "not disclosed", present: "in use, not named", unused: "not used" };
const BANDS: Band[] = ["surface", "brain", "hands", "files", "ops"];

const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (...p: [number, number][]) => p.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" ");
/** DM Sans, measured roughly: the labels leave room for the difference. */
const tw = (t: string, size = 12) => t.length * size * 0.56;
const capW = (t: string) => t.length * 9.5 * 0.76;

/** What a layer runs by default; when it lists only configurable picks, those. */
function runs(s?: Slot) {
  if (!s) return [];
  const d = s.picks.filter((p) => !p.supported);
  return d.length ? d : s.picks;
}
const on = (s?: Slot) => s?.state === "picked" || s?.state === "present";
const stateOf = (s?: Slot): State => s?.state ?? "unknown";

/** "A, B +3": as many names as fit, three at most; the tooltip has the rest. */
function fit(names: string[], room: number, size = 12, max = 3) {
  for (let k = Math.min(names.length, max); k >= 1; k--) {
    const t = names.slice(0, k).join(", ") + (k < names.length ? ` +${names.length - k}` : "");
    if (tw(t, size) <= room) return t;
  }
  const more = names.length > 1 ? ` +${names.length - 1}` : "";
  let t = names[0] ?? "";
  while (t.length > 3 && tw(`${t}…${more}`, size) > room) t = t.slice(0, -1);
  return `${t}…${more}`;
}

/** One line per layer for a native tooltip: its picks, or what its emptiness means. */
function tip(...ss: (Slot | undefined)[]) {
  return ss
    .filter((s): s is Slot => Boolean(s))
    .map((s) => (s.state === "picked" ? `${s.name}: ${s.picks.map((p) => `${p.name}${p.supported ? " (configurable)" : ""}`).join(", ")}` : `${s.name}: ${SAYS[s.state]}`))
    .join("\n");
}

type Said = { value: string; logo?: string; st: State; muted?: boolean };

/** A layer as a label value: its default picks, or what its emptiness means. */
function said(s: Slot | undefined, room: number, size = 12, max = 3): Said {
  if (!s || s.state !== "picked") return { value: s?.state === "present" ? "not named" : SAYS[stateOf(s)], st: stateOf(s), muted: true };
  const ps = runs(s);
  return { value: fit(ps.map((p) => p.say ?? p.name), room - (ps[0].logo ? 17 : 0), size, max), logo: ps[0].logo, st: "picked" };
}

/** A shape in one of the four states. */
function Shape({ kind, attrs, band, st, fill = "solid", hatch }: { kind: "rect" | "circle" | "polygon"; attrs: Record<string, string | number>; band: Band; st: State; fill?: "solid" | "mass" | "tint"; hatch: (b: Band) => string }) {
  const El = kind;
  const a = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, typeof v === "number" ? r1(v) : v]));
  if (st === "picked") return fill === "tint" ? <El {...a} className="tint ln" /> : <El {...a} className={fill} />;
  return (
    <>
      <El {...a} className="bgf" />
      {st === "unknown" && <El {...a} fill={hatch(band)} />}
      <El {...a} className={st === "unused" ? "ln dash" : "ln"} />
    </>
  );
}

/** caption · mark · value, laid out from an anchor. */
function Label(props: { x: number; y: number; anchor?: "start" | "end"; cap?: string; value?: string; logo?: string; st?: State; band: Band; muted?: boolean; size?: number; hatch: (b: Band) => string }) {
  const { y, cap, value, logo, st, band, muted, size = 12, hatch } = props;
  const cw = cap ? capW(cap) : 0;
  const gap = cap && (value || st) ? 8 : 0;
  const mark = st && st !== "picked" ? 13 : logo ? 17 : 0;
  const total = cw + gap + mark + (value ? tw(value, size) : 0);
  let x = props.anchor === "end" ? props.x - total : props.x;
  const out: ReactNode[] = [];
  if (cap) {
    out.push(
      <text key="c" className="cap" x={r1(x)} y={y}>
        {cap}
      </text>,
    );
    x += cw + gap;
  }
  if (mark) {
    out.push(
      st && st !== "picked" ? (
        <g key="m" className={band}>
          <Shape kind="rect" attrs={{ x: x + 0.5, y: y - 7.5, width: 7, height: 7 }} band={band} st={st} hatch={hatch} />
        </g>
      ) : (
        <use key="m" className="lg" href={`/logos.svg#${logo}`} x={r1(x)} y={y - 11} width={13} height={13} />
      ),
    );
    x += mark;
  }
  if (value)
    out.push(
      <text key="v" className={muted ? "mut" : undefined} x={r1(x)} y={y} style={size !== 12 ? { fontSize: size } : undefined}>
        {value}
      </text>,
    );
  return <>{out}</>;
}

type Geom = { W: number; bh: number; Ht: number; cx: number; top: number; ny: number; fy: number; pileH: number; H: number; wide: boolean };

function geom(wide: boolean): Geom {
  // A 45° hourglass: the glass is one X, so the brain's square has it for diagonals. The chamber is as
  // tall as it is half-wide, the funnel is the chamber over φ, and the pile fills 56% of the chamber.
  if (wide) {
    const W = 960, bh = 200, Ht = Math.round(bh / PHI), cx = 360, top = 58, ny = top + Ht, fy = ny + bh;
    return { W, bh, Ht, cx, top, ny, fy, pileH: Math.round(bh * 0.56), H: fy + 44, wide };
  }
  const W = 360, bh = 150, Ht = Math.round(bh / PHI), cx = W / 2, top = 30, ny = top + Ht, fy = ny + bh;
  return { W, bh, Ht, cx, top, ny, fy, pileH: Math.round(bh * 0.56), H: fy + 14, wide };
}

const HS = 12; // half the brain's square

function Figure({ slots: L, wide, id, label }: { slots: Slots; wide: boolean; id: string; label: string }) {
  const g = geom(wide);
  const { W, bh, Ht, cx, top, ny, fy, pileH } = g;
  const hatch = (b: Band) => `url(#${id}-${b})`;
  let under = 0;

  // ——— the chamber: what it remembers ———
  const m = L.memory, rt = L.retrieval, sto = L.storage;
  const peak: [number, number] = [cx, fy - pileH];
  const A: [number, number] = [cx - bh, fy], B: [number, number] = [cx + bh, fy];
  const pile: ReactNode[] = [];
  if (m?.state === "picked") {
    const ps = m.picks;
    const n = ps.length;
    const seg = (2 * bh) / n;
    const f = 18 / pileH; // the names' cap height, as a share of the pile
    const names = ps.map((p) => p.say ?? p.name);
    const fitsInside = wide && names.every((t) => tw(t, 11.5) <= seg * (1 - f) - 12);
    const fitsUnder = wide && !fitsInside && names.every((t) => tw(t, 11.5) <= seg - 6);
    if (fitsUnder) under = 22;
    ps.forEach((p, i) => {
      const x0 = A[0] + i * seg, x1 = x0 + seg, mid = (x0 + x1) / 2;
      pile.push(
        <polygon key={`w${i}`} points={pts(peak, [x0, fy], [x1, fy])} className={p.supported ? "tint ln" : "mass"}>
          <title>{`${p.name}${p.note ? `: ${p.note}` : ""}${p.supported ? " (configurable, not the default)" : ""}`}</title>
        </polygon>,
      );
      if (fitsInside)
        pile.push(
          <text key={`t${i}`} className={p.supported ? "nm" : "nm inv"} x={r1(mid + (cx - mid) * f * 0.75)} y={fy - 8} textAnchor="middle">
            {names[i]}
          </text>,
        );
      if (fitsUnder)
        pile.push(
          <text key={`u${i}`} className="nm" x={r1(mid)} y={fy + 25} textAnchor="middle">
            {names[i]}
          </text>,
        );
    });
    for (let i = 1; i < n; i++) pile.push(<line key={`c${i}`} className="cut" x1={peak[0]} y1={peak[1]} x2={r1(A[0] + i * seg)} y2={fy} />);
  } else {
    const ms = stateOf(m);
    const say = ms === "unknown" ? "not disclosed" : ms === "present" ? "in use, not named" : "no long-term memory";
    const sw = tw(say, 12) + 16;
    const sy = fy - pileH * 0.3;
    pile.push(<Shape key="p" kind="polygon" attrs={{ points: pts(peak, A, B) }} band="files" st={ms} hatch={hatch} />);
    if (ms === "present")
      pile.push(
        <text key="q" className="qm" x={cx} y={r1(sy - 14)} style={{ fontSize: 18 }}>
          ?
        </text>,
      );
    pile.push(<rect key="b" className="bgf" x={r1(cx - sw / 2)} y={r1(sy - 4)} width={r1(sw)} height={20} />);
    pile.push(
      <text key="s" className="mut" x={cx} y={r1(sy + 10)} textAnchor="middle">
        {say}
      </text>,
    );
  }
  const t0 = ny + HS, t1 = peak[1];
  const rs = stateOf(rt);
  const thread =
    rs === "unknown" ? (
      <Shape kind="rect" attrs={{ x: cx - 3, y: t0, width: 6, height: t1 - t0 }} band="files" st="unknown" hatch={hatch} />
    ) : (
      <line className={rs === "unused" ? "ln dash" : "ln"} x1={cx + 0.5} y1={t0} x2={cx + 0.5} y2={t1} />
    );
  const dR = (bh - pileH) / 2 + HS / 2;

  // ——— the funnel: where you talk to it ———
  const ch = L.channels, pr = L.proactivity;
  const M0: [number, number] = [cx - Ht, top], M1: [number, number] = [cx + Ht, top], N: [number, number] = [cx, ny];
  const funnel: ReactNode[] = [];
  if (ch?.state === "picked") {
    const ps = ch.picks;
    const n = ps.length;
    const step = n > 1 ? (2 * Ht) / (n - 1) : 0;
    const ls = Math.max(9, Math.min(15, step - 7));
    funnel.push(<line key="l0" className="ln soft" x1={M0[0]} y1={M0[1]} x2={N[0]} y2={N[1]} />, <line key="l1" className="ln soft" x1={M1[0]} y1={M1[1]} x2={N[0]} y2={N[1]} />);
    ps.forEach((p: Part, i) => {
      const x = n > 1 ? M0[0] + i * step : cx;
      funnel.push(<line key={`f${i}`} className="ln soft" x1={r1(x)} y1={top} x2={cx} y2={ny} />);
      funnel.push(
        <g key={`p${i}`}>
          <title>{`${p.name}${p.note ? `: ${p.note}` : ""}`}</title>
          <rect className="hit" x={r1(x - Math.max(step, 14) / 2)} y={top - ls - 14} width={r1(Math.max(step, 14))} height={ls + 14} />
          {p.logo ? (
            <use className="lg" href={`/logos.svg#${p.logo}`} x={r1(x - ls / 2)} y={top - ls - 8} width={ls} height={ls} />
          ) : (
            <rect className="solid" x={r1(x - 2)} y={r1(top - 8 - ls / 2 - 2)} width={4} height={4} />
          )}
        </g>,
      );
    });
    funnel.push(<line key="mouth" className="ln" x1={M0[0]} y1={top + 0.5} x2={M1[0]} y2={top + 0.5} />);
  } else {
    funnel.push(<Shape key="f" kind="polygon" attrs={{ points: pts(M0, M1, N) }} band="surface" st={stateOf(ch)} hatch={hatch} />);
    if (ch?.state === "present")
      funnel.push(
        <text key="q" className="qm" x={cx} y={r1(top + Ht * 0.42)} style={{ fontSize: 16 }}>
          ?
        </text>,
      );
  }

  // ——— the waist: the brain ———
  const md = L.model, hn = L.harness, rtr = L.router;
  const xr = cx - 36;

  // ——— the arm: what it can do ———
  const x0 = cx + (wide ? 72 : 30);
  const x1 = W - (wide ? 40 : 12);
  const step = (x1 - x0) / (HANDS.length - 1);
  const half = wide ? 5 : 4.5;

  const ho = L.hosting;
  const gy = fy + 7.5;

  return (
    <svg className={`hg ${wide ? "hg-wide" : "hg-narrow"}`} viewBox={`0 0 ${W} ${g.H + under}`} role="img" aria-label={label}>
      <defs>
        {BANDS.map((b) => (
          <pattern key={b} id={`${id}-${b}`} width={b === "hands" || b === "ops" ? 4 : 5} height={b === "hands" || b === "ops" ? 4 : 5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0.5" y1="0" x2="0.5" y2={b === "hands" || b === "ops" ? 4 : 5} className={`hx hx-${b}`} />
          </pattern>
        ))}
      </defs>

      {/* Ground: where it runs. */}
      <g className="ops">
        <title>{tip(ho, L.durable, L.guardrails, L.identity, L.observability)}</title>
        {stateOf(ho) === "unknown" ? (
          <>
            <rect x={0} y={fy + 5} width={W} height={5} fill={hatch("ops")} />
            <line className="ln" x1={0} y1={fy + 5.5} x2={W} y2={fy + 5.5} />
            <line className="ln" x1={0} y1={fy + 9.5} x2={W} y2={fy + 9.5} />
          </>
        ) : (
          <line className={ho?.state === "unused" ? "ln dash" : "ln"} x1={0} y1={gy} x2={W} y2={gy} />
        )}
        {wide && <Label x={cx - bh} y={fy + 31 + under} cap="HOSTING" band="ops" hatch={hatch} {...said(ho, W - (cx - bh) - capW("HOSTING") - 8)} />}
      </g>

      {/* The chamber: what it remembers. */}
      <g className="files">
        <title>{tip(m, rt, sto)}</title>
        <line className="ln soft" x1={cx} y1={ny} x2={A[0]} y2={A[1]} />
        <line className="ln soft" x1={cx} y1={ny} x2={B[0]} y2={B[1]} />
        {pile}
        <Shape kind="rect" attrs={{ x: cx - bh + 0.5, y: fy + 2.5, width: 2 * bh - 1, height: 3 }} band="files" st={stateOf(sto)} fill="mass" hatch={hatch} />
        {thread}
        {wide && (
          <>
            <Label x={cx - bh - 18} y={fy - 3} anchor="end" cap="MEMORY" band="files" hatch={hatch} />
            <Label x={cx + dR + 18} y={ny + dR + 4} cap="RETRIEVAL" band="files" hatch={hatch} {...said(rt, W - (cx + dR + 18) - 80)} />
            <Label x={cx + bh + 18} y={fy - 3} cap="SESSIONS" band="files" hatch={hatch} {...said(sto, W - (cx + bh + 18) - 70)} />
          </>
        )}
      </g>

      {/* The funnel: where you talk to it. */}
      <g className="surface">
        <title>{tip(ch, pr, L.ui, L.voice, L.devices, L.readiness)}</title>
        {funnel}
        {wide && (
          <>
            <Label x={M0[0] - 18} y={top + 4} anchor="end" cap="CHANNELS" band="surface" hatch={hatch} />
            <Label x={M0[0] - 18} y={top + 22} anchor="end" band="surface" hatch={hatch} {...said(ch, M0[0] - 22)} logo={undefined} />
            {on(pr) && <Label x={M0[0] - 18} y={top + 39} anchor="end" value="starts on its own" muted band="surface" hatch={hatch} />}
            {pr?.state === "unknown" && <Label x={M0[0] - 18} y={top + 39} anchor="end" value="whether it starts on its own" st="unknown" muted band="surface" hatch={hatch} />}
          </>
        )}
      </g>

      {/* The waist: the brain. */}
      <g className="brain">
        <title>{tip(md, hn, rtr, L.inference, L.persona, L.multiagent)}</title>
        <line className="ln soft" x1={wide ? cx - bh : 0} y1={ny + 0.5} x2={cx - HS} y2={ny + 0.5} />
        <rect className="bgf" x={cx - HS} y={ny - HS} width={2 * HS} height={2 * HS} />
        <Shape kind="rect" attrs={{ x: cx - HS + 0.5, y: ny - HS + 0.5, width: 2 * HS - 1, height: 2 * HS - 1 }} band="brain" st={stateOf(hn)} fill="tint" hatch={hatch} />
        <Shape kind="circle" attrs={{ cx, cy: ny, r: 6.5 }} band="brain" st={stateOf(md)} hatch={hatch} />
        {md?.state === "present" && (
          <text className="qm" x={cx} y={ny + 3.5} style={{ fontSize: 9 }}>
            ?
          </text>
        )}
        {wide && (
          <>
            <Label x={xr} y={ny - 10} anchor="end" cap="MODEL" band="brain" hatch={hatch} {...said(md, xr - 4 - capW("MODEL") - 8, 12, 2)} />
            <Label x={xr} y={ny + 21} anchor="end" cap="HARNESS" band="brain" hatch={hatch} {...said(hn, xr - 4 - capW("HARNESS") - 8, 12, 2)} />
            {md?.state !== "picked" && rtr?.state === "picked" && (
              <Label x={xr - 14} y={ny + 39} anchor="end" cap="GATEWAY" band="brain" hatch={hatch} {...said(rtr, xr - 18 - capW("GATEWAY") - 8, 12, 2)} />
            )}
          </>
        )}
      </g>

      {/* The arm: what it can do, a ruler of eight. */}
      <g className="hands">
        <line className="ln soft" x1={cx + HS} y1={ny + 0.5} x2={x1} y2={ny + 0.5} />
        {HANDS.map(([hid, short], k) => {
          const sl = L[hid];
          const st = stateOf(sl);
          const x = Math.round(x0 + k * step);
          const ly = step < 66 && k % 2 ? ny + 22 : ny - 13;
          return (
            <g key={hid}>
              <title>{tip(sl) || short}</title>
              <rect className="hit" x={r1(x - step / 2)} y={ny - 30} width={r1(step)} height={44} />
              <Shape kind="rect" attrs={{ x: x - half + 0.5, y: ny - half + 0.5, width: 2 * half - 1, height: 2 * half - 1 }} band="hands" st={st} hatch={hatch} />
              {st === "present" && (
                <text className="qm" x={x} y={ny + 3} style={{ fontSize: 7 }}>
                  ?
                </text>
              )}
              {wide && (
                <text x={x} y={ly} textAnchor="middle" className={on(sl) ? "nm" : "nm mut"}>
                  {short}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** On phones the figure goes without words; this says what it shows, row by row. */
function Key({ slots: L }: { slots: Slots }) {
  const value = (s: Slot | undefined) => (s?.state === "picked" ? runs(s).map((p) => p.say ?? p.name).join(", ") : SAYS[stateOf(s)]);
  const can = HANDS.filter(([hid]) => on(L[hid])).map(([, n]) => n);
  const rows: [Band, string, string, boolean][] = [
    ["surface", "Talk", `${value(L.channels)}${on(L.proactivity) ? " · starts on its own" : ""}`, L.channels?.state === "picked"],
    ["brain", "Model", value(L.model), L.model?.state === "picked"],
    ["brain", "Harness", value(L.harness), L.harness?.state === "picked"],
    ["hands", "Can", can.join(", ") || "not disclosed", can.length > 0],
    ["files", "Memory", value(L.memory), L.memory?.state === "picked"],
    ["files", "Retrieval", value(L.retrieval), L.retrieval?.state === "picked"],
    ["files", "Sessions", value(L.storage), L.storage?.state === "picked"],
    ["ops", "Runs on", value(L.hosting), L.hosting?.state === "picked"],
  ];
  return (
    <ul className="hg-key">
      {rows.map(([band, k, v, known]) => (
        <li key={k} className={`b-${band}`}>
          <span className="k">{k}</span>
          <span className={known ? "v" : "v mut"}>{v}</span>
        </li>
      ))}
    </ul>
  );
}

export function Hourglass({ slots, label }: { slots: Slot[]; label: string }) {
  const L: Slots = Object.fromEntries(slots.map((s) => [s.id, s]));
  return (
    <div className="hourglass">
      <Figure slots={L} wide id="hgw" label={label} />
      <Figure slots={L} wide={false} id="hgn" label={label} />
      <Key slots={L} />
    </div>
  );
}
