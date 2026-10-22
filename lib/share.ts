import type { Draft } from "./types";

// Share links live in the URL hash so the site stays fully static.
export function encodeDraft(d: Draft): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: d.name, from: d.from, layers: d.layers }));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDraft(s: string): Draft | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return d && typeof d.name === "string" && d.layers && typeof d.layers === "object" ? (d as Draft) : null;
  } catch {
    return null;
  }
}

/** Enough of a layer to check a draft against: its id and its options' ids. */
type LayerIds = { id: string; options: { id: string }[] };

/**
 * Fit a saved or shared draft to today's layers. Options sometimes move to another layer:
 * a pick only one other layer owns follows it there, a pick no layer owns any more is dropped.
 */
export function normalizeDraft(d: Draft, layers: LayerIds[]) {
  const owners = new Map<string, string[]>();
  for (const l of layers) for (const o of l.options) owners.set(o.id, [...(owners.get(o.id) ?? []), l.id]);
  const out: Record<string, string[]> = {};
  const moved: { id: string; to: string }[] = [];
  const dropped: string[] = [];
  const add = (layerId: string, id: string) => {
    if (!out[layerId]?.includes(id)) out[layerId] = [...(out[layerId] ?? []), id];
  };
  for (const [layerId, ids] of Object.entries(d.layers)) {
    for (const id of [ids].flat()) {
      if (typeof id !== "string") continue;
      const own = owners.get(id) ?? [];
      if (own.includes(layerId)) add(layerId, id);
      else if (own.length === 1) {
        add(own[0], id);
        moved.push({ id, to: own[0] });
      } else dropped.push(id);
    }
  }
  return { draft: { ...d, layers: out }, moved, dropped };
}

/** A stack saved in this browser (see /mine/). */
export type Saved = Draft & { id: string; savedAt?: number };

const KEY = "agentic-stack:saved";
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function loadSaved(): Saved[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    // Saves from before ids existed get one now; names no longer have to be unique to tell rows apart.
    return Array.isArray(list) ? list.filter((d) => d && d.layers).map((d) => ({ ...d, id: d.id ?? newId() })) : [];
  } catch {
    return [];
  }
}

export function storeSaved(list: Saved[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

/** The same picks in every layer, in any order. */
export const sameLayers = (a: Record<string, string[]>, b: Record<string, string[]>) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => b[k] && a[k].length === b[k].length && a[k].every((id) => b[k].includes(id)))
  );
};
