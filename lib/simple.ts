// The simple view of a stack: five sentences, one per band, in board order, read from the same
// picks as the blueprint. Pure data in, tokens out, so the server-rendered stack pages and the
// editor on the home page say a stack the same way.
import { type Knowable, emptyState, isSupported } from "./disclosure";
import type { Layer, Option, Stack } from "./types";

type Band = Layer["band"];
export type Part = Pick<Option, "id" | "name" | "note" | "logo"> & { supported?: boolean; /** How a sentence says it, when not by its name. */ say?: string };

/** One layer of the stack: what it runs, or what its emptiness means. */
export type Slot = {
  id: string;
  name: string;
  band: Band;
  state: "picked" | "unknown" | "present" | "unused";
  picks: Part[];
};

export type Token =
  /** Glue words, said quietly. */
  | string
  /** A part the stack uses: its mark and its name. */
  | { part: Part }
  /** Something it can do, said as words; the title names the parts behind it. */
  | { verb: string; title?: string; part?: Part }
  /** The three honest empties, drawn the board's way. */
  | { unknown: string }
  | { present: string }
  | { unused: string }
  /** "and 11 more": the rest is in the blueprint. */
  | { more: string; names: string[] };

export type Line = { band: Band; tokens: Token[] };

/** Generic options read as words in a sentence ("your laptop"); products keep their names. */
const SAY: Record<string, string> = {
  "model/any-model": "any model",
  "hosting/your-laptop": "your laptop",
  "hosting/home-server-vps": "a home server / VPS",
  "hosting/vendor-cloud": "the maker’s cloud",
  "hosting/self-hosted-runners": "your own runners",
  "channels/cli-tui": "the terminal",
  "channels/ide": "your IDE",
  "channels/desktop-app": "a desktop app",
  "channels/web-chat": "the web",
  "channels/mobile-app": "a mobile app",
  "channels/sms-rcs": "SMS",
  "channels/email": "email",
  "channels/phone-calls": "phone calls",
  "memory/agent-notes": "its own notes",
  "connectors/calendar-email": "calendar & email",
};

/** How a part is said: its phrase if it's generic, else its name. */
export const said = (layer: string, p: Part) => SAY[`${layer}/${p.id}`] ?? p.name;

const BANDS: Band[] = ["surface", "brain", "hands", "files", "ops"];
const STATE_TEXT = { picked: "fitted", unknown: "not disclosed", present: "in use, not disclosed", unused: "not used" } as const;
const ND = { unknown: "not disclosed" };

/** The stack's 28 layers as slots, from its picks and its disclosure. */
export function slots(layers: Pick<Layer, "id" | "name" | "band">[], picks: Record<string, Part[]>, stack?: Knowable & Pick<Stack, "supports">): Slot[] {
  return layers.map((l) => {
    const ps = (picks[l.id] ?? []).map((p) => ({ ...p, supported: isSupported(stack, l.id, p.id) }));
    return { id: l.id, name: l.name, band: l.band, picks: ps, state: ps.length ? "picked" : emptyState(stack, l.id) };
  });
}

/** "A, B and C". */
function join(items: Token[][], conj: string): Token[] {
  return items.flatMap((t, i) => [...(i === 0 ? [] : [i === items.length - 1 ? ` ${conj} ` : ", "]), ...t]);
}

/** The first few parts, then "and N more" (or "or N others"), which the blueprint lists in full. */
function list(layer: string, parts: Part[], max: number, conj: "and" | "or"): Token[] {
  const shown = parts.length <= max + 1 ? parts : parts.slice(0, max);
  const rest = parts.slice(shown.length);
  const items = shown.map((p): Token[] => [{ part: { ...p, say: said(layer, p) } }]);
  if (!rest.length) return join(items, conj);
  // "A, B, C and 11 more": commas throughout, the conjunction goes with the count.
  return [...items.flatMap((t, i) => [...(i ? [", "] : []), ...t]), " ", { more: conj === "or" ? `or ${rest.length} others` : `and ${rest.length} more`, names: rest.map((p) => said(layer, p)) }];
}

