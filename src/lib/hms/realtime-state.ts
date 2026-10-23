/**
 * Pure helpers that connect the app's HmsState to the sync core (no React, no I/O).
 *
 *  - journalEntries: turn local edits into per-record changes (journal on write).
 *  - applyUpdates: apply room updates to local state without echoing them back.
 *  - localEntries + reconcileEntries: on connect, send what the room does not have
 *    (or has differently), so offline and pre-sync data is not lost.
 *
 * "Shadow" is the last state the sync layer has accounted for, keyed by
 * "<collection>:<id>". Records are compared by reference first, then by content.
 */
import { COLLECTIONS, type Collection, type HmsState } from "./types";
import type { Update, Version } from "./sync-core";

/** Collections that sync. `users` stays on this device until server-side auth (design phase 4). */
export const SYNCED_COLLECTIONS: readonly Collection[] = COLLECTIONS.filter((c) => c !== "users");

const SYNCED = new Set<string>(SYNCED_COLLECTIONS);

export type Shadow = Map<string, unknown>;

/** A record change to send (value null = delete). */
export interface Entry {
  key: string;
  value: unknown | null;
  ts: number;
}

/** Split "<collection>:<id>" (ids may contain colons). Null when the key is not a synced record. */
export function splitKey(key: string): { collection: Collection; id: string } | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  const collection = key.slice(0, at);
  const id = key.slice(at + 1);
  if (!SYNCED.has(collection) || id === "") return null;
  return { collection: collection as Collection, id };
}

/** Room identity for a room address: origin and path, without the token. Null if not a room address. */
export function roomKeyOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
  if (!/^\/rooms\/[a-z0-9][a-z0-9-]{0,63}\/ws$/.test(parsed.pathname)) return null;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

/** JSON with object keys sorted, so equal records compare equal whatever their key order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

const recordsOf = (state: HmsState, c: Collection): Record<string, unknown> =>
  state[c] as Record<string, unknown>;

/** Shadow of every synced record in `state`. */
export function shadowOf(state: HmsState): Shadow {
  const shadow: Shadow = new Map();
  for (const c of SYNCED_COLLECTIONS) {
    for (const [id, rec] of Object.entries(recordsOf(state, c))) shadow.set(`${c}:${id}`, rec);
  }
  return shadow;
}

/**
 * Local edits since the shadow was last updated. Updates the shadow to `state`.
 * Only changed records produce entries.
 */
export function journalEntries(shadow: Shadow, state: HmsState, now: number): Entry[] {
  const out: Entry[] = [];
  const live = new Set<string>();

  for (const c of SYNCED_COLLECTIONS) {
    const records = recordsOf(state, c);
    for (const id of Object.keys(records)) {
      const key = `${c}:${id}`;
      live.add(key);
      const rec = records[id];
      const had = shadow.has(key);
      const prev = shadow.get(key);
      shadow.set(key, rec);
      if (had && prev === rec) continue;
      if (had && stableJson(prev) === stableJson(rec)) continue;
      out.push({ key, value: rec, ts: state.ops[key] ?? now });
    }
  }

  for (const key of [...shadow.keys()]) {
    if (!splitKey(key) || live.has(key)) continue;
    shadow.delete(key);
    out.push({ key, value: null, ts: state.deleted[key] ?? now });
  }
  return out;
}

/**
 * Apply room updates to local state. Updates the shadow to the applied values,
 * so the journal does not send them back. Non-record values are skipped.
 */
