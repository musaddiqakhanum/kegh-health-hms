/**
 * Shadow run (phase 6): compare the records in the Drive files with the room's
 * current records, record by record. Read-only: nothing is written to the room or
 * to Drive. The report shows what the two would disagree about, so the Drive files
 * can be checked before Drive is switched off as a source.
 */
import { localEntries, splitKey, stableJson } from "./realtime-state";
import type { Version } from "./sync-core";
import type { HmsState } from "./types";

export interface ShadowCounts {
  /** Live in both, same content. */
  same: number;
  /** Live in Drive, the room has no version of it. */
  onlyDrive: number;
  /** Live in the room, not in Drive at all. */
  onlyRoom: number;
  /** Both sides differ (or one side is deleted) and the Drive copy is newer. */
  driveNewer: number;
  /** Both sides differ (or one side is deleted) and the room copy is newer. */
  roomNewer: number;
  /** Both sides differ and carry the same timestamp. */
  sameTime: number;
}

/** Counts per collection. */
export type ShadowReport = Record<string, ShadowCounts>;

const emptyCounts = (): ShadowCounts => ({
  same: 0,
  onlyDrive: 0,
  onlyRoom: 0,
  driveNewer: 0,
  roomNewer: 0,
  sameTime: 0,
});

/**
 * Compare a merged Drive state with the room. `roomVersion` and `roomKeys` describe
 * the room as this device last saw it (after catch-up, that is the room's current
 * state).
 */
export function compareWithRoom(
  drive: HmsState,
  roomVersion: (key: string) => Version | undefined,
  roomKeys: readonly string[],
): ShadowReport {
  const report: ShadowReport = {};
  const bump = (key: string, field: keyof ShadowCounts) => {
    const collection = splitKey(key)?.collection ?? "unknown";
    const counts = (report[collection] ??= emptyCounts());
    counts[field]++;
  };

  const seen = new Set<string>();
  for (const e of localEntries(drive, 0)) {
    seen.add(e.key);
    const sv = roomVersion(e.key);
    const driveLive = e.value !== null;
    if (sv === undefined) {
      if (driveLive) bump(e.key, "onlyDrive");
      continue;
    }
    const roomLive = sv.value !== null;
    if (!driveLive && !roomLive) continue;
    if (driveLive && roomLive && stableJson(e.value) === stableJson(sv.value)) {
      bump(e.key, "same");
    } else if (e.ts > sv.ts) {
      bump(e.key, "driveNewer");
    } else if (e.ts < sv.ts) {
      bump(e.key, "roomNewer");
    } else {
      bump(e.key, "sameTime");
    }
  }

  for (const key of roomKeys) {
    if (seen.has(key)) continue;
    const sv = roomVersion(key);
    if (sv && sv.value !== null) bump(key, "onlyRoom");
  }
  return report;
}

/** Totals across collections (for the summary line). */
export function totalsOf(report: ShadowReport): ShadowCounts {
  const total = emptyCounts();
  for (const counts of Object.values(report)) {
    for (const field of Object.keys(total) as (keyof ShadowCounts)[]) {
      total[field] += counts[field];
    }
  }
  return total;
}
