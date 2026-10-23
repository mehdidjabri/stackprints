// API keys for the maintainers' agents. A key is shown once when minted; state keeps only its
// SHA-256, the name it was given, its scopes and who minted it. Keys hang from whoever minted them:
// revoking a key ends every key it minted, and keys a GitHub account minted end when that account
// leaves the allowlist. State keys:
//   apikey:<hash>          the record
//   apikey-id:<id>         the hash, to revoke by id
//   apikey-used:<hash>     when it was last used (to the hour), apart so a check never rewrites the record
//   apikey-revoked:<hash>  a tombstone kept 400 days, so no stale write can bring a revoked key back
import type { StateStore } from "./state";
import { type Principal, SCOPES, type Scope, principalId } from "./types";

export type ApiKeyRecord = {
  id: string;
  name: string;
  scopes: Scope[];
  createdAt: string;
  /** Who minted it, as shown: a GitHub login or a key's name. */
  createdBy: string;
  /** principalId of who minted it: "github:<numeric id>", "key:<id>" or "local:<name>". */
  createdById: string;
  /** The key that minted it, if one did: revoking that key revokes this one. */
  parentKeyId?: string;
  /** Filled in by listKeys from apikey-used:<hash>; never stored on the record. */
  lastUsedAt?: string;
};

/** The bootstrap secret's key id: it acts as the owner, and keys it mints have no parent to check. */
export const BOOTSTRAP_KEY_ID = "bootstrap";
/** Written the first time any key is minted: from then on the bootstrap secret never works again. */
export const BOOTSTRAP_SPENT = "bootstrap-spent";

const PREFIX = "spk_";
/** How many keys up a chain of minting is followed; a deeper key is refused. */
const MAX_DEPTH = 5;
const TOMBSTONE_TTL = 400 * 86400;
const USED_EVERY = 36e5;

const RECORD = (hash: string) => `apikey:${hash}`;
const ID = (id: string) => `apikey-id:${id}`;
const USED = (hash: string) => `apikey-used:${hash}`;
const REVOKED = (hash: string) => `apikey-revoked:${hash}`;

export async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const looksLikeKey = (token: string) => token.startsWith(PREFIX) && token.length > 20;

export function parseScopes(input: string[]): Scope[] {
  const bad = input.filter((s) => !SCOPES.includes(s as Scope));
  if (bad.length) throw new Error(`unknown scope ${bad.join(", ")}; use ${SCOPES.join(", ")}`);
  // Writing implies reading, publishing implies writing.
  const s = new Set(input as Scope[]);
  if (s.has("content:publish")) s.add("content:write");
  if (s.has("content:write") || s.has("keys:manage")) s.add("content:read");
  return SCOPES.filter((x) => s.has(x));
}

/** A caller may mint, or revoke, only keys whose scopes it holds itself. */
export const canManageKey = (principal: Principal, record: Pick<ApiKeyRecord, "scopes">) => record.scopes.every((s) => principal.scopes.includes(s));

/** Whether any API key exists, or ever did: the bootstrap secret works only before the first one. */
export async function hasAnyKey(state: StateStore) {
  return (await state.get(BOOTSTRAP_SPENT)) !== null || (await state.list("apikey:", { limit: 1 })).keys.length > 0;
}

/** A live key's record by id, or null. */
export async function findKey(state: StateStore, id: string) {
  const hash = await state.get<string>(ID(id));
  return hash ? state.get<ApiKeyRecord>(RECORD(hash)) : null;
}

/** The records from a key up through the keys that minted it, or null when one is gone or the chain is too deep. */
async function lineage(state: StateStore, record: ApiKeyRecord) {
  const chain = [record];
  for (let at = record; at.parentKeyId; ) {
    if (chain.length > MAX_DEPTH) return null;
    const parent = await findKey(state, at.parentKeyId);
    if (!parent) return null;
    chain.push((at = parent));
  }
  return chain;
}

/**
 * Mints a key for `creator`, which must hold every scope it grants. A key minted by another key
 * records it as its parent, and dies with it.
 */
