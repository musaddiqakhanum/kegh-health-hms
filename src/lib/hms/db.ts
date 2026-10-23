import { createStore, get, set } from "idb-keyval";
import { emptyState, type HmsState } from "./types";
import type { DeviceSnapshot } from "./sync-core";

const SYNC_PREFIX = "sync:";

const store = createStore("kegh-hms", "kegh-hms");
const KEY = "state";

export async function loadState(): Promise<HmsState> {
  try {
    const raw = (await get<HmsState>(KEY, store)) ?? null;
    if (!raw) return emptyState();
    return { ...emptyState(), ...raw };
  } catch {
    return emptyState();
  }
}

export async function saveState(state: HmsState): Promise<void> {
  try {
    await set(KEY, state, store);
  } catch (err) {
    console.error("Failed to persist state", err);
  }
}

/** Device sync snapshot (outbox, cursor, known versions) for one room. Keyed by room, not by token. */
export async function loadSyncSnapshot(roomKey: string): Promise<DeviceSnapshot | null> {
  try {
    return (await get<DeviceSnapshot>(`${SYNC_PREFIX}${roomKey}`, store)) ?? null;
  } catch {
    return null;
  }
}

export async function saveSyncSnapshot(roomKey: string, snapshot: DeviceSnapshot): Promise<void> {
  try {
    await set(`${SYNC_PREFIX}${roomKey}`, snapshot, store);
  } catch (err) {
    console.error("Failed to persist sync state", err);
  }
}
