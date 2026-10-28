import { Fragment, type ReactNode } from "react";
import { type Part, type Slot, strip } from "@/lib/simple";
import { ExplodedRun } from "./ExplodedRun";

// The exploded view: the stack pulled apart into five plates, like a manual's teardown, from where you
// reach it (surface) down to where it runs (ops). The plates show what it is built from; the lines show
// its runs. Most agents have more than one: you ask and it replies, a schedule or an event wakes it and
// it tells you, it digs in the background, another agent calls it and gets a result. Each run starts
// and ends its own way around the same loop: the harness loops, the model thinks, tools act, memory is
// written and fed back up. Every part is drawn in the board's four states: solid (named), outlined
// with "?" (in use, not named), hatched (not disclosed), dashed (not used). Server-rendered SVG with
// fixed geometry: one drawing labelled for wide screens, one for phones with the parts listed under it.
// Runs and steps are radios, so picking one works without JavaScript; the island (ExplodedRun) adds
// Play, Esc and the moving dot.

type State = Slot["state"];
type Band = Slot["band"];
type Lay = Slot & { short: string; def: Part[]; conf: Part[] };
type Ls = Record<string, Lay>;
type Pt = [number, number];
type Ell = { cx: number; cy: number; rx: number; ry: number };
type Span = { X: number; y0: number; y1: number };
type Fill = "solid" | "tint" | "mass";
/** How the dot moves through one step: lines it runs down at once, or a pulse. */
export type Phase = { lines: { pts: Pt[]; rose?: boolean }[] } | { pulse: Ell };

const BANDS: Band[] = ["surface", "brain", "hands", "files", "ops"];
const BAND: Record<Band, [string, string]> = {
  surface: ["Surface", "where you reach it"],
  brain: ["Brain", "how it thinks"],
  hands: ["Hands", "what it can do"],
  files: ["Files", "what it remembers"],
  ops: ["Ops", "what keeps it running"],
};
const SAY: Record<State, string> = { picked: "", unknown: "not disclosed", present: "in use, not named", unused: "not used" };
const SHORT: Record<string, string> = {
  proactivity: "Triggers",
  ui: "Interface",
  readiness: "Agent access",
  router: "Model gateway",
  persona: "Instructions",
  tools: "Built-in tools",
  browser: "Browser",
  mcp: "Tool interface",
  skills: "Skills",
  storage: "Sessions & files",
  identity: "Identity",
  observability: "Observability",
  durable: "Durable runs",
};
const HANDS = ["tools", "search", "sandbox", "browser", "mcp", "connectors", "payments", "skills"];
const HSAY: Record<string, string> = { tools: "built-in tools", search: "web search", sandbox: "a sandbox", browser: "a browser", mcp: "MCP", connectors: "your apps", payments: "payments", skills: "skills" };
const HSHORT: Record<string, string> = { tools: "tools", search: "search", sandbox: "sandbox", browser: "browser", mcp: "MCP", connectors: "apps", payments: "payments", skills: "skills" };
/** The small parts of a plate: a row of sockets along its front-right edge. */
const PIN: Partial<Record<Band, string[]>> = {
  surface: ["ui", "voice", "devices", "readiness"],
  brain: ["router", "inference", "persona", "multiagent"],
  ops: ["durable", "guardrails", "identity", "observability"],
};
/** Which plate every part the drawing names sits on, so a board missing one still draws. */
const BAND_OF: Record<string, Band> = {
  channels: "surface",
  proactivity: "surface",
  harness: "brain",
  model: "brain",
  memory: "files",
  retrieval: "files",
  storage: "files",
  hosting: "ops",
  ...Object.fromEntries(HANDS.map((id) => [id, "hands"])),
  ...Object.fromEntries(Object.entries(PIN).flatMap(([b, ids]) => ids.map((id) => [id, b]))),
};

/** Triggers by the run they start. Request / response starts none: it only acts when asked. */
const CLOCK = ["cron", "heartbeat", "self-scheduled-wake"];
const EVENT = ["webhooks", "gmail-pub-sub"];
const DIG = ["background-research"];
const ASKED = ["request-response"];
/** What a background run reads with: it changes nothing. */
const READS = ["search", "browser", "connectors"];

const r1 = (n: number) => Math.round(n * 10) / 10;
/** DM Sans, measured roughly; the labels leave room for the difference. */
const tw = (t: string, size = 12) => t.length * size * 0.555;
const capW = (t: string, size = 9.5) => t.length * size * 0.82;