/** What a layer runs by default; when it only lists configurable picks, those. */
function runs(s?: Slot) {
  if (!s) return [];
  const def = s.picks.filter((p) => !p.supported);
  return def.length ? def : s.picks;
}
const on = (s?: Slot) => s?.state === "picked" || s?.state === "present";
const names = (s?: Slot) => (s?.picks ?? []).map((p) => p.name).join(", ");
const titleOf = (...ss: (Slot | undefined)[]) =>
  ss
    .filter((s): s is Slot => Boolean(s))
    .map((s) => `${s.name}: ${names(s) || STATE_TEXT[s.state]}`)
    .join("\n");

function surface(name: string, L: Record<string, Slot>): Token[] {
  const ch = L.channels;
  const out: Token[] = [];
  if (!ch || ch.state === "unknown") out.push(`Where you talk to ${name} is `, ND);
  else if (ch.state === "present") out.push(`You talk to ${name} through `, { present: "channels not named" });
  else if (ch.state === "unused") out.push(`You don’t talk to ${name} directly: `, { unused: "no channels" });
  else out.push(`You talk to ${name} through `, ...list("channels", runs(ch), 3, "and"));
  if (on(L.proactivity)) out.push(", and it can ", { verb: "start on its own", title: titleOf(L.proactivity) });
  out.push(".");
  return out;
}

function brain(L: Record<string, Slot>): Token[] {
  const { model: m, harness: h, router: r } = L;
  const mKnown = m?.state === "picked";
  const hKnown = h?.state === "picked";
  if (!mKnown && !hKnown) {
    const out: Token[] = ["Its model and harness are ", ND];
    if (r?.state === "picked") out.push("; its calls go through ", ...list("router", runs(r), 2, "and"));
    out.push(".");
    return out;
  }
  const out: Token[] = ["It thinks with "];
  if (mKnown) out.push(...list("model", runs(m), 1, "or"));
  else if (m?.state === "present") out.push({ present: "a model not named" });
  else out.push("a model that is ", ND);
  out.push(", inside ");
  if (hKnown) out.push(...list("harness", runs(h), 2, "or"));
  else if (h?.state === "present") out.push({ present: "a harness not named" });
  else out.push("a harness that is ", ND);
  out.push(".");
  return out;
}

/** Hands are said as verbs: what it can do, not what it is made of. */
const WHETHER: Record<string, string> = {
  tools: "has built-in tools",
  search: "searches the web",
  sandbox: "runs code in a sandbox",
  browser: "uses a browser",
  mcp: "connects MCP tools",
  connectors: "uses your apps",
  payments: "makes payments",
  skills: "learns skills",
};

function hands(L: Record<string, Slot>): Token[] {
  const can: Token[][] = [];
  const toolNames = names(L.tools);
  if (/bash|edit|write/i.test(toolNames) || on(L.sandbox)) can.push([{ verb: "edit files and run code", title: titleOf(L.tools, on(L.sandbox) ? L.sandbox : undefined) }]);
  else if (on(L.tools)) can.push([{ verb: "use built-in tools", title: titleOf(L.tools) }]);
  if (/image/i.test(toolNames)) can.push([{ verb: "make images", title: titleOf(L.tools) }]);
  if (on(L.search)) can.push([{ verb: "search the web", title: titleOf(L.search) }]);
  if (on(L.browser)) can.push([{ verb: "use a browser", title: titleOf(L.browser) }]);
  if (on(L.connectors)) {
    const apps = runs(L.connectors).map((p) => said("connectors", p));
    can.push([{ verb: `use your ${apps.length ? apps.join(" and ") : "apps"}`, title: titleOf(L.connectors) }]);
  }
  if (on(L.payments)) can.push([{ verb: "make payments", title: titleOf(L.payments) }]);
  if (on(L.mcp)) {
    const mcp = runs(L.mcp).find((p) => p.id === "mcp");
    can.push([mcp ? { verb: "connect", part: mcp, title: titleOf(L.mcp) } : { verb: "connect tools", title: titleOf(L.mcp) }]);
  }
  if (on(L.skills)) can.push([{ verb: "learn skills", title: titleOf(L.skills) }]);

  const hidden = Object.keys(WHETHER).filter((id) => L[id]?.state === "unknown");
  if (!can.length) return ["What it can do is ", ND, "."];
  const out: Token[] = ["It can ", ...join(can, "and")];
  if (hidden.length > 2) out.push("; the rest is ", ND);
  else if (hidden.length) out.push(`; whether it ${hidden.map((id) => WHETHER[id]).join(" or ")} is `, ND);
  out.push(".");
  return out;
}

