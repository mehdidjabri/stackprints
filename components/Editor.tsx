"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BANDS } from "@/lib/bands";
import { decodeDraft, encodeDraft, loadSaved, storeSaved } from "@/lib/share";
import type { Draft, Layer } from "@/lib/types";

type Preset = { slug: string; name: string; kind: string; layers: Record<string, string[]> };

const fromPreset = (p: Preset): Draft => ({ name: p.name, from: p.slug, layers: structuredClone(p.layers) });

export function Editor({ layers, presets, initial }: { layers: Layer[]; presets: Preset[]; initial: string }) {
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

  const copyJson = async () => {
    const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-stack";
    const json = JSON.stringify(
      { slug, name: draft.name, tagline: "", description: "", kind: preset?.kind ?? "custom", layers: draft.layers },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`JSON copied, add it as content/stacks/${slug}.json`);
    } catch {
      setStatus("Clipboard unavailable");
    }
  };

  const unused = layers.filter((l) => !draft.layers[l.id]);

  return (
    <div className="editor">
      <h1 className="title">
        <Link href="/">Agentic Stack</Link>
        <span className="slash" aria-hidden="true">/</span>
        <input
          className="detail name-input"
          value={draft.name}
          aria-label="Stack name"
          spellCheck={false}
          onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
          size={Math.max(6, draft.name.length)}
        />
      </h1>
      <div className="meta-line">
        {preset ? (
          <>
            <Link href={`/stack/${preset.slug}/`}>{preset.kind}</Link>
            {dirty && <span className="muted"> · remixed from {preset.name}</span>}
          </>
        ) : (
          <span className="muted">custom stack</span>
        )}
        <span className="muted"> · {Object.keys(draft.layers).length} layers</span>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Stack actions">
        <button onClick={shuffle}>Shuffle</button>
        <button onClick={save}>Save</button>
        <button onClick={share}>Share</button>
        <button onClick={copyJson}>Contribute JSON</button>
        {preset && dirty && <button onClick={() => edit(fromPreset(preset))}>Reset</button>}
        <span className="status" aria-live="polite">
          {status}
        </span>
      </div>

      <div className="stack">
        {BANDS.map(([band, label]) => {
          const rows = layers.filter((l) => l.band === band && draft.layers[l.id]);
          if (!rows.length) return null;
          return (
            <section key={band} className="band" aria-label={label}>
              <div className="band-name">{label}</div>
              {rows.map((layer) => {
                const picks = draft.layers[layer.id];
                const rest = layer.options.filter((o) => !picks.includes(o.id));
                return (
                  <div key={layer.id} className="row">
                    <div className="row-label">
                      <Link href={`/layer/${layer.id}/`}>{layer.name}</Link>
                    </div>
                    <div className="row-picks">
                      {picks.map((id) => {
                        const o = layer.options.find((x) => x.id === id);
                        if (!o) return null;
                        return (
                          <span key={id} className="pick" title={o.note}>
                            {o.name}
                            <button
                              className="x"
                              aria-label={`Remove ${o.name}`}
                              onClick={() => update(layer.id, picks.filter((p) => p !== id))}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {rest.length > 0 && (
                        <select
                          className="add"
                          aria-label={`Add to ${layer.name}`}
                          value=""
                          onChange={(e) => e.target.value && update(layer.id, [...picks, e.target.value])}
                        >
                          <option value="">+</option>
                          {rest.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                              {o.note ? ` — ${o.note}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {unused.length > 0 && (
          <div className="row add-layer">
            <div className="row-label muted">Add layer</div>
            <div className="row-picks">
              <select
                className="add"
                aria-label="Add a layer"
                value=""
                onChange={(e) => {
                  const l = layers.find((x) => x.id === e.target.value);
                  if (l) update(l.id, [l.options[0].id]);
                }}
              >
                <option value="">+ layer</option>
                {unused.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
