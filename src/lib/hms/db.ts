import { createStore, get, set } from "idb-keyval";
import { emptyState, type HmsState } from "./types";

const store = createStore("kegh-hms", "kegh-hms");
const KEY = "state";

export async function loadState(): Promise<HmsState> {
  try {
    const raw = (await get<HmsState>(KEY, store)) ?? null;
    if (!raw) return emptyState();
    const base = emptyState();
    // Ensure new collections exist for older stored states
    return {
      ...base,
      ...raw,
      patients: (raw as HmsState).patients ?? base.patients,
      visits: (raw as HmsState).visits ?? base.visits,
      labs: (raw as HmsState).labs ?? base.labs,
      rads: (raw as HmsState).rads ?? base.rads,
      pharms: (raw as HmsState).pharms ?? base.pharms,
      bills: (raw as HmsState).bills ?? base.bills,
      appointments:
        (raw as HmsState & { appointments?: HmsState["appointments"] }).appointments ??
        base.appointments,
      doctorSchedules:
        (raw as HmsState & { doctorSchedules?: HmsState["doctorSchedules"] }).doctorSchedules ??
        base.doctorSchedules,
      auditLogs:
        (raw as HmsState & { auditLogs?: HmsState["auditLogs"] }).auditLogs ?? base.auditLogs,
      ops: (raw as HmsState).ops ?? base.ops,
      deleted: (raw as HmsState).deleted ?? base.deleted,
    };
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
