import type { HmsState, Patient, Visit } from "./types";
import { isSameDay, todayISO } from "./format";

export const sortByDateDesc = <T extends { date?: string; createdAt: number }>(rows: T[]) =>
  [...rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt - a.createdAt);

export function patientName(state: HmsState, id: string): string {
  return state.patients[id]?.name ?? "—";
}

export function visitLabel(state: HmsState, id: string): string {
  const v: Visit | undefined = state.visits[id];
  if (!v) return "—";
  return `${v.date} · ${v.type}${v.doctor ? ` · ${v.doctor}` : ""}`;
}

export function searchPatients(patients: Patient[], q: string): Patient[] {
  const s = q.trim().toLowerCase();
  if (!s) return patients;
  return patients.filter(
    (p) =>
      p.name?.toLowerCase().includes(s) ||
      p.mrn?.toLowerCase().includes(s) ||
      p.phone?.toLowerCase().includes(s),
  );
}

export function dashboardStats(state: HmsState) {
  const today = todayISO();
  const bills = Object.values(state.bills);
  return {
    patients: Object.keys(state.patients).length,
    visitsToday: Object.values(state.visits).filter((v) => isSameDay(v.date, today)).length,
    labsToday: Object.values(state.labs).filter((l) => isSameDay(l.date, today)).length,
    radsToday: Object.values(state.rads).filter((r) => isSameDay(r.date, today)).length,
    pharmsToday: Object.values(state.pharms).filter((p) => isSameDay(p.date, today)).length,
    collectionToday: bills
      .filter((b) => isSameDay(b.date, today))
      .reduce((s, b) => s + Number(b.paid || 0), 0),
    admitted: Object.values(state.visits).filter((v) => v.type === "IPD" && !v.dischargeDate).length,
    collectionAll: bills.reduce((s, b) => s + Number(b.paid || 0), 0),
  };
}

export type RangeKey = "today" | "7" | "30" | "month" | "all";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  "7": "Last 7 days",
  "30": "Last 30 days",
  month: "This month",
  all: "All time",
};

export function inRange(dateStr: string, range: RangeKey): boolean {
  if (range === "all") return true;
  const d = new Date((dateStr || "").slice(0, 10));
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (range === "today") return isSameDay(dateStr);
  if (range === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const days = Number(range);
  const cutoff = new Date();
  cutoff.setDate(now.getDate() - days);
  return d >= new Date(cutoff.toDateString());
}
