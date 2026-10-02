import type { HmsState, Med, Prescription, RxFulfilStatus } from "./types";
import { sortByDateDesc } from "./selectors";
import { isSameDay, todayISO } from "./format";

/** Look up a catalog medicine by exact name (case-insensitive) — how a
 *  prescription line ties into pharmacy stock. */
export function matchMedicine(state: HmsState, name: string): Med | undefined {
  const n = (name || "").trim().toLowerCase();
  if (!n) return undefined;
  return Object.values(state.meds ?? {}).find((m) => (m.name || "").trim().toLowerCase() === n);
}

/** Fulfilment state from the per-item flags: all → Dispensed, some → Partial. */
export function fulfilStatus(
  itemDispensed: (boolean | undefined)[],
  itemCount: number,
): RxFulfilStatus {
  if (itemCount <= 0) return "Pending";
  const done = Array.from({ length: itemCount }, (_, i) => itemDispensed[i] === true).filter(
    Boolean,
  ).length;
  if (done === 0) return "Pending";
  return done >= itemCount ? "Dispensed" : "Partial";
}

/** The stored flags for one prescription, padded to its item count. */
export function itemFlags(rx: Prescription): boolean[] {
  return (rx.items ?? []).map((_, i) => rx.itemDispensed?.[i] === true);
}

/** Prescriptions still awaiting the pharmacy counter, newest first. */
export function pendingRx(state: HmsState): Prescription[] {
  return sortByDateDesc(
    Object.values(state.prescriptions ?? {}).filter(
      (r) => (r.dispenseStatus ?? "Pending") !== "Dispensed",
    ),
  );
}

/** Counter tiles: open prescriptions overall and written today. */
export function rxFulfilStats(state: HmsState) {
  const open = pendingRx(state);
  const today = todayISO();
  return {
    open: open.length,
    openToday: open.filter((r) => isSameDay(r.date, today)).length,
    partial: open.filter((r) => r.dispenseStatus === "Partial").length,
  };
}
