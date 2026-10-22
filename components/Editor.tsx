"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { newFileUrl, slugify } from "@/lib/github";
import { decodeDraft, encodeDraft, loadSaved, storeSaved } from "@/lib/share";
import type { Draft, Layer } from "@/lib/types";
import { Board } from "./Board";

type Preset = { slug: string; name: string; kind: string; layers: Record<string, string[]> };

const fromPreset = (p: Preset): Draft => ({ name: p.name, from: p.slug, layers: structuredClone(p.layers) });

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
  const [status, setStatus] = useState("");
  // Only start rewriting the URL once the visitor has changed something.
  const touched = useRef(false);
  const edit: typeof setDraft = (v) => {
    touched.current = true;
    setDraft(v);
  };

  // Hydrate from a share link (#s=…) or a remix link (#from=slug).
  useEffect(() => {
    const read = () => {
      const h = new URLSearchParams(location.hash.slice(1));
      const s = h.get("s");
      const from = h.get("from");
      if (s) {
        const d = decodeDraft(s);
        if (d) setDraft(d);
      } else if (from && bySlug.has(from)) {
        setDraft(fromPreset(bySlug.get(from)!));
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [bySlug]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 2200);
    return () => clearTimeout(t);
  }, [status]);

  const preset = draft.from ? bySlug.get(draft.from) : undefined;
  const dirty = !preset || preset.name !== draft.name || JSON.stringify(preset.layers) !== JSON.stringify(draft.layers);

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
      return { ...d, layers: next };
    });

  const shuffle = () => {
    if (dirty && touched.current && !confirm("Discard your changes and load a random stack?")) return;
    const pool = presets.filter((p) => p.slug !== draft.from);
    const p = pool[Math.floor(Math.random() * pool.length)];
    edit(fromPreset(p));
  };

  const shareUrl = () => `${location.origin}/#s=${encodeDraft(draft)}`;

  const share = async () => {
    const url = shareUrl();
    history.replaceState(null, "", url);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `Agentic Stack / ${draft.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch {
      setStatus("Link is in the address bar");
    }
  };

  const save = () => {
    const list = loadSaved().filter((d) => d.name !== draft.name);
    storeSaved([draft, ...list]);
    setStatus(`Saved “${draft.name}”`);
  };

  const [publishing, setPublishing] = useState(false);
  const [meta, setMeta] = useState({ author: "", authorUrl: "", tagline: "", description: "" });
  const base = slugify(draft.name) || "my-stack";
  const slug = bySlug.has(base) ? `${base}-remix` : base;
  const stackJson =
    JSON.stringify(
      {
        slug,
        name: draft.name,
        kind: preset && !dirty ? preset.kind : "Personal stack",
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
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setMeta((m) => ({ ...m, [k]: e.target.value })),
  });

  const kinds = [...new Set(presets.map((p) => p.kind))].sort();
  const kind = preset?.kind ?? "Personal stack";

  /** A native select listing a layer's options not yet picked. */
  const picker = (layer: Layer, picks: string[], label: string, aria: string) => {
    const rest = layer.options.filter((o) => !picks.includes(o.id));
    if (!rest.length) return null;
    return (
      <select
        className={picks.length ? "add" : "add fill"}
        aria-label={aria}
        value=""
        onChange={(e) => e.target.value && update(layer.id, [...picks, e.target.value])}
      >
        <option value="">{label}</option>
        {rest.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.note ? ` — ${o.note}` : ""}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="editor">
      <nav className="title" aria-label="Breadcrumb">
        <details className="dd crumb">
          <summary>{kind}</summary>
          <ul className="dd-menu">
            {kinds.map((k) => (
              <li key={k}>
                <button
                  aria-current={k === kind ? "true" : undefined}
                  onClick={() => k !== kind && edit(fromPreset(presets.find((p) => p.kind === k)!))}
                >
                  <span>{k}</span>
                  <small>{presets.filter((p) => p.kind === k).length}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>
        <span className="slash" aria-hidden="true">
          /
        </span>
        <details className="dd crumb">
          <summary>
            <h2>{draft.name || "Untitled"}</h2>
          </summary>
          <div className="dd-menu">
            <label className="dd-rename">
              <input
                value={draft.name}
                aria-label="Rename this stack"
                placeholder="Name your stack"
                spellCheck={false}
                onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.closest("details")?.removeAttribute("open")}
              />
            </label>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {presets
                .filter((p) => p.kind === kind)
                .map((p) => (
                  <li key={p.slug}>
                    <button
                      aria-current={p.slug === draft.from && !dirty ? "true" : undefined}
                      onClick={() => edit(fromPreset(p))}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </details>
        <button className="shuffle" onClick={shuffle} title="Load a random stack" aria-label="Load a random stack">
          ↻
        </button>
      </nav>
      <div className="meta-line">
        {Object.keys(draft.layers).length} layers
        {preset && dirty && (
          <>
            {" · remixed from "}
            <Link href={`/stack/${preset.slug}/`}>{preset.name}</Link>
            {" · "}
            <button className="link" onClick={() => edit(fromPreset(preset))}>
              reset
            </button>
          </>
        )}
        {preset && !dirty && <> · <Link href={`/stack/${preset.slug}/`}>about this stack</Link></>}
      </div>

      <div className="toolbar" role="toolbar" aria-label="Stack actions" id="publish">
        <button onClick={save}>Save</button>
        <button onClick={share}>Share</button>
        <button onClick={() => setPublishing((v) => !v)} aria-expanded={publishing}>
          Publish as a page
        </button>
        <span className="status" aria-live="polite">
          {status}
        </span>
      </div>

      {publishing && (
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
            <label className="wide">
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
              <span className="btn muted" aria-disabled="true">
                Add a tagline and description
              </span>
            )}
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(stackJson);
                  setStatus(`Copied content/stacks/${slug}.json`);
                } catch {
                  setStatus("Clipboard unavailable");
                }
              }}
            >
              Copy JSON
            </button>
          </div>
        </div>
      )}

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
        label={`${draft.name.toUpperCase()} · REV ${dirty ? "X" : "1"}`}
        onRemove={(layerId, id) => update(layerId, draft.layers[layerId].filter((p) => p !== id))}
        addSlot={(layerId) => {
          const layer = layers.find((l) => l.id === layerId)!;
          const picks = draft.layers[layerId];
          return picker(layer, picks, "+", `Add to ${layer.name}`);
        }}
        emptySlot={(slot) => picker(layers.find((l) => l.id === slot.id)!, [], `+ ${slot.name}`, `Add ${slot.name}`)}
      />
    </div>
  );
}