export function applyUpdates(state: HmsState, shadow: Shadow, updates: Update[]): HmsState {
  const next: Record<string, unknown> = { ...state };
  const ops: Record<string, number> = { ...state.ops };
  const deleted: Record<string, number> = { ...state.deleted };
  const copied = new Set<Collection>();

  for (const u of [...updates].sort((a, b) => a.seq - b.seq)) {
    const parts = splitKey(u.key);
    if (!parts) continue;
    const { collection, id } = parts;
    const ts = u.current.ts;
    const value = u.current.value;
    if (value !== null && (typeof value !== "object" || Array.isArray(value))) continue;

    if (!copied.has(collection)) {
      copied.add(collection);
      next[collection] = { ...recordsOf(state, collection) };
    }
    const records = next[collection] as Record<string, unknown>;
    ops[u.key] = ts;
    if (value === null) {
      delete records[id];
      deleted[u.key] = ts;
      shadow.delete(u.key);
    } else {
      records[id] = value;
      delete deleted[u.key];
      shadow.set(u.key, value);
    }
  }

  return { ...next, ops, deleted } as unknown as HmsState;
}

/** Every synced record, plus tombstones for synced records that were deleted locally. */
export function localEntries(state: HmsState, now: number): Entry[] {
  const out: Entry[] = [];
  for (const c of SYNCED_COLLECTIONS) {
    const records = recordsOf(state, c);
    for (const id of Object.keys(records)) {
      const rec = records[id];
      const key = `${c}:${id}`;
      const created = (rec as { createdAt?: unknown }).createdAt;
      const fallback = typeof created === "number" && created > 0 ? created : now;
      out.push({ key, value: rec, ts: state.ops[key] ?? fallback });
    }
  }
  for (const key of Object.keys(state.deleted)) {
    const parts = splitKey(key);
    if (!parts) continue;
    if (recordsOf(state, parts.collection)[parts.id] !== undefined) continue;
    out.push({ key, value: null, ts: state.deleted[key] ?? now });
  }
  return out;
}

/**
 * Which local entries the room must hear about. Skips keys already queued, and
 * keys whose room version matches. A key the room has never seen is sent unless
 * it is a deletion.
 */
export function reconcileEntries(
  entries: Entry[],
  serverVersion: (key: string) => Version | undefined,
  pending: Set<string>,
): Entry[] {
  return entries.filter((e) => {
    if (pending.has(e.key)) return false;
    const sv = serverVersion(e.key);
    if (sv === undefined) return e.value !== null;
    return stableJson(sv.value) !== stableJson(e.value);
  });
}

/**
 * Local changes the room has not seen, taken when a connection opens (before
 * catch-up). A record that matches this device's last-known room version is not
 * a change, even if the room has moved on since, so it must not be re-sent.
 */
export function unsyncedEntries(
  state: HmsState,
  serverVersion: (key: string) => Version | undefined,
  pending: Set<string>,
  now: number,
): Entry[] {
  return reconcileEntries(localEntries(state, now), serverVersion, pending);
}

/**
 * Set a record to `value` (null = delete) as a local edit at `now`. Used when a
 * reviewer chooses the older version of a conflict. The new op time is the newest,
 * so the choice wins on every device.
 */
export function setRecord(
  state: HmsState,
  key: string,
  value: unknown | null,
  now: number,
): HmsState {
  const parts = splitKey(key);
  if (!parts) return state;
  const { collection, id } = parts;
  const records: Record<string, unknown> = { ...recordsOf(state, collection) };
  const deleted: Record<string, number> = { ...state.deleted };
  if (value === null) {
    delete records[id];
    deleted[key] = now;
  } else {
    if (typeof value !== "object" || Array.isArray(value)) return state;
    records[id] = value;
    delete deleted[key];
  }
  return {
    ...state,
    [collection]: records,
    ops: { ...state.ops, [key]: now },
    deleted,
  } as unknown as HmsState;
}

/** Fields whose values differ between two record versions (`id` and `createdAt` are ignored). */
export function changedFields(
  a: unknown,
  b: unknown,
): Array<{ field: string; a: unknown; b: unknown }> {
  const left = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const right = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((f) => f !== "id" && f !== "createdAt")
    .sort();
  const out: Array<{ field: string; a: unknown; b: unknown }> = [];
  for (const field of fields) {
    if (stableJson(left[field]) !== stableJson(right[field])) {
      out.push({ field, a: left[field], b: right[field] });
    }
  }
  return out;
}
