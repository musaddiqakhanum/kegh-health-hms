import { createStore, get, set } from "idb-keyval";
import { emptyState, type HmsState } from "./types";

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
