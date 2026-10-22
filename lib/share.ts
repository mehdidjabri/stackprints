import type { Draft } from "./types";

// Share links live in the URL hash so the site stays fully static.
export function encodeDraft(d: Draft): string {
  const bytes = new TextEncoder().encode(JSON.stringify(d));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDraft(s: string): Draft | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return d && typeof d.name === "string" && d.layers ? (d as Draft) : null;
  } catch {
    return null;
  }
}

const KEY = "agentic-stack:saved";

export function loadSaved(): Draft[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function storeSaved(list: Draft[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}
