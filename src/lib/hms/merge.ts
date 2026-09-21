import { emptyState, type Collection, type HmsState } from "./types";

const COLLECTIONS: Collection[] = ["patients", "visits", "labs", "rads", "pharms", "bills"];

/** Merge two states: newest write per record wins; tombstones respected. */
export function mergeStates(a: HmsState, b: HmsState): HmsState {
  const out = emptyState();
  out.ops = { ...a.ops, ...b.ops };
  for (const k of Object.keys(a.ops)) {
    if ((b.ops[k] ?? 0) > (a.ops[k] ?? 0)) out.ops[k] = b.ops[k];
    else out.ops[k] = a.ops[k];
  }
  out.deleted = { ...a.deleted };
  for (const [k, t] of Object.entries(b.deleted ?? {})) {
    out.deleted[k] = Math.max(out.deleted[k] ?? 0, t);
  }

  for (const c of COLLECTIONS) {
    const merged: Record<string, unknown> = {};
    const ids = new Set([...Object.keys(a[c] ?? {}), ...Object.keys(b[c] ?? {})]);
    for (const id of ids) {
      const key = `${c}:${id}`;
      const ra = (a[c] as Record<string, { createdAt?: number }>)[id];
      const rb = (b[c] as Record<string, { createdAt?: number }>)[id];
      const ta = ra ? (a.ops?.[key] ?? ra.createdAt ?? 0) : -1;
      const tb = rb ? (b.ops?.[key] ?? rb.createdAt ?? 0) : -1;
      const winner = tb > ta ? rb : ra;
      const winnerTime = Math.max(ta, tb);
      const deletedAt = out.deleted[key] ?? 0;
      if (winner && deletedAt <= winnerTime) merged[id] = winner;
    }
    (out[c] as Record<string, unknown>) = merged;
  }
  return out;
}