export async function mintKey(state: StateStore, input: { name: string; scopes: Scope[]; creator: Principal; now: number }) {
  const scopes = parseScopes(input.scopes);
  const { creator } = input;
  if (!canManageKey(creator, { scopes })) throw new Error(`can't grant scopes the creator doesn't hold: ${scopes.filter((s) => !creator.scopes.includes(s)).join(", ")}`);
  const parentKeyId = creator.kind === "apikey" && creator.keyId && creator.keyId !== BOOTSTRAP_KEY_ID ? creator.keyId : undefined;
  if (parentKeyId) {
    const parent = await findKey(state, parentKeyId);
    const chain = parent && (await lineage(state, parent));
    if (!chain) throw new Error(`key ${parentKeyId} that would mint this one is revoked`);
    if (chain.length > MAX_DEPTH) throw new Error(`keys minted by keys nest at most ${MAX_DEPTH} deep; mint this one from a key nearer the owner`);
  }

  const key = `${PREFIX}${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const hash = await sha256Hex(key);
  const record: ApiKeyRecord = {
    id: hash.slice(0, 12),
    name: input.name,
    scopes,
    createdAt: new Date(input.now).toISOString(),
    createdBy: creator.name,
    createdById: principalId(creator),
    ...(parentKeyId ? { parentKeyId } : {}),
  };
  // The id first: a record that can't be found by id couldn't be revoked.
  await state.put(BOOTSTRAP_SPENT, record.createdAt);
  await state.put(ID(record.id), hash);
  await state.put(RECORD(hash), record);
  return { key, record };
}

export type VerifyOptions = {
  now?: number;
  /** Whether a GitHub account (numeric id) may still act here; keys it minted, directly or not, end when it may not. */
  githubAllowed?: (id: string) => boolean;
};

/**
 * The key's record, or null: unknown, revoked, minted by a key that is gone, or rooted in a GitHub
 * account `githubAllowed` refuses. Notes the time it was used, at most once an hour, on its own key.
 */
export async function verifyKey(state: StateStore, key: string, options: VerifyOptions = {}) {
  if (!looksLikeKey(key)) return null;
  const now = options.now ?? Date.now();
  const hash = await sha256Hex(key);
  const [record, revoked, used] = await Promise.all([state.get<ApiKeyRecord>(RECORD(hash)), state.get(REVOKED(hash)), state.get<string>(USED(hash))]);
  if (!record || revoked) return null;
  const chain = await lineage(state, record);
  if (!chain) return null;
  const root = chain.at(-1)!.createdById ?? "";
  if (options.githubAllowed && root.startsWith("github:") && !options.githubAllowed(root.slice("github:".length))) return null;
  if (!used || now - Date.parse(used) > USED_EVERY) await state.put(USED(hash), new Date(now).toISOString());
  return record;
}

/** Every live key, oldest first, with when it was last used. */
export async function listKeys(state: StateStore) {
  const [records, used] = await Promise.all([state.entries<ApiKeyRecord>("apikey:"), state.entries<string>("apikey-used:")]);
  const usedAt = new Map(used.entries.map(([k, at]) => [k.slice("apikey-used:".length), at]));
  return records.entries
    .map(([k, r]) => {
      const at = usedAt.get(k.slice("apikey:".length));
      return at ? { ...r, lastUsedAt: at } : r;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Revokes a key by id, and with it every key it minted, down the chain. With `by`, refuses (throws)
 * unless that caller holds every scope of the key. Returns the records revoked, or null for no such key.
 */
export async function revokeKey(state: StateStore, id: string, options: { now?: number; by?: Principal } = {}) {
  const record = await findKey(state, id);
  if (!record) return null;
  if (options.by && !canManageKey(options.by, record)) throw new Error(`can't revoke key ${id}: it has scopes you don't hold (${record.scopes.join(", ")})`);
  const now = options.now ?? Date.now();
  const all = (await state.entries<ApiKeyRecord>("apikey:")).entries.map(([, r]) => r);
  // A Map visits what is added while it is walked, so this goes down every generation.
  const doomed = new Map([[record.id, record]]);
  for (const r of doomed.values()) for (const child of all) if (child.parentKeyId === r.id && !doomed.has(child.id)) doomed.set(child.id, child);
  for (const doomedId of doomed.keys()) await revokeOne(state, doomedId, now);
  const cascaded = [...doomed.values()].slice(1);
  return { revoked: record, cascaded };
}

async function revokeOne(state: StateStore, id: string, now: number) {
  const hash = await state.get<string>(ID(id));
  if (!hash) return;
  // The tombstone first: once it is down the key fails whatever happens to the rest.
  await state.put(REVOKED(hash), { id, revokedAt: new Date(now).toISOString() }, { ttlSeconds: TOMBSTONE_TTL });
  await state.delete(RECORD(hash));
  await state.delete(ID(id));
  await state.delete(USED(hash));
}