function norm(slots: Slot[]): Ls {
  const L: Ls = {};
  for (const s of slots) L[s.id] = { ...s, short: SHORT[s.id] ?? s.name, def: s.picks.filter((p) => !p.supported), conf: s.picks.filter((p) => p.supported) };
  for (const [id, band] of Object.entries(BAND_OF)) L[id] ??= { id, name: id, band, state: "unknown", picks: [], short: SHORT[id] ?? id, def: [], conf: [] };
  return L;
}
/** What a layer runs by default; when it lists only configurable picks, those. */
const uses = (l: Lay) => (l.def.length ? l.def : l.conf);
const on = (l: Lay) => l.state === "picked" || l.state === "present";
function list(l: Lay, max: number) {
  const ps = uses(l);
  const shown = ps.length <= max + 1 ? ps : ps.slice(0, max);
  const rest = ps.length - shown.length;
  return shown.map((p) => p.name).join(", ") + (rest ? ` +${rest}` : "");
}
const join = (xs: string[], conj = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${conj} ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Plain text" reads as "plain text" mid-sentence; "DM pairing" and "MCP" keep their capitals. */
const low = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
function tipOf(l: Lay) {
  if (l.state !== "picked") return `${l.name}: ${SAY[l.state]}`;
  const d = l.def.map((p) => p.name);
  const c = l.conf.map((p) => p.name);
  return `${l.name}: ${d.join(", ")}${c.length ? `${d.length ? "; " : ""}configurable: ${c.join(", ")}` : ""}`;
}
/**
 * One step of a run: the parts it touches, the lines it travels (in, wake, act, mem, read, out,
 * cons), and what it says for this stack.
 */
type Step = { title: string; layers: string[]; lines: string[]; detail: string };
/** A run: one letter for its key (m, s, e, b, o, a), its name, and its steps. */
type Run = { key: string; label: string; steps: Step[] };

/** The runs this stack has, said from its picks, and what is not known about the rest. */
function runsOf(L: Ls): { runs: Run[]; note?: string } {
  const { channels: ch, readiness: ra, proactivity: pr, harness: h, persona: pe, model: m, router: ro } = L;
  let s: string;

  s = h.state === "picked" ? `${list(h, 1)} runs each turn until the work is done` : h.state === "present" ? "A harness it doesn’t name runs each turn" : "Its harness is not disclosed";
  if (pe.state === "picked") s += `, following ${list(pe, 1)}`;
  const harness: Step = { title: "The harness loops", layers: ["harness", "persona", "multiagent"], lines: [], detail: s + "." };

  s = m.state === "picked" ? `${list(m, 1)} decides each next step` : m.state === "present" ? "A model it doesn’t name decides each step" : "Its model is not disclosed";
  if (ro.state === "picked") s += m.state === "picked" ? `, reached through ${list(ro, 1)}${ro.def.length ? "" : " (configurable)"}` : `; its calls go through ${list(ro, 1)}`;
  const model: Step = { title: "The model thinks", layers: ["model", "router", "inference"], lines: [], detail: s + "." };

  const can = HANDS.filter((id) => on(L[id]));
  const unk = HANDS.filter((id) => L[id].state === "unknown");
  const un = HANDS.filter((id) => L[id].state === "unused");
  s = can.length ? cap(join(can.map((id) => HSAY[id]))) : "What it can do is not disclosed";
  if (can.length && unk.length) s += `; ${unk.length} more not disclosed`;
  else if (can.length && un.length) s += `; no ${join(un.map((id) => HSHORT[id]), "or")}`;
  const tools: Step = { title: "Tools act", layers: HANDS, lines: ["act"], detail: s + "." };
  const reads = READS.filter((id) => on(L[id]));
  const look: Step = { title: "It reads, and changes nothing", layers: READS, lines: ["act"], detail: reads.length ? `${cap(join(reads.map((id) => HSAY[id])))}, read-only.` : "What it reads with is not disclosed." };

  const { memory: me, retrieval: rt, storage: sto } = L;
  if (me.state === "unknown" && rt.state === "unknown" && sto.state === "unknown") s = "What it remembers, and how, is not disclosed";
  else {
    s = me.state === "picked" ? `Into ${list(me, 2)}` : me.state === "present" ? "Into a memory it doesn’t name" : me.state === "unused" ? "No long-term memory" : "Its memory is not disclosed";
    s += rt.state === "picked" ? `, found again with ${list(rt, 1)}` : rt.state === "unknown" ? "; how it’s found again is not disclosed" : "";
  }
  const memory: Step = { title: "Memory is written and read back", layers: ["memory", "retrieval", "storage"], lines: ["mem", "read"], detail: s + "." };

  const { hosting: ho, guardrails: gu } = L;
  s = ho.state === "picked" ? `On ${low(list(ho, 2))}` : "Where it runs is not disclosed";
  if (gu.state === "picked") s += `, checked by ${low(list(gu, 1))}`;
  const ops: Step = { title: "Ops keeps it running", layers: ["hosting", "durable", "guardrails", "identity", "observability"], lines: ["cons"], detail: s + "." };

  // You ask, and it answers the same way.
  s = ch.state === "picked" ? `Through ${list(ch, 2)}` : ch.state === "present" ? "Through channels it doesn’t name" : ch.state === "unused" ? "It has no channels to message" : "Where it’s reached is not disclosed";
  const ask: Step = { title: "A message comes in", layers: ["channels"], lines: ["in"], detail: s + "." };
  const { ui, voice: vo } = L;
  s = ui.state === "picked" ? `Back the same way, as ${low(list(ui, 1))}` : "Back the same way";
  if (vo.state === "picked") s += `, or aloud with ${list(vo, 1)}`;
  else if (vo.state === "present") s += ", or aloud (voice not named)";
  const reply: Step = { title: "A reply goes back", layers: ["channels", "ui", "voice", "devices"], lines: ["out"], detail: s + "." };
  const runs: Run[] = [{ key: "m", label: "When you ask", steps: [ask, harness, model, tools, memory, reply, ops] }];

  // Nobody asked: a trigger wakes it, and it tells you when there's something to say.
  const tell = (title: string): Step => ({
    title,
    layers: ["channels", "ui", "devices"],
    lines: ["out"],
    detail: ch.state === "picked" ? `Through ${list(ch, 2)}, when there’s something to say.` : ch.state === "present" ? "Through channels it doesn’t name." : ch.state === "unused" ? "It has no channels: the work it did is the result." : "Where it tells you is not disclosed.",
  });
  const wake = (title: string, detail: string): Step => ({ title, layers: ["proactivity"], lines: ["wake"], detail });
  const trig = pr.state === "picked" ? pr.picks : [];
  const named = (ids: string[]) => trig.filter((p) => ids.includes(p.id)).map((p) => p.name);
  const clock = named(CLOCK);
  const event = named(EVENT);
  const dig = named(DIG);
  const other = trig.filter((p) => ![...CLOCK, ...EVENT, ...DIG, ...ASKED].includes(p.id)).map((p) => p.name);
  if (clock.length) runs.push({ key: "s", label: "On a schedule", steps: [wake("A schedule wakes it", `${join(clock)}: no one has to ask.`), harness, model, tools, memory, tell("It tells you"), ops] });
  if (event.length) runs.push({ key: "e", label: "On an event", steps: [wake("Something happens", `${join(event)}: another system starts it.`), harness, model, tools, memory, tell("It tells you"), ops] });
  if (dig.length) runs.push({ key: "b", label: "In the background", steps: [wake("It goes looking", `${join(dig)}: it digs on its own.`), harness, model, look, memory, tell("Then it nudges you"), ops] });
  if (other.length || pr.state === "present")
    runs.push({ key: "o", label: "On its own", steps: [wake("Something wakes it", other.length ? `${join(other)}.` : "It starts on its own; how isn’t named."), harness, model, tools, memory, tell("It tells you"), ops] });

  // Another agent calls it as tools, and the result goes back to that agent.
  if (ra.state === "picked" && ra.picks.some((p) => p.id === "mcp-server"))
    runs.push({
      key: "a",
      label: "When an agent calls",
      steps: [
        { title: "Another agent calls it", layers: ["readiness"], lines: ["in"], detail: "Through its MCP server, as tools." },
        harness,
        model,
        tools,
        memory,
        { title: "The result goes back", layers: ["readiness"], lines: ["out"], detail: "To the agent that called it." },
        ops,
      ],
    });

  const note =
    pr.state === "unknown" ? "Whether anything else starts a run is not disclosed." : pr.state === "unused" || (trig.length && trig.every((p) => ASKED.includes(p.id))) ? "Nothing else starts a run: it only acts when asked." : undefined;
  return { runs, note };
}

/** The steps an element lights in, run by run ("m3": run m, step 3; "m0": anywhere in run m). */
function tokens(runs: Run[], layer: string, lines = "") {
  const ls = lines.split(" ").filter(Boolean);
  const out: string[] = [];
  for (const r of runs) {
    const hit = r.steps.flatMap((s, i) => ((layer && s.layers.includes(layer)) || ls.some((l) => s.lines.includes(l)) ? [`${r.key}${i + 1}`] : []));
    if (hit.length) out.push(`${r.key}0`, ...hit);
  }
  return out.length ? out.join(" ") : undefined;
}

/**
 * What picking a run or a step does, for this stack's runs: show the run's steps and labels, mark its
 * name, and step back what it doesn't touch. :where() keeps these light, so pointing at a part (.peek)
 * can still light that part alone.
 */
function css(runs: Run[]) {
  const on = (v: string) => `.xp:has(.xp-in[value${v.length === 1 ? "^" : ""}="${v}"]:checked)`;
  const all = runs.flatMap((r) => r.steps.map((_, i) => `${r.key}${i + 1}`));
  const dim = (v: string, inner = "") => `:where(${on(v)})${inner} .fx:where(:not([data-steps~="${v}"]))`;
  return [
    ...runs.map((r) => `${on(r.key)} .xp-list-${r.key}{display:grid}`),
    `${runs.map((r) => `${on(r.key)} .xp-chip-${r.key}`).join(",")}{color:var(--fg);border-color:var(--line-strong)}`,
    ...runs.map((r) => `${on(r.key)} .only:not([data-runs~="${r.key}"]){display:none}`),
    `${runs.map((r) => dim(`${r.key}0`)).join(",")}{opacity:.3}`,
    `${runs.map((r) => dim(`${r.key}0`, " .xp-bom")).join(",")}{opacity:.45}`,
    `${all.map((v) => dim(v)).join(",")}{opacity:.14}`,
    `${all.map((v) => dim(v, " .xp-bom")).join(",")}{opacity:.35}`,
    `${all.map((v) => `${on(v)} .bal[data-steps~="${v}"]`).join(",")}{--on:1}`,
  ].join("\n");
}

// ——— The drawing ———
// Plan units: every plate is the same S × S square. The projection is a 2:1 axonometric (the plan's x
// runs down-right, y down-left), z straight up. Fixed geometry, no measuring.
const S = 150;
const T = 5;
const TF = 8;
const C: Pt = [75, 75];
const DX = 12; // the run's lines sit 12px apart on screen
const Lp: Pt = [75 - DX / 2, 75 + DX / 2]; // the reply's line, left of centre
const Rp: Pt = [75 + DX / 2, 75 - DX / 2]; // memory's line back up, right of centre
const Wp: Pt = [103, 47]; // the trigger's line: lands on the harness ring's right
const RING = Math.hypot(Wp[0] - 75, Wp[1] - 75);
const KEYR = 50;
const DISC = 11;
const MEM = 18;
const SLAB = 8;
const MODES = {
  wide: { W: 840, CX: 170.5, gaps: [136, 136, 152, 120], labels: true },
  narrow: { W: 341, CX: 170.5, gaps: [118, 120, 142, 104], labels: false },
};

function draw(L: Ls, runs: Run[], wide: boolean, uid: string) {
  const M = wide ? MODES.wide : MODES.narrow;
  const Z = { ops: 0, files: M.gaps[3] } as Record<Band, number>;
  Z.hands = Z.files + M.gaps[2];
  Z.brain = Z.hands + M.gaps[1];
  Z.surface = Z.brain + M.gaps[0];
  const TH: Record<Band, number> = { surface: T, brain: T, hands: T, files: TF, ops: T };
  const OY = Z.surface + 72;
  const yTop = OY - Z.surface - 50;
  const H = OY + S + T + (M.labels ? 30 : 18);
  const P = (x: number, y: number, z: number): Pt => [M.CX + x - y, OY + (x + y) / 2 - z];
  const pts = (a: Pt[]) => a.map((p) => `${r1(p[0])},${r1(p[1])}`).join(" ");
  const quad = (x0: number, y0: number, x1: number, y1: number, z: number): Pt[] => [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)];
  const sq = (x: number, y: number, h: number, z: number) => quad(x - h, y - h, x + h, y + h, z);
  const ell = (p: Pt, r: number, z: number): Ell => {
    const [cx, cy] = P(p[0], p[1], z);
    return { cx, cy, rx: r * Math.SQRT2, ry: r / Math.SQRT2 };
  };
  const ellD = (e: Ell) => `M${r1(e.cx - e.rx)},${r1(e.cy)}a${r1(e.rx)},${r1(e.ry)} 0 1,0 ${r1(2 * e.rx)},0a${r1(e.rx)},${r1(e.ry)} 0 1,0 ${r1(-2 * e.rx)},0Z`;
  const polyD = (a: Pt[]) => `M${pts(a).replace(/ /g, "L")}Z`;
  const poly = (a: Pt[]) => ({ points: pts(a) });
  const oval = (e: Ell) => ({ cx: r1(e.cx), cy: r1(e.cy), rx: r1(e.rx), ry: r1(e.ry) });
  const path = (d: string) => ({ d, fillRule: "evenodd" });
  let n = 0;
  const k = () => n++;

  /** A shape in the board's four states. `clear`: no page-coloured fill under its outline. */
  function mark(kind: "polygon" | "ellipse" | "path", at: Record<string, string | number>, band: Band, st: State, fill: Fill = "solid", clear = false) {
    const El = kind;
    if (st === "picked") return fill === "tint" ? <El key={k()} {...at} className="tint ln" /> : <El key={k()} {...at} className={fill} />;
    return (
      <Fragment key={k()}>
        {!clear && <El {...at} className="bgf" />}
        {st === "unknown" && <El {...at} fill={`url(#${uid}-hx-${band})`} />}
        <El {...at} className={st === "unused" ? "ln dash" : "ln"} />
      </Fragment>
    );
  }
  const q = (x: number, y: number, size = 9) => (
    <text key={k()} className="qm" x={r1(x)} y={r1(y + size * 0.36)} style={{ fontSize: size }}>
      ?
    </text>
  );
  const fillOf = (l: Lay): Fill => (l.def.length ? "solid" : "tint");
  /** A part, or a piece of a run's lines, that a step can light. `only`: drawn in these runs alone. */
  const fx = (layer: string, band: Band | "", lines: string, body: ReactNode, title?: string, only?: string[]) => (
    <g key={k()} className={`fx${band ? ` b-${band}` : ""}${only ? " only" : ""}`} data-layer={layer || undefined} data-steps={tokens(runs, layer, lines)} data-runs={only?.join(" ")}>
      {title && <title>{title}</title>}
      {body}
    </g>
  );
  const line = (a: Pt, b: Pt, cls: string) => <line key={k()} className={cls} x1={r1(a[0])} y1={r1(a[1])} x2={r1(b[0])} y2={r1(b[1])} />;
  const chev = (x: number, y: number, dir: "down" | "up", cls: string) => {
    const d = dir === "down" ? 1 : -1;
    return <polyline key={k()} className={cls} points={`${r1(x - 3)},${r1(y - 2 * d)} ${r1(x)},${r1(y + 1.5 * d)} ${r1(x + 3)},${r1(y - 2 * d)}`} />;
  };
  const term = (p: Pt, rose = false) => <rect key={k()} className={rose ? "term rose" : "term"} x={r1(p[0] - 1.5)} y={r1(p[1] - 1.5)} width={3} height={3} />;

  /** Where a vertical line from the plate above to a point below can be seen: from under the upper plate's front edge down to the point. */
  function span(p: Pt, upper: Band, lowerZ: number, lift = 0): Span {
    const [X, y1] = P(p[0], p[1], lowerZ + lift);
    const y0 = OY + (S - Math.abs(p[0] - p[1]) / 2) - Z[upper] + TH[upper];
    return { X, y0, y1 };
  }
  /** A vertical line in a layer's state: solid, dashed, hatched, or a line with a "?". */
  function vline(sp: Span, st: State, band: Band, cls: "run" | "ln", dir: "down" | "up") {
    const { X, y0, y1 } = sp;
    const mid = (y0 + y1) / 2;
    if (st === "unknown") {
      const a = { x: r1(X - 2.5), y: r1(y0), width: 5, height: r1(y1 - y0) };
      return (
        <Fragment key={k()}>
          <rect {...a} className="bgf" />
          <rect {...a} fill={`url(#${uid}-hx-${band})`} />
          <rect {...a} className="ln" />
        </Fragment>
      );
    }
    return (
      <Fragment key={k()}>
        {line([X, y0], [X, y1], st === "unused" ? `${cls} dash` : cls)}
        {y1 - y0 > 22 && st !== "unused" && chev(X, mid, dir, cls === "run" ? "chev" : "ln-chev")}
        {st === "present" && q(X + 9, mid - 6, 8)}
      </Fragment>
    );
  }

  const out: ReactNode[] = [];

  // Construction lines: the corners of each plate, dropped to the one below.
  {
    const cons: ReactNode[] = [];
    for (let i = 0; i < 4; i++) {
      const up = BANDS[i];
      const lo = BANDS[i + 1];
      const a = P(0, S, Z[up]);
      const c = P(S, 0, Z[up]);
      cons.push(line([a[0], a[1] + TH[up]], P(0, S, Z[lo]), "cons"), line([c[0], c[1] + TH[up]], P(S, 0, Z[lo]), "cons"));
    }
    out.push(fx("", "", "cons", cons));
  }

  function plate(band: Band) {
    const z = Z[band];
    const t = TH[band];
    // The band's name, printed flat on the plate along its back-left edge (the plan's −y axis).
    const [ex, ey] = P(11.5, S - 9, z);
    return (
      <g key={k()} className={`plate b-${band}`}>
        <polygon className="side" points={pts([P(0, S, z), P(S, S, z), P(S, S, z - t), P(0, S, z - t)])} />
        <polygon className="side" points={pts([P(S, 0, z), P(S, S, z), P(S, S, z - t), P(S, 0, z - t)])} />
        <polygon className="face" points={pts(quad(0, 0, S, S, z))} />
        <text className="eng" transform={`matrix(1,-0.5,1,0.5,${r1(ex)},${r1(ey)})`}>
          {BAND[band][0].toUpperCase()}
        </text>
      </g>
    );
  }
  const sockets = (band: Band) =>
    (PIN[band] ?? []).map((id, i) => {
      const l = L[id];
      const x = 134;
      const y = 66 + i * 18;
      const z = Z[band];
      const [X, Y] = P(x, y, z);
      return fx(id, band, "", [mark("polygon", poly(sq(x, y, 5, z)), band, l.state, fillOf(l)), l.state === "present" && q(X, Y, 7.5)], tipOf(l));
    });

  // OPS: the ground. Hosting is the pad everything stands on.
  {
    const z = Z.ops;
    const ho = L.hosting;
    const [X, Y] = P(75, 75, z);
    out.push(plate("ops"));
    out.push(fx("hosting", "ops", "", [mark("polygon", poly(quad(40, 40, 110, 110, z)), "ops", ho.state, "tint"), ho.state === "present" && q(X, Y + 14, 9)], tipOf(ho)));
    out.push(...sockets("ops"));
  }

  // FILES: the one solid thing in the drawing. Memory is a block of slabs, one per kind, standing in a
  // tray: the sessions and files it keeps.
  let lift = 0;
  {
    const z = Z.files;
    const { memory: me, storage: sto } = L;
    out.push(plate("files"));
    const tray: ReactNode[] = [];
    if (sto.state === "picked") {
      for (let i = 0; i < Math.min(3, uses(sto).length); i++) tray.push(<polygon key={k()} {...poly(quad(24 + i * 5, 24 + i * 5, 126 - i * 5, 126 - i * 5, z))} className={sto.def.length ? "ln" : "ln soft"} />);
    } else if (sto.state === "unknown") {
      tray.push(mark("path", path(polyD(quad(24, 24, 126, 126, z)) + polyD(quad(32, 32, 118, 118, z))), "files", "unknown"));
    } else {
      const [X, Y] = P(24, 126, z);
      tray.push(mark("polygon", poly(quad(24, 24, 126, 126, z)), "files", sto.state), sto.state === "present" && q(X + 12, Y - 4, 8));
    }
    out.push(fx("storage", "files", "", tray, tipOf(sto)));

    const x0 = 75 - MEM;
    const x1 = 75 + MEM;
    const y0 = 75 - MEM;
    const y1 = 75 + MEM;
    const faces = (za: number, zb: number) => ({
      top: quad(x0, y0, x1, y1, zb),
      left: [P(x0, y1, zb), P(x1, y1, zb), P(x1, y1, za), P(x0, y1, za)],
      right: [P(x1, y0, zb), P(x1, y1, zb), P(x1, y1, za), P(x1, y0, za)],
    });
    const blk: ReactNode[] = [];
    if (me.state === "picked") {
      const ps = me.picks.slice(0, 4);
      lift = ps.length * SLAB;
      // The first pick on top.
      ps.forEach((p, i) => {
        const zb = z + lift - i * SLAB;
        const f = faces(zb - SLAB, zb);
        const cls = p.supported ? "tint ln" : "mass";
        blk.push(
          <g key={k()}>
            <title>{p.name + (p.note ? `: ${p.note}` : "") + (p.supported ? " (configurable)" : "")}</title>
            <polygon className={cls} points={pts(f.left)} />
            <polygon className={cls} points={pts(f.right)} />
            {i === 0 && <polygon className={cls} points={pts(f.top)} />}
          </g>,
        );
        if (i > 0) blk.push(<polyline key={k()} className="cut" points={pts([P(x0, y1, zb), P(x1, y1, zb), P(x1, y0, zb)])} />);
      });
      // The block's own edges, cut in the page colour so the faces read as one solid.
      blk.push(<polyline key={k()} className="cut" points={pts([P(x0, y1, z + lift), P(x1, y1, z + lift), P(x1, y0, z + lift)])} />);
      blk.push(line(P(x1, y1, z + lift), P(x1, y1, z), "cut"));
      if (me.picks.length > 4) {
        const [X, Y] = P(x1, y1, z);
        blk.push(
          <text key={k()} className="lbl" x={r1(X + 10)} y={r1(Y - 4)}>
            +{me.picks.length - 4}
          </text>,
        );
      }
    } else if (me.state === "unused") {
      blk.push(mark("polygon", poly(quad(x0, y0, x1, y1, z)), "files", "unused"));
    } else {
      lift = 16;
      const f = faces(z, z + lift);
      for (const side of ["left", "right", "top"] as const) blk.push(mark("polygon", poly(f[side]), "files", me.state));
      const c = P(75, y1, z + 8);
      if (me.state === "present") blk.push(q(c[0], c[1] + 2, 9));
    }
    out.push(fx("memory", "files", "", blk, tipOf(me)));
  }

  // HANDS: eight keys around a hub. The call drops into the hub; a trace runs to every key it uses.
  const keyPts: { id: string; pts: Pt[] }[] = [];
  {
    const z = Z.hands;
    out.push(plate("hands"));
    out.push(fx("", "", "act", <ellipse className="guide" {...oval(ell(C, KEYR, z))} />));
    HANDS.forEach((id, i) => {
      const l = L[id];
      const th = ((-90 + 22.5 + 45 * i) * Math.PI) / 180;
      const du = Math.SQRT2 * KEYR * Math.cos(th);
      const dv = (KEYR / Math.SQRT2) * Math.sin(th);
      const px = 75 + (du + 2 * dv) / 2;
      const py = 75 + (2 * dv - du) / 2;
      const at = (r: number): Pt => [75 + ((px - 75) * r) / KEYR, 75 + ((py - 75) * r) / KEYR];
      const body: ReactNode[] = [];
      if (on(l)) {
        const a = P(...at(10), z);
        const b = P(...at(KEYR - 8), z);
        body.push(line(a, b, "ln soft"));
        keyPts.push({ id, pts: [a, b] });
      }
      const [X, Y] = P(px, py, z);
      body.push(mark("polygon", poly(sq(px, py, 5.5, z)), "hands", l.state, fillOf(l)), l.state === "present" && q(X, Y, 8));
      out.push(fx(id, "hands", "", body, tipOf(l)));
    });
    for (const [p, run] of [
      [C, "act mem"],
      [Rp, "read"],
    ] as [Pt, string][])
      out.push(fx("", "", run, <ellipse className="hole" {...oval(ell(p, 2.6, z))} />));
  }

  // BRAIN: the harness is the ring the run goes round; the model is the disc at its centre.
  const ringE = ell(C, RING, Z.brain);
  {
    const z = Z.brain;
    const { harness: h, model: m } = L;
    out.push(plate("brain"));
    const e = ringE;
    const ring: ReactNode[] = [];
    if (h.state === "picked") {
      for (let i = 0; i < Math.min(2, uses(h).length); i++) ring.push(<ellipse key={k()} className={h.def.length ? "ln" : "ln soft"} {...oval(ell(C, RING - i * 5, z))} />);
    } else if (h.state === "unknown") {
      ring.push(mark("path", path(ellD(ell(C, RING + 3.5, z)) + ellD(ell(C, RING - 3.5, z))), "brain", "unknown"));
    } else {
      ring.push(mark("ellipse", oval(e), "brain", h.state, "solid", true), h.state === "present" && q(e.cx + e.rx * 0.72 + 7, e.cy - e.ry * 0.72 - 4, 9));
    }
    // Which way it goes round.
    if (h.state === "picked" || h.state === "present") {
      const x = e.cx;
      const y = e.cy + e.ry;
      ring.push(<polyline key={k()} className="ln-chev" points={`${r1(x + 2)},${r1(y - 3)} ${r1(x - 1.5)},${r1(y)} ${r1(x + 2)},${r1(y + 3)}`} />);
    }
    out.push(fx("harness", "brain", "", ring, tipOf(h)));
    const de = ell(C, DISC, z);
    out.push(fx("model", "brain", "", [mark("ellipse", oval(de), "brain", m.state, fillOf(m)), m.state === "present" && q(de.cx + de.rx + 7, de.cy - 3, 9)], tipOf(m)));
    out.push(...sockets("brain"));
  }

  // SURFACE: ports along the front edge, one per channel, traced in to the inlet. The clock is what wakes it.
  {
    const z = Z.surface;
    const { channels: ch, proactivity: pr } = L;
    out.push(plate("surface"));
    out.push(fx("", "surface", "in out", <ellipse className="ln soft" {...oval(ell(C, 14, z))} />));
    const ports: ReactNode[] = [];
    if (ch.state === "picked") {
      // One pitch for every stack, like a connector: a dense stack has a long row, a sparse one a short row.
      const ps = ch.picks;
      const step = ps.length > 1 ? Math.min(9, 102 / (ps.length - 1)) : 0;
      const xa = 67 - (step * (ps.length - 1)) / 2;
      const w = 2.4;
      ps.forEach((p, i) => {
        const x = xa + i * step;
        const dx = 75 - x;
        const dy = 75 - 126;
        const d = Math.hypot(dx, dy);
        ports.push(
          line(P(x, 126, z), P(75 - (dx / d) * 14, 75 - (dy / d) * 14, z), "ln soft"),
          <polygon key={k()} className={p.supported ? "tint ln" : "solid"} points={pts(quad(x - w, 127, x + w, 138, z))}>
            <title>{p.name}</title>
          </polygon>,
        );
      });
    } else {
      const [X, Y] = P(67, 133, z);
      ports.push(mark("polygon", poly(quad(16, 128, 118, 138, z)), "surface", ch.state), ch.state === "present" && q(X, Y, 8));
    }
    out.push(fx("channels", "surface", "", ports, tipOf(ch)));
    for (const [p, run] of [
      [C, "in"],
      [Lp, "out"],
    ] as [Pt, string][])
      out.push(fx("", "", run, <ellipse className="hole" {...oval(ell(p, 2.6, z))} />));
    // The clock: one tick per kind of trigger.
    const ce = ell(Wp, 8, z);
    const clock: ReactNode[] = [];
    if (pr.state === "picked") {
      clock.push(<ellipse key={k()} className="solid" {...oval(ce)} />);
      const ticks = uses(pr).length;
      for (let i = 0; i < ticks; i++) {
        const a = (2 * Math.PI * i) / ticks - Math.PI / 2;
        clock.push(line([ce.cx + Math.cos(a) * ce.rx * 0.62, ce.cy + Math.sin(a) * ce.ry * 0.62], [ce.cx + Math.cos(a) * ce.rx, ce.cy + Math.sin(a) * ce.ry], "cut"));
      }
      clock.push(line([ce.cx, ce.cy], [ce.cx + ce.rx * 0.38, ce.cy - ce.ry * 0.38], "cut"));
    } else {
      clock.push(mark("ellipse", oval(ce), "surface", pr.state), pr.state === "present" && q(ce.cx, ce.cy, 8));
    }
    out.push(fx("proactivity", "surface", "", clock, tipOf(pr)));
    out.push(...sockets("surface"));
  }

  // The runs' lines.
  const { memory: me, retrieval: rt, proactivity: pr } = L;
  const keys = runs.map((r) => r.key);
  const [cX, cS] = P(C[0], C[1], Z.surface);
  const [lX, lS] = P(Lp[0], Lp[1], Z.surface);
  // In: from above, onto the surface, then down to the model. A message, or another agent's call.
  const inTop: Span = { X: cX, y0: yTop, y1: cS };
  const inMid = span(C, "surface", Z.brain);
  out.push(fx("", "surface", "in", [vline(inTop, "picked", "surface", "run", "down"), vline(inMid, "picked", "surface", "run", "down"), term(P(C[0], C[1], Z.brain))]));
  // Wake: the clock's line down to the ring.
  const wake = span(Wp, "surface", Z.brain);
  out.push(fx("proactivity", "surface", "wake", vline(wake, pr.state, "surface", "run", "down")));
  // Act: from the model down into the hub of the hands.
  const act = span(C, "brain", Z.hands);
  out.push(fx("", "hands", "act", vline(act, "picked", "hands", "run", "down")));
  // Memory: on down into the block, and back up its own line to the model.
  const memDown = span(C, "hands", Z.files, lift);
  out.push(fx("memory", "files", "mem", vline(memDown, me.state === "unused" || me.state === "unknown" ? me.state : "picked", "files", "run", "down")));
  const rtSt: State = me.state === "unused" ? "unused" : rt.state;
  const readLo = span(Rp, "hands", Z.files, lift);
  const readHi = span(Rp, "brain", Z.hands);
  out.push(fx("retrieval", "files", "read", [vline(readLo, rtSt, "files", "ln", "up"), vline(readHi, rtSt === "present" ? "picked" : rtSt, "files", "ln", "up")]));
  if (me.state !== "unused") out.push(fx("memory", "files", "mem", term(P(C[0], C[1], Z.files + lift))));
  if (rtSt === "picked" || rtSt === "present") out.push(fx("retrieval", "files", "read", term(P(Rp[0], Rp[1], Z.brain), true)));
  // Out: up from the model, out through the surface. A reply, a word when nobody asked, or a result.
  const outMid = span(Lp, "surface", Z.brain);
  const outTop: Span = { X: lX, y0: yTop, y1: lS };
  out.push(fx("", "surface", "out", [vline(outMid, "picked", "surface", "run", "up"), vline(outTop, "picked", "surface", "run", "up")]));
  // What the lines carry, in each run's words.
  const said = (lines: "in" | "out", text: string, only: string[]) =>
    only.length > 0 &&
    fx(
      "",
      "surface",
      lines,
      <text className="lbl" x={r1(lines === "in" ? cX + 8 : lX - 8)} y={r1(yTop + 8)} textAnchor={lines === "in" ? undefined : "end"}>
        {text}
      </text>,
      undefined,
      only,
    );
  out.push(
    said("in", "message", keys.filter((r) => r !== "a")),
    said("in", "call", keys.filter((r) => r === "a")),
    said("out", "reply", keys.filter((r) => r === "m")),
    said("out", "result", keys.filter((r) => r === "a")),
    said("out", "tells you", keys.filter((r) => r !== "m" && r !== "a")),
  );

  // The dot's paths, through what can be seen only: one list of phases per step of every run.
  const rnd = (p: Pt[]): Pt[] => p.map(([x, y]) => [r1(x), r1(y)]);
  const dn = (sp: Span) => rnd([[sp.X, sp.y0], [sp.X, sp.y1]]);
  const upw = (sp: Span) => rnd([[sp.X, sp.y1], [sp.X, sp.y0]]);
  const ringPts: Pt[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 64;
    ringPts.push([ringE.cx + Math.cos(a) * ringE.rx, ringE.cy + Math.sin(a) * ringE.ry]);
  }
  // The loop starts where the trigger lands: the ring's right end.
  const ringLoop = rnd(ringPts.slice(16).concat(ringPts.slice(1, 17)));
  const de = ell(C, DISC, Z.brain);
  const one = (pts: Pt[], rose = false): Phase => ({ lines: [{ pts, rose }] });
  const anim: Record<string, Phase[]> = {};
  for (const r of runs)
    r.steps.forEach((s, i) => {
      const ph: Phase[] = [];
      if (s.lines.includes("in")) ph.push(one(dn(inTop)), one(dn(inMid)));
      if (s.lines.includes("wake") && pr.state !== "unused") ph.push(one(dn(wake)));
      if (s.layers.includes("harness") && L.harness.state !== "unused") ph.push(one(ringLoop));
      if (s.layers.includes("model")) ph.push({ pulse: { cx: r1(de.cx), cy: r1(de.cy), rx: r1(de.rx), ry: r1(de.ry) } });
      if (s.lines.includes("act")) {
        ph.push(one(dn(act)));
        const traces = keyPts.filter((p) => s.layers.includes(p.id));
        if (traces.length) ph.push({ lines: traces.map((p) => ({ pts: rnd(p.pts) })) });
      }
      if (s.lines.includes("mem") && me.state !== "unused") ph.push(one(dn(memDown)), one(upw(readLo), true), one(upw(readHi), true));
      if (s.lines.includes("out")) ph.push(one(upw(outMid)), one(upw(outTop)));
      if (ph.length) anim[`${r.key}${i + 1}`] = ph;
    });

  // Balloons: the step numbers, where each happens, in each run.
  {
    const yB = P(75, 75, Z.brain)[1];
    const yO = P(75, 75, Z.ops)[1];
    const mid = (a: Span) => (a.y0 + a.y1) / 2;
    const at: Record<string, Pt> = {
      in: [M.CX + 22, yTop + 22],
      wake: [wake.X + 13, mid(wake)],
      harness: [ringE.cx - ringE.rx - 13, yB],
      model: [M.CX - 32, yB],
      act: [act.X - 13, mid(act)],
      mem: [readLo.X + 13, Math.max(readLo.y0 + 9, mid(readLo))],
      out: [M.CX - DX - 14, yTop + 22],
      cons: [M.CX - 92, yO],
    };
    const where = (s: Step) => ["in", "wake", "act", "mem", "out"].find((l) => s.lines.includes(l)) ?? (s.layers.includes("harness") ? "harness" : s.layers.includes("model") ? "model" : "cons");
    const bals = new Map<string, { at: Pt; n: number; runs: string[] }>();
    for (const r of runs)
      r.steps.forEach((s, i) => {
        const id = `${where(s)} ${i + 1}`;
        const b = bals.get(id) ?? { at: at[where(s)], n: i + 1, runs: [] };
        b.runs.push(r.key);
        bals.set(id, b);
      });
    for (const { at: [x, y], n, runs: rs } of bals.values())
      out.push(
        <g key={k()} className="fx bal only" data-runs={rs.join(" ")} data-steps={rs.flatMap((r) => [`${r}0`, `${r}${n}`]).join(" ")}>
          <circle cx={r1(x)} cy={r1(y)} r={6.5} />
          <text x={r1(x)} y={r1(y + 3.2)}>
            {n}
          </text>
        </g>,
      );
  }

  // Wide: the parts list beside the plates, a leader to each.
  if (M.labels) {
    const x0 = 400;
    const RH = 15.5;
    const mx = x0 + 104;
    const vx = x0 + 121;
    const room = M.W - vx - 4;
    for (const band of BANDS) {
      const [rX, yk] = P(S, 0, Z[band]);
      out.push(line([rX + 8, yk + 0.5], [x0 - 18, yk + 0.5], "leader"));
      out.push(
        <g key={k()} className={`b-${band}`}>
          <rect className="sw" x={x0 - 14} y={r1(yk - 2.5)} width={6} height={6} />
          <text className="hd" x={x0} y={r1(yk + 3.5)}>
            {BAND[band][0].toUpperCase()}
          </text>
          <text className="hs" x={r1(x0 + capW(BAND[band][0]) + 10)} y={r1(yk + 3.5)}>
            {BAND[band][1]}
          </text>
        </g>,
      );
      Object.values(L)
        .filter((l) => l.band === band)
        .forEach((l, i) => {
          const y = yk + 3.5 + (i + 1) * RH + 3;
          let value: ReactNode;
          if (l.state !== "picked") {
            value = (
              <>
                {mark("polygon", poly([[mx + 1.5, y - 8.5], [mx + 8.5, y - 8.5], [mx + 8.5, y - 1.5], [mx + 1.5, y - 1.5]]), band, l.state)}
                {l.state === "present" && q(mx + 5, y - 5, 6.5)}
                <text className="v mut" x={vx} y={r1(y)}>
                  {SAY[l.state]}
                </text>
              </>
            );
          } else {
            const ps = uses(l);
            const lead = ps.find((p) => p.logo);
            const tail = l.def.length ? (l.conf.length ? ` · or ${l.conf[0].name}${l.conf.length > 1 ? ` +${l.conf.length - 1}` : ""}` : "") : " · configurable";
            const names = ps.map((p) => p.name);
            let txt = "";
            for (let j = Math.min(names.length, 5); j >= 1; j--) {
              txt = names.slice(0, j).join(", ") + (j < names.length ? ` +${names.length - j}` : "");
              if (tw(txt) + tw(tail, 11) <= room) break;
            }
            value = (
              <>
                {lead ? <use className="lg" href={`/logos.svg#${lead.logo}`} x={mx} y={r1(y - 10)} width={11} height={11} /> : <rect className={l.def.length ? "solid" : "tint ln"} x={mx + 2} y={r1(y - 8)} width={6} height={6} />}
                <text className="v" x={vx} y={r1(y)}>
                  {txt}
                  {tail && <tspan className="mut">{tail}</tspan>}
                </text>
              </>
            );
          }
          out.push(
            <g key={k()} className={`fx row b-${band}`} data-layer={l.id} data-steps={tokens(runs, l.id)}>
              <title>{tipOf(l)}</title>
              <rect className="hit" x={x0} y={r1(y - 11)} width={M.W - x0} height={RH} />
              <text className="k" x={x0} y={r1(y)}>
                {l.short}
              </text>
              {value}
            </g>,
          );
        });
    }
  }

  return { out, anim, W: M.W, H: r1(H) };
}

