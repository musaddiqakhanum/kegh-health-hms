import { readSessionId } from "./session-context";
import type { AuditAction, AuditLog, HmsState, Settings } from "./types";

/**
 * The effective role behind a change: the signed-in account's role when a
 * device session exists, else the device's own role from Settings — exactly
 * how the nav and the AdminOnly gates see the world.
 */
export function effectiveRole(state: HmsState, settings: Settings): string {
  try {
    const sid = readSessionId();
    const u = sid ? state.users[sid] : undefined;
    if (u && u.active) return u.role;
  } catch {
    /* storage unavailable — fall back to the device role */
  }
  return settings.role;
}

/** Collections that never get CRUD audit rows. `auditLogs` itself is obvious;
 *  everything else earns an entry on every upsert / remove. */
export function isAuditedCollection(collection: string): boolean {
  return collection !== "auditLogs";
}

/**
 * One audit-trail row for a write. Pure apart from the id/timestamp, so the
 * store can stamp it into the very same state update as the write it logs —
 * no second persist, no recursion.
 */
export function craftAuditEntry(opts: {
  state: HmsState;
  settings: Settings;
  action: AuditAction;
  collection: string;
  recordId: string;
  now?: number;
  id?: string;
}): AuditLog {
  const now = opts.now ?? Date.now();
  return {
    id: opts.id ?? crypto.randomUUID(),
    action: opts.action,
    collection: opts.collection,
    recordId: opts.recordId,
    timestamp: now,
    deviceName: opts.settings.deviceName,
    role: effectiveRole(opts.state, opts.settings),
    createdAt: now,
  };
}
