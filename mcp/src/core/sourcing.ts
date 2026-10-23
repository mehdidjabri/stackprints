// The sourcing gate every proposal passes: new URLs must have been fetched by this server, and
// changed facts must quote the page they come from (or be marked for a human to check).
import type { ManualClaim } from "./changeset";
import { ToolError } from "./tool";
import { RECEIPT_MS, containsQuote, normalizeUrl, pageFor, windowText } from "./receipts";
import type { StateStore } from "./state";
import type { Files } from "./types";

export type Claim = { field: string; url: string; quote: string; vendorReported?: boolean };

/** Every https URL anywhere in a JSON value. */
export function urlsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    if (/^https:\/\/\S+$/.test(v)) out.add(v);
  } else if (Array.isArray(v)) for (const x of v) urlsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) urlsIn(x, out);
  return out;
}

/** Every URL already cited anywhere in the content: citing one again needs no new fetch. */
export function knownUrls(files: Files) {
  const out = new Set<string>();
  for (const [p, t] of files) {
    if (!p.startsWith("content/") || !p.endsWith(".json")) continue;
    for (const m of t.matchAll(/"(https:\/\/[^"\s]+)"/g)) {
      try {
        out.add(normalizeUrl(m[1]));
      } catch {}
    }
  }
  return out;
}

/**
 * Throws unless every URL is either already in the content or was fetched by this server within
 * `maxAgeMs` (14 days, the default; the hot list asks for 48 hours).
 */
export async function requireFetched(state: StateStore, urls: Iterable<string>, known: Set<string>, now: number, options?: { maxAgeMs?: number }) {
  const missing: string[] = [];
  for (const u of urls) {
    let n: string;
    try {
      n = normalizeUrl(u);
    } catch {
      missing.push(u);
      continue;
    }
    if (known.has(n)) continue;
    if (!(await pageFor(state, u, now, options))) missing.push(u);
  }
  if (missing.length)
    throw new ToolError(
      `Fetch these with fetch_source first (or search_x for posts on X), then propose again: only pages this server has read in the last ${windowText(Math.min(options?.maxAgeMs ?? RECEIPT_MS, RECEIPT_MS))} can be cited.`,
      { notFetched: missing },
    );
}

/**
 * Each claim's quote must appear on the page at its URL, as this server fetched it. A claim that
 * can't be checked that way goes in `manual` with a reason instead.
 */
export async function verifyClaims(state: StateStore, claims: Claim[], now: number) {
  const failed: { field: string; url: string; reason: string }[] = [];
  for (const c of claims) {
    const page = await pageFor(state, c.url, now);
    if (!page) failed.push({ field: c.field, url: c.url, reason: "not fetched by fetch_source in the last 14 days" });
    else if (c.quote.trim().length < 8) failed.push({ field: c.field, url: c.url, reason: "quote too short to check (8 characters at least)" });
    else if (!containsQuote(page.text, c.quote)) failed.push({ field: c.field, url: c.url, reason: "quote not found on the page as fetched" });
  }
  if (failed.length)
    throw new ToolError(
      "Some claims could not be checked against their pages. Fix the quotes, or move a claim to `manual` with a reason if its page can't be read by machine (that sends the change for review).",
      { failed },
    );
}

export const manualLine = (m: ManualClaim) => `MANUAL CHECK ${m.field} <${m.url}>: ${m.reason}`;

const SAFE_INLINE_MAX = 200;

/**
 * Text from a page or a post, made safe for one line of a commit message or a PR body: one line
 * with no control, zero-width or direction characters, markdown links and images reduced to their
 * words, no backticks, at most 200 characters, in a code span, so nothing in it renders, links,
 * mentions anyone or reads as a trailer such as Co-authored-by.
 */
export function safeInline(text: string) {
  const flat = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)?/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>]*)>/gi, "$1")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...flat];
  const short = chars.length > SAFE_INLINE_MAX ? `${chars.slice(0, SAFE_INLINE_MAX - 1).join("").trimEnd()}…` : flat;
  return short ? `\`${short}\`` : "`(empty)`";
}
