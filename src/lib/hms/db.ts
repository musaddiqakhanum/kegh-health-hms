import { createStore, get, set } from "idb-keyval";
import { emptyState, type HmsState } from "./types";

const store = createStore("kegh-hms", "kegh-hms");
const KEY = "state";

/**
 * Backfill OPD token numbers for today's confirmed appointments.
 * Idempotent: keeps existing assignments and only assigns the n-th token
 * to the n-th appointment ordered by createdAt (then id for stability).
 */
export function backfillTokens(state: HmsState): HmsState {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const entries = Object.values(state.appointments ?? {});
  const todays = entries
    .filter((a) => a.date === iso && a.status === "Confirmed")
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (todays.length === 0) return state;
  const todaysIds = todays.map((a) => a.id);
  let changed = false;
  const appointments = { ...state.appointments };
  for (let i = 0; i < todays.length; i++) {
    const a = todays[i]!;
    if (!a.tokenNo || a.tokenNo !== i + 1) {
      appointments[a.id] = { ...a, tokenNo: i + 1 };
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, appointments };
}

export async function loadState(): Promise<HmsState> {
  try {
    const raw = (await get<HmsState>(KEY, store)) ?? null;
    if (!raw) return emptyState();
    const base = emptyState();
    const loaded: HmsState = {
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
      prescriptions:
        (raw as HmsState & { prescriptions?: HmsState["prescriptions"] }).prescriptions ??
        base.prescriptions,
      expenses: (raw as HmsState & { expenses?: HmsState["expenses"] }).expenses ?? base.expenses,
      auditLogs:
        (raw as HmsState & { auditLogs?: HmsState["auditLogs"] }).auditLogs ?? base.auditLogs,
      ops: (raw as HmsState).ops ?? base.ops,
      deleted: (raw as HmsState).deleted ?? base.deleted,
    };
    return backfillTokens(loaded);
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
