"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { newFileUrl, slugify } from "@/lib/github";
import { prettyUrl } from "@/lib/links";
import { decodeDraft, encodeDraft, loadSaved, newId, normalizeDraft, sameLayers, storeSaved } from "@/lib/share";
import { EMPTY, disclosureMark, disclosureOf, emptyState, kindCount } from "@/lib/disclosure";
import { slots } from "@/lib/simple";
import type { Draft, Layer, Stack } from "@/lib/types";
import { Board } from "./Board";
import { Simple } from "./Simple";
import { Views, blueprintFor } from "./Views";
import { Logo } from "./Logo";
import { Ext } from "./Ext";

type Preset = {
  slug: string;
  name: string;
  kind: string;
  site?: string;
  logo?: string;
  layers: Record<string, string[]>;
} & Pick<Stack, "disclosure" | "notUsed" | "inUseUndisclosed" | "closedLayers" | "supports" | "researched">;

const fromPreset = (p: Preset): Draft => ({ name: p.name, from: p.slug, layers: structuredClone(p.layers) });
const UNTITLED = "Untitled stack";

/** What the last action did. Notes with `ms` fade; the others stay until the next edit. */
type Status = { text: string; href?: string; link?: string; ms?: number; undo?: { draft: Draft; label: string } };

export function Editor({
  layers,
  presets,
  initial,
  repo,
}: {
  layers: Layer[];
  presets: Preset[];
  initial: string;
  repo: string;
}) {
  const bySlug = useMemo(() => new Map(presets.map((p) => [p.slug, p])), [presets]);
  const [draft, setDraft] = useState<Draft>(() => fromPreset(bySlug.get(initial) ?? presets[0]));
  const [status, setStatus] = useState<Status | null>(null);
  const note = (text: string, ms = 2200) => setStatus({ text, ms });
  // A share link the clipboard refused, left on screen to copy by hand.
  const [copyUrl, setCopyUrl] = useState<string | null>(null);
  // Only start rewriting the URL once the visitor has changed something.
  const touched = useRef(false);
  const edit: typeof setDraft = (v) => {
    touched.current = true;
    setStatus(null);
    setCopyUrl(null);
    setDraft(v);
  };

  // Hydrate from a share link (#s=…) or a remix link (#from=slug), and again on Back and Forward.
  // A layout effect, so the linked stack is on the board by the first paint (layout.tsx hides it till then).
  useLayoutEffect(() => {
    const read = () => {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const s = h.get("s");
        const from = h.get("from");
        const d = s ? decodeDraft(s) : null;
        if (d) {
          // Old links can name options that have since moved layer: say what changed rather than drop it silently.
          const { draft: fixed, moved, dropped } = normalizeDraft(d, layers);
          setDraft(fixed);
          const to = [...new Set(moved.map((m) => layers.find((l) => l.id === m.to)?.name))].join(", ");
          const says = [
            moved.length && `${moved.length === 1 ? "1 pick" : `${moved.length} picks`} moved to ${to}`,
            dropped.length && `${dropped.length === 1 ? "1 pick no longer exists and was" : `${dropped.length} picks no longer exist and were`} removed`,
          ].filter(Boolean);
          if (says.length) note(says.join(" · "), 8000);
        } else if (from && bySlug.has(from)) {
          setDraft(fromPreset(bySlug.get(from)!));
        }
      } finally {
        document.documentElement.removeAttribute("data-hash-stack");
      }
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, [bySlug, layers]);

  const undoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!status?.ms) return;
    // An Undo with focus stays until the next edit, so the fade never drops focus to the page.
    const t = setTimeout(() => document.activeElement !== undoButton.current && setStatus(null), status.ms);
    return () => clearTimeout(t);
  }, [status]);

  const preset = draft.from ? bySlug.get(draft.from) : undefined;
  const dirty = !preset || preset.name !== draft.name || !sameLayers(preset.layers, draft.layers);

  // Keep the URL in sync so reloads and copied address bars never lose work.
  useEffect(() => {
    if (!touched.current) return;
    const t = setTimeout(() => {
      history.replaceState(null, "", dirty || !preset ? `#s=${encodeDraft(draft)}` : `#from=${preset.slug}`);
    }, 150);
    return () => clearTimeout(t);
  }, [draft, dirty, preset]);

  const update = (layerId: string, picks: string[]) =>
    edit((d) => {
      const next = { ...d.layers };
      if (picks.length) next[layerId] = picks;
      else delete next[layerId];
      // A changed product stack isn't the product any more: the first change renames it.
      const p = d.from ? bySlug.get(d.from) : undefined;
      return { ...d, name: p && d.name === p.name ? `${p.name} remix` : d.name, layers: next };
    });

  /** Load a preset. Changes are confirmed first, and kept one Back step away. */
  const loadPreset = (p: Preset, ask = `Discard your changes and load ${p.name}?`) => {
    if (dirty && touched.current && !confirm(ask)) return false;
    if (dirty) {
      // Leave the remix in this history entry and add a new one, so Back brings it back.
      history.replaceState(null, "", `#s=${encodeDraft(draft)}`);
      history.pushState(null, "", `#from=${p.slug}`);
    }
    edit(fromPreset(p));
    return true;
  };

  const shuffle = () => {
    const pool = presets.filter((p) => p.slug !== draft.from);
    loadPreset(pool[Math.floor(Math.random() * pool.length)], "Discard your changes and load a random stack?");
  };

  // An unchanged stack shares as its own short link; a remix carries the whole draft.
  const shareUrl = () => (preset && !dirty ? `${location.origin}/#from=${preset.slug}` : `${location.origin}/#s=${encodeDraft(draft)}`);

  const share = async () => {
    const url = shareUrl();
    history.replaceState(null, "", url);
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: `Stackprints / ${draft.name.trim() || UNTITLED}`, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      note("Link copied");
    } catch {
      setStatus({ text: "Copy this link:" });
      setCopyUrl(url);
    }
  };

  const save = () => {
    const name = draft.name.trim() || UNTITLED;
    const list = loadSaved();
    const same = list.find((d) => d.name === name);
    // Saving the same stack again refreshes it; a different stack under that name asks first.
    if (same && !sameLayers(same.layers, draft.layers) && !confirm(`Replace your saved “${name}”?`)) {
      note("Not saved. Rename the stack to keep both.", 5000);
      return;
    }
    const saved = { name, from: draft.from, layers: draft.layers, id: same?.id ?? newId(), savedAt: Date.now() };
    storeSaved([saved, ...list.filter((d) => d !== same)]);
    setStatus({ text: `Saved “${name}”`, href: "/mine/", link: "View in Mine", ms: 8000 });
  };

  const kinds = [...new Set(presets.map((p) => p.kind))].sort();
  // A new stack keeps the category it started from unless its author picks another when publishing.
  const [publishing, setPublishing] = useState(false);
  const [meta, setMeta] = useState({ author: "", authorUrl: "", tagline: "", description: "", kind: "" });
  const kind = preset && !dirty ? preset.kind : meta.kind || (preset?.kind ?? "Personal agent");
  // The same parts as a published stack (renamed or not) is that stack, not a new one.
  const copy = Boolean(preset && sameLayers(preset.layers, draft.layers));
  const name = draft.name.trim() || UNTITLED;
  const base = slugify(name) || "my-stack";
  const slug = bySlug.has(base) ? `${base}-remix` : base;
  const stackJson =
    JSON.stringify(
      {
        slug,
        name,
        kind,
        tagline: meta.tagline,
        description: meta.description,
        ...(meta.author ? { author: { name: meta.author, ...(meta.authorUrl ? { url: meta.authorUrl } : {}) } } : {}),
        layers: Object.fromEntries(Object.entries(draft.layers).map(([k, v]) => [k, v.length === 1 ? v[0] : v])),
      },
      null,
      2,
    ) + "\n";
  const field = (k: keyof typeof meta) => ({
    value: meta[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setMeta((m) => ({ ...m, [k]: e.target.value })),
  });

  const kindHint = (k: string) => kindCount(presets.filter((p) => p.kind === k));
  const mark = preset ? disclosureMark(preset) : null;

  // The stack menu lists every stack under its kind; the find box narrows it by name or kind.
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const groups = kinds
    .map((k) => ({ kind: k, stacks: presets.filter((p) => p.kind === k && (!q || `${p.name} ${p.kind}`.toLowerCase().includes(q))) }))
    .filter((g) => g.stacks.length);
  const stackMenu = useRef<HTMLDetailsElement>(null);
  const jumpTo = useRef<string | null>(null);
  /** The category menu opens the stack menu at that category, rather than loading one of its stacks. */
  const showKind = (k: string) => {
    setFind("");
    jumpTo.current = k;
    // After MenuCloser has closed the category menu.
    setTimeout(() => {
      if (stackMenu.current) stackMenu.current.open = true;
    });
  };
  /** The stack menu opens scrolled to a category: the one just picked, else this stack's own. */
  const onStackMenu = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const list = e.currentTarget.querySelector("ul");
    const k = jumpTo.current;
    jumpTo.current = null;
    if (!e.currentTarget.open || !list) return;
    const head = list.querySelector<HTMLElement>(`[data-kind="${CSS.escape(k ?? kind)}"]`);
    if (!head) return;
    list.scrollTop = head.offsetTop - list.offsetTop;
    if (k) head.nextElementSibling?.querySelector("button")?.focus({ preventScroll: true });
  };

  // Empty slots keep the preset's meaning, except the ones the visitor cleared: those read "not used".
  // "Supported" marks only hold while the preset is unchanged.
  const cleared = preset ? Object.keys(preset.layers).filter((id) => !draft.layers[id]?.length) : [];
  const knowable = preset && {
    ...preset,
    notUsed: [...(preset.notUsed ?? []), ...cleared],
    supports: dirty ? undefined : preset.supports,
  };
  const hidden = { unknown: 0, present: 0 };
  for (const l of layers) {
    const state = draft.layers[l.id] ? "unused" : emptyState(knowable, l.id);
    if (state !== "unused") hidden[state]++;
  }

  /** Closes the dropdown an element is in, focus back on its toggle rather than lost to the page. */
  const closeMenu = (el: Element) => {
    const dd = el.closest("details");
    dd?.removeAttribute("open");
    dd?.querySelector("summary")?.focus();
  };

  /** A native select listing a layer's options not yet picked. */
  const picker = (layer: Layer, picks: string[], label: string, aria: string) => {
    const rest = layer.options.filter((o) => !picks.includes(o.id));
    if (!rest.length) return null;
    // "None", "Single agent" and the like stand alone: picking one replaces the layer, picking anything else drops it.
    const add = (id: string) => {
      const o = layer.options.find((x) => x.id === id);
      if (!o) return;
      update(layer.id, o.exclusive ? [o.id] : [...picks.filter((p) => !layer.options.find((x) => x.id === p)?.exclusive), o.id]);
    };
    return (
      <select className={picks.length ? "add" : "add fill"} aria-label={aria} value="" onChange={(e) => add(e.target.value)}>
        <option value="">{label}</option>
        {rest.map((o) => (
          <option key={o.id} value={o.id}>
            {`${o.exclusive && picks.length ? "Replace with " : ""}${o.name}${o.note ? ` — ${o.note}` : ""}`}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="editor">
      <nav className="title" aria-label="Breadcrumb">
        <button className="shuffle" onClick={shuffle} title="Load a random stack" aria-label="Load a random stack">
          ↻
        </button>
        <details className="dd crumb">
          <summary>{kind}</summary>
          <ul className="dd-menu">
            {kinds.map((k) => (
              <li key={k}>
                <button aria-current={k === kind ? "true" : undefined} onClick={() => showKind(k)}>
                  <span>{k}</span>
                  <small>{kindHint(k)}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>
        <span className="slash" aria-hidden="true">
          /
        </span>
        <details className="dd crumb current" ref={stackMenu} onToggle={onStackMenu}>
          <summary>
            {preset?.logo && !dirty && <Logo option={{ name: preset.name, logo: preset.logo }} />}
            <h2>{draft.name || UNTITLED}</h2>
          </summary>
          <div className="dd-menu stacks">
            <label className="dd-rename">
              <input
                value={draft.name}
                aria-label="Rename this stack"
                placeholder="Name your stack"
                spellCheck={false}
                onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && closeMenu(e.currentTarget)}
              />
            </label>
            <input
              className="dd-find"
              type="search"
              value={find}
              aria-label="Find a stack"
              placeholder="Find a stack"
              spellCheck={false}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !groups.length) return;
                const at = e.currentTarget;
                if (loadPreset(groups[0].stacks[0])) closeMenu(at);
              }}
            />
            <ul>
              {groups.map((g) => (
                <Fragment key={g.kind}>
                  <li role="presentation" className="dd-group" data-kind={g.kind}>
                    {g.kind}
                  </li>
                  {g.stacks.map((p) => (
                    <li key={p.slug}>
                      <button aria-current={p.slug === draft.from && !dirty ? "true" : undefined} onClick={() => loadPreset(p)}>
                        <span className="dd-item">
                          {p.logo && <Logo option={{ name: p.name, logo: p.logo }} />}
                          {p.name}
                        </span>
                        {disclosureMark(p) && <small>{disclosureMark(p)}</small>}
                      </button>
                    </li>
                  ))}
                </Fragment>
              ))}
              {!groups.length && <li className="dd-group">No stack matches</li>}
            </ul>
          </div>
        </details>
      </nav>
      <div className="meta-line">
        {/* Read as on the stack page: what is known, then what isn't. */}
        {Object.keys(draft.layers).length} {hidden.unknown + hidden.present ? "known layers" : "layers"}
        {hidden.present > 0 && ` · ${hidden.present} in use, undisclosed`}
        {hidden.unknown > 0 && ` · ${hidden.unknown} ${EMPTY.unknown.toLowerCase()}`}
        {mark && !dirty && (
          <>
            {" · "}
            <span title={disclosureOf(preset!)!.about}>{mark}</span>
          </>
        )}
        {preset && dirty && (
          <>
            {" · remixed from "}
            <Link href={`/stack/${preset.slug}/`}>{preset.name}</Link>
            {preset.disclosure === "example" && " (example)"}
            {" · "}
            <button className="link" onClick={() => loadPreset(preset, `Discard your changes and reset to ${preset.name}?`)}>
              reset
            </button>
          </>
        )}
        {/* The product's own site and page belong to the product, not to a remix of it. */}
        {preset?.site && !dirty && (
          <>
            {" · "}
            <a href={preset.site} rel="noopener">
              {prettyUrl(preset.site)}
              <Ext />
            </a>
          </>
        )}
        {preset && !dirty && <> · <Link href={`/stack/${preset.slug}/`}>about this stack</Link></>}
      </div>

      {/* Simple first; the blueprint is where parts are added and removed. */}
      <Views
        id="view"
        bar={
          <div className="toolbar" role="toolbar" aria-label="Stack actions" id="publish">
            <button onClick={save}>Save</button>
            <button onClick={share}>Share</button>
            <button onClick={() => setPublishing((v) => !v)} aria-expanded={publishing}>
              Publish as a page
            </button>
            <span className="status" aria-live="polite">
              {status?.text}
              {status?.href && (
                <>
                  {" · "}
                  <Link href={status.href}>{status.link}</Link>
                </>
              )}
              {status?.undo && (
                <>
                  {" · "}
                  <button
                    ref={undoButton}
                    className="link"
                    onClick={() => {
                      const { draft: before, label } = status.undo!;
                      const focused = document.activeElement === undoButton.current;
                      edit(before);
                      // Focus goes back to the pick it brought back.
                      if (focused) requestAnimationFrame(() => document.querySelector<HTMLElement>(`button.x[aria-label="${CSS.escape(label)}"]`)?.focus());
                    }}
                  >
                    Undo
                  </button>
                </>
              )}
            </span>
            {copyUrl && (
              <span className="copy-link">
                <input readOnly value={copyUrl} aria-label="Share link" autoFocus onFocus={(e) => e.currentTarget.select()} />
                <button
                  onClick={() => {
                    setCopyUrl(null);
                    setStatus(null);
                  }}
                >
                  Done
                </button>
              </span>
            )}
          </div>
        }
        after={
    publishing &&
            (copy ? (
              <div className="publish">
                <p className="muted small">
                  This is {preset!.name} as published. Change at least one part to publish your own version.
                </p>
              </div>
            ) : (
              <div className="publish">
                <p className="muted small">
                  Your stack gets its own page at <code>/stack/{slug}/</code>, with its own preview image, once the pull
                  request merges.
                </p>
                <div className="fields row2">
                  <label>
                    <span>Your name</span>
                    <input {...field("author")} placeholder="Ada Lovelace" />
                  </label>
                  <label>
                    <span>Your link</span>
                    <input {...field("authorUrl")} placeholder="https://x.com/ada" inputMode="url" />
                  </label>
                  <label>
                    <span>Category</span>
                    <select {...field("kind")} value={kind}>
                      {kinds.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Tagline</span>
                    <input {...field("tagline")} maxLength={90} placeholder="One line people read in the grid." />
                  </label>
                  <label className="wide">
                    <span>How it works</span>
                    <textarea {...field("description")} rows={3} placeholder="Two or three sentences." />
                  </label>
                </div>
                <div className="toolbar">
                  {meta.tagline && meta.description ? (
                    <a className="btn" href={newFileUrl(repo, `content/stacks/${slug}.json`, stackJson)} target="_blank" rel="noopener">
                      Open pull request
                    </a>
                  ) : (
                    <span className="muted small">Add a tagline and description to open a pull request.</span>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(stackJson);
                        note(`Copied content/stacks/${slug}.json`);
                      } catch {
                        note("Clipboard unavailable");
                      }
                    }}
                  >
                    Copy JSON
                  </button>
                </div>
              </div>
            ))
        }
        simple={
          <Simple
            name={name}
            slots={slots(layers, Object.fromEntries(layers.map((l) => [l.id, (draft.layers[l.id] ?? []).map((id) => l.options.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => Boolean(o))])), knowable || undefined)}
            blueprint={blueprintFor("view")}
          />
        }
        blueprint={
          <Board
            slots={layers}
            modules={layers
              .filter((l) => draft.layers[l.id])
              .map((layer) => ({
                layer,
                picks: draft.layers[layer.id]
                  .map((id) => layer.options.find((o) => o.id === id))
                  .filter((o): o is NonNullable<typeof o> => Boolean(o)),
              }))}
            // As on the stack page: a stack's revision is its research date; an edited board is a draft.
            label={`${name.toUpperCase()}${dirty ? " · DRAFT" : preset?.researched ? ` · REV ${preset.researched}` : ""}`}
            stack={knowable}
            source={preset && dirty ? preset.name : undefined}
            onRemove={(layerId, id) => {
              // A slipped tap shouldn't cost a pick: the removal can be undone until the next edit.
              const before = draft;
              const name = layers.find((l) => l.id === layerId)?.options.find((o) => o.id === id)?.name ?? id;
              const focused = document.activeElement instanceof HTMLButtonElement && document.activeElement.classList.contains("x");
              update(layerId, draft.layers[layerId].filter((p) => p !== id));
              setStatus({ text: `Removed ${name}`, undo: { draft: before, label: `Remove ${name}` }, ms: 8000 });
              // The × goes with its chip: keyboard focus moves to Undo rather than to the page.
              if (focused) requestAnimationFrame(() => undoButton.current?.focus());
            }}
            addSlot={(layerId) => {
              const layer = layers.find((l) => l.id === layerId)!;
              const picks = draft.layers[layerId];
              return picker(layer, picks, "+", `Add to ${layer.name}`);
            }}
            emptySlot={(slot) => picker(layers.find((l) => l.id === slot.id)!, [], `+ ${slot.name}`, `Add ${slot.name}`)}
          />
        }
      />
    </div>
  );
}