function Figure({ L, runs, wide, uid, label }: { L: Ls; runs: Run[]; wide: boolean; uid: string; label: string }) {
  const { out, anim, W, H } = draw(L, runs, wide, uid);
  return (
    <svg className={`xp-svg ${wide ? "xp-wide" : "xp-narrow"}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-anim={JSON.stringify(anim)}>
      <defs>
        {BANDS.map((b) => (
          <pattern key={b} id={`${uid}-hx-${b}`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0.5" y1="0" x2="0.5" y2="4" className={`hx b-${b}`} />
          </pattern>
        ))}
      </defs>
      {out}
      <g className="dots" />
    </svg>
  );
}

/** A small square in one of the four states (or a configurable pick), for the list and the key. */
const Swatch = ({ st }: { st: State | "conf" }) => <i className={`sw ${st}`} aria-hidden="true" />;

/** The parts, plate by plate: shown under the drawing on small screens, read by screen readers on all. */
function Parts({ L, runs }: { L: Ls; runs: Run[] }) {
  return (
    <div className="xp-bom">
      {BANDS.map((band) => (
        <section key={band} className={`b-${band}`}>
          <h4>
            <i />
            {BAND[band][0]} <span>{BAND[band][1]}</span>
          </h4>
          <dl>
            {Object.values(L)
              .filter((l) => l.band === band)
              .map((l) => {
                const ps = uses(l);
                const shown = ps.length <= 4 ? ps : ps.slice(0, 3);
                const lead = ps.find((p) => p.logo);
                return (
                  <div key={l.id} className="fx" data-layer={l.id} data-steps={tokens(runs, l.id)} title={tipOf(l)}>
                    <dt>{l.short}</dt>
                    <dd>
                      {l.state !== "picked" ? (
                        <>
                          <Swatch st={l.state} />
                          <span className="mut">{SAY[l.state]}</span>
                        </>
                      ) : (
                        <>
                          {lead ? (
                            <svg className="logo" aria-hidden="true">
                              <use href={`/logos.svg#${lead.logo}`} />
                            </svg>
                          ) : (
                            <Swatch st={l.def.length ? "picked" : "conf"} />
                          )}
                          <span>
                            {shown.map((p) => p.name).join(", ")}
                            {ps.length > shown.length && <span className="mut"> +{ps.length - shown.length}</span>}
                            {l.def.length > 0 && l.conf.length > 0 && <span className="mut"> · or {l.conf.map((p) => p.name).join(", ")}</span>}
                            {!l.def.length && <span className="mut"> · configurable</span>}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The exploded view of a stack (or of the board being edited). `blueprint` is the blueprint radio's id. */
export function Exploded({ name, slots, blueprint, id = "xp" }: { name: string; slots: Slot[]; blueprint: string; id?: string }) {
  const L = norm(slots);
  const { runs, note } = runsOf(L);
  const { summary } = strip(slots);
  const label = `${name}, pulled apart into five plates, from where you reach it down to where it runs. ${summary}.`;
  // One group for runs and steps: "m0" is the whole of run m, "m3" its third step.
  const radio = (v: string, first = false) => <input type="radio" className="xp-in sr-only" name={`${id}-step`} id={`${id}-${v}`} value={v} defaultChecked={first} />;
  return (
    <div className="xp" id={id}>
      <style>{css(runs)}</style>
      <div className="xp-body">
        <div className="xp-run">
          <div className="xp-head">
            <h3>{runs.length > 1 ? `${runs.length} kinds of run` : "The run"}</h3>
            <ExplodedRun />
          </div>
          <div className="xp-runs" aria-label="Runs">
            {runs.map((r, i) => (
              <Fragment key={r.key}>
                {radio(`${r.key}0`, i === 0)}
                <label className={`xp-chip xp-chip-${r.key}`} htmlFor={`${id}-${r.key}0`}>
                  {r.label}
                </label>
              </Fragment>
            ))}
          </div>
          {note && (
            <p className="xp-note">
              <Swatch st={L.proactivity.state === "unknown" ? "unknown" : "unused"} />
              {note}
            </p>
          )}
          {runs.map((r) => (
            <ol key={r.key} className={`xp-steps xp-list-${r.key}`} aria-label={r.label}>
              {r.steps.map((s, i) => (
                <li key={s.title}>
                  {radio(`${r.key}${i + 1}`)}
                  <label className="xp-step" htmlFor={`${id}-${r.key}${i + 1}`}>
                    <span className="n">{i + 1}</span>
                    <span className="t">{s.title}</span>
                    <span className="d">{s.detail}</span>
                  </label>
                </li>
              ))}
            </ol>
          ))}
          <p className="xp-hint">Pick a step to follow it; pick it again for the whole run.</p>
        </div>
        <div className="xp-fig">
          <Figure L={L} runs={runs} wide uid={`${id}-w`} label={label} />
          <Figure L={L} runs={runs} wide={false} uid={`${id}-n`} label={label} />
        </div>
        <Parts L={L} runs={runs} />
      </div>
      <div className="xp-foot">
        <ul className="xp-key" aria-label="Key">
          <li>
            <Swatch st="picked" />
            named
          </li>
          <li>
            <Swatch st="present" />
            in use, not named
          </li>
          <li>
            <Swatch st="unknown" />
            not disclosed
          </li>
          <li>
            <Swatch st="unused" />
            not used
          </li>
          <li>
            <i className="run" aria-hidden="true" />
            a run
          </li>
          <li>
            <i className="run rose" aria-hidden="true" />
            memory, fed back up
          </li>
        </ul>
        <label htmlFor={blueprint} className="print">
          <span>{summary}</span>
          <span className="go">Blueprint →</span>
        </label>
      </div>
    </div>
  );
}
