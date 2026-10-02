import type { Admission, Bed, HmsState } from "./types";
import { todayISO } from "./format";

export function bedList(state: HmsState): Bed[] {
  return Object.values(state.beds ?? {})
    .filter((b) => b.active !== false)
    .sort(
      (a, b) =>
        (a.ward || "").localeCompare(b.ward || "") ||
        (a.room || "").localeCompare(b.room || "", undefined, { numeric: true }) ||
        (a.label || "").localeCompare(b.label || "", undefined, { numeric: true }),
    );
}

export function admissionList(state: HmsState): Admission[] {
  return Object.values(state.admissions ?? {});
}

/** The admission currently holding a bed, if any. */
export function activeAdmissionForBed(state: HmsState, bedId: string): Admission | undefined {
  return admissionList(state).find((a) => a.bedId === bedId && a.status === "Admitted");
}

/** A patient's open admission — one patient, one bed at a time. */
export function activeAdmissionForPatient(
  state: HmsState,
  patientId: string,
): Admission | undefined {
  return admissionList(state).find((a) => a.patientId === patientId && a.status === "Admitted");
}

/** Beds with nobody in them, board order. */
export function freeBeds(state: HmsState): Bed[] {
  return bedList(state).filter((b) => !activeAdmissionForBed(state, b.id));
}

/** Open admissions, most recent admit first. */
export function activeAdmissions(state: HmsState): Admission[] {
  return admissionList(state)
    .filter((a) => a.status === "Admitted")
    .sort(
      (a, b) => (b.admitDate || "").localeCompare(a.admitDate || "") || b.createdAt - a.createdAt,
    );
}

/** Inclusive day count of a stay — day 1 is the admit day itself. */
export function stayDays(admitDate: string, endDate = todayISO()): number {
  const a = new Date(`${(admitDate || "").slice(0, 10)}T00:00:00`);
  const b = new Date(`${(endDate || "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}

export interface WardOccupancy {
  ward: string;
  total: number;
  occupied: number;
}

/** Occupancy grouped per ward, board order. */
export function wardOccupancy(state: HmsState): WardOccupancy[] {
  const map = new Map<string, WardOccupancy>();
  for (const b of bedList(state)) {
    const w = map.get(b.ward) ?? { ward: b.ward, total: 0, occupied: 0 };
    w.total++;
    if (activeAdmissionForBed(state, b.id)) w.occupied++;
    map.set(b.ward, w);
  }
  return [...map.values()];
}

/** Hospital-wide bed numbers for tiles. */
export function bedStats(state: HmsState) {
  const wards = wardOccupancy(state);
  const total = wards.reduce((s, w) => s + w.total, 0);
  const occupied = wards.reduce((s, w) => s + w.occupied, 0);
  return {
    total,
    occupied,
    free: total - occupied,
    pct: total ? Math.round((occupied / total) * 100) : 0,
  };
}
