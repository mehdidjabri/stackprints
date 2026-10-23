// Every admin tool call, kept 180 days: who, what, with which arguments (shortened), and how it ended.
import type { StateStore } from "./state";
import type { Principal } from "./types";

export type AuditEntry = {
  at: string;
  who: { name: string; kind: Principal["kind"]; keyId?: string };
  tool: string;
  /** The arguments as JSON, cut at 2,000 characters. */
  args: string;
  outcome: "ok" | "error";
  /** The error, or a short note such as the commit a submit produced. */
  detail?: string;
};

const MAX = 9_999_999_999_999;
const TTL = 180 * 86400;

/** Keys sort newest first: the timestamp counts down. */
export async function audit(state: StateStore, e: Omit<AuditEntry, "at">, now: number) {
  const r = crypto.getRandomValues(new Uint8Array(3));
  const k = `audit:${String(MAX - now).padStart(13, "0")}:${[...r].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  await state.put(k, { at: new Date(now).toISOString(), ...e } satisfies AuditEntry, { ttlSeconds: TTL });
}

export async function readAudit(state: StateStore, options: { limit?: number; cursor?: string } = {}) {
  const page = await state.entries<AuditEntry>("audit:", { limit: options.limit ?? 50, cursor: options.cursor });
  return { entries: page.entries.map(([, e]) => e), ...(page.cursor ? { cursor: page.cursor } : {}) };
}

export const shorten = (v: unknown, max = 2000) => {
  const s = JSON.stringify(v) ?? "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