function files(L: Record<string, Slot>): Token[] {
  const { memory: m, storage: st } = L;
  const mHidden = !m || m.state === "unknown";
  const sHidden = !st || st.state === "unknown";
  if (mHidden && sHidden) return ["What it remembers, and where, is ", ND, "."];
  const out: Token[] = [];
  if (m?.state === "picked") out.push("It remembers with ", ...list("memory", runs(m), 2, "and"));
  else if (m?.state === "present") out.push("It remembers, with ", { present: "memory not named" });
  else if (m?.state === "unused") out.push("It keeps ", { unused: "no long-term memory" });
  else out.push("Its memory is ", ND);
  if (st?.state === "picked") out.push(", and keeps sessions in ", ...list("storage", runs(st), 1, "and"));
  else if (st?.state === "present") out.push(", and keeps sessions in ", { present: "a store not named" });
  else if (sHidden) out.push("; where it keeps sessions is ", ND);
  out.push(".");
  return out;
}

function ops(L: Record<string, Slot>): Token[] {
  const h = L.hosting;
  if (!h || h.state === "unknown") return ["Where it runs is ", ND, "."];
  if (h.state === "present") return ["It runs on ", { present: "hosting not named" }, "."];
  if (h.state === "unused") return ["Where it runs is ", { unused: "not said" }, "."];
  return ["It runs on ", ...list("hosting", runs(h), 3, "or"), "."];
}

/** The stack in five sentences. `name` is how the first one names it. */
export function lines(name: string, all: Slot[]): Line[] {
  const L = Object.fromEntries(all.map((s) => [s.id, s]));
  const say: Record<Band, () => Token[]> = {
    surface: () => surface(name, L),
    brain: () => brain(L),
    hands: () => hands(L),
    files: () => files(L),
    ops: () => ops(L),
  };
  return BANDS.map((band) => ({ band, tokens: say[band]() }));
}

/** The strip: every layer as a cell in board order, and how much of the stack is known. */
export function strip(all: Slot[]) {
  const count = { picked: 0, unknown: 0, present: 0, unused: 0 };
  for (const s of all) count[s.state]++;
  const known = count.unknown + count.present ? " layers known" : " layers";
  const summary = [
    `${count.picked} of ${all.length}${known}`,
    ...(count.present ? [`${count.present} in use, not disclosed`] : []),
    ...(count.unknown ? [`${count.unknown} not disclosed`] : []),
    ...(count.unused ? [`${count.unused} not used`] : []),
  ].join(" · ");
  const bands = BANDS.map((band) => ({
    band,
    cells: all.filter((s) => s.band === band).map((s) => ({ id: s.id, state: s.state, title: `${s.name}: ${s.state === "picked" ? names(s) : STATE_TEXT[s.state]}` })),
  }));
  return { summary, bands };
}

/**
 * A line as plain text, for the markdown twins and the API: nothing to click there, so a long list
 * is spelled out in full instead of "and 11 more".
 */
export function sentence(tokens: Token[]) {
  let out = "";
  for (const t of tokens) {
    if (typeof t === "string") out += t;
    else if ("verb" in t) out += t.part ? `${t.verb} ${t.part.say ?? t.part.name} tools` : t.verb;
    else if ("part" in t) out += `${t.part.say ?? t.part.name}${t.part.supported ? " (configurable)" : ""}`;
    else if ("unknown" in t) out += t.unknown;
    else if ("present" in t) out += `${t.present} (in use)`;
    else if ("unused" in t) out += t.unused;
    else {
      // "A, B, C and 11 more" becomes "A, B, C, D, … and N".
      const conj = t.more.startsWith("or") ? "or" : "and";
      const rest = t.names;
      out = `${out.trimEnd()}, ${rest.slice(0, -1).join(", ")}${rest.length > 1 ? ` ${conj} ` : ""}${rest.at(-1)}`;
    }
  }
  return out;
}
