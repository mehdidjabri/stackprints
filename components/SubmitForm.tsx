"use client";

import { useState } from "react";
import { newFileUrl, slugify } from "@/lib/github";
import type { Layer } from "@/lib/types";
import { Board } from "./Board";

type L = Pick<Layer, "id" | "name" | "band" | "ref" | "description">;

export function SubmitForm({ layers, repo }: { layers: L[]; repo: string }) {
  const [layer, setLayer] = useState(layers[0].id);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const id = slugify(name);
  const option = {
    id,
    name: name.trim(),
    ...(url.trim() ? { url: url.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(open ? { open: true } : {}),
  };
  const json = JSON.stringify(option, null, 2) + "\n";
  const file = `content/options/${layer}/${id || "your-product"}.json`;
  const l = layers.find((x) => x.id === layer)!;
  const ready = id && name.trim();

  return (
    <div className="submit">
      <form className="fields" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>Layer</span>
          <select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {layers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <small>{l.description}</small>
        </label>
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Memory" required />
        </label>
        <label>
          <span>Website</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="acme.dev" inputMode="url" />
        </label>
        <label>
          <span>Subtitle</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={60}
            placeholder="Memory API for agents"
          />
          <small>{60 - note.length} characters left. Say what it is, not how great it is.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          <span>Open source or open weights</span>
        </label>
      </form>

      <div className="preview">
        <Board
          modules={[{ layer: l, picks: [{ id: id || "x", name: name || "Your product", note: note || "Your subtitle" }] }]}
        />
        <pre>
          <code>{json}</code>
        </pre>
        <div className="toolbar">
          {ready ? (
            <a className="btn" href={newFileUrl(repo, file, json)} target="_blank" rel="noopener">
              Open pull request
            </a>
          ) : (
            <span className="btn muted" aria-disabled="true">
              Open pull request
            </span>
          )}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(json);
                setCopied(true);
              } catch {}
            }}
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
        <p className="muted small">
          Creates <code>{file}</code>. To add your logo, upload a one-colour SVG with a viewBox, under 8 KB, to{" "}
          <code>content/logos/{id || "your-product"}.svg</code> in the same pull request and add{" "}
          <code>&quot;logo&quot;: &quot;{id || "your-product"}&quot;</code>.
        </p>
      </div>
    </div>
  );
}
