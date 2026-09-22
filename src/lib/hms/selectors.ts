import type { Bill, DoctorSchedule, HmsState, Patient, Pharm, Visit } from "./types";
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
  const appointments = Object.values(state.appointments ?? {});
  const visits = Object.values(state.visits);
  const patients = Object.values(state.patients);
  return {
    patients: Object.keys(state.patients).length,
    patientsToday: patients.filter((p) =>
      isSameDay(new Date(p.createdAt).toISOString().slice(0, 10), today),
    ).length,
    visitsToday: visits.filter((v) => isSameDay(v.date, today)).length,
    labsToday: Object.values(state.labs).filter((l) => isSameDay(l.date, today)).length,
    radsToday: Object.values(state.rads).filter((r) => isSameDay(r.date, today)).length,
    pharmsToday: Object.values(state.pharms).filter((p) => isSameDay(p.date, today)).length,
    appointmentsToday: appointments.filter((a) => isSameDay(a.date, today)).length,
    appointmentsUpcoming: appointments.filter((a) => {
      const d = new Date((a.date || "").slice(0, 10));
      if (Number.isNaN(d.getTime())) return false;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return d >= now;
    }).length,
    collectionToday: bills
      .filter((b) => isSameDay(b.date, today))
      .reduce((s, b) => s + Number(b.paid || 0), 0),
    billedToday: bills
      .filter((b) => isSameDay(b.date, today))
      .reduce((s, b) => s + Number(b.totalAmount || 0), 0),
    dueToday: bills
      .filter((b) => isSameDay(b.date, today))
      .reduce((s, b) => s + Number(b.due || 0), 0),
    admitted: visits.filter((v) => v.type === "IPD" && !v.dischargeDate).length,
    collectionAll: bills.reduce((s, b) => s + Number(b.paid || 0), 0),
    billedAll: bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0),
    dueAll: bills.reduce((s, b) => s + Number(b.due || 0), 0),
    discountAll: bills.reduce((s, b) => s + Number(b.discount || 0), 0),
    taxAll: bills.reduce((s, b) => s + Number(b.tax || 0), 0),
    lowStockCount: lowStockMedications(Object.values(state.pharms)).length,
    doctorsToday: availableDoctorsToday(Object.values(state.doctorSchedules ?? {})).length,
  };
}

export type PaymentStatus = "Paid" | "Partial" | "Due";

export function billPaymentStatus(bill: {
  totalAmount: number;
  paid: number;
  due: number;
}): PaymentStatus {
  const due = Number(bill.due || 0);
  const paid = Number(bill.paid || 0);
  if (due <= 0.01) return "Paid";
  if (paid > 0) return "Partial";
  return "Due";
}

export function filterBillsByStatus(
  bills: HmsState["bills"][string][],
  status: PaymentStatus | "All",
) {
  if (status === "All") return bills;
  return bills.filter((b) => billPaymentStatus(b) === status);
}

export type RangeKey = "today" | "7" | "30" | "month" | "all";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  "7": "Last 7 days",
  "30": "Last 30 days",
  month: "This month",
  all: "All time",
};

/** ---- Billing: discount / tax / grand total ---- */

export function billSubtotal(bill: Pick<Bill, "items">): number {
  return (bill.items ?? []).reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0), 0);
}

export function billDiscount(bill: Pick<Bill, "discount">): number {
  return Math.max(0, Number(bill.discount || 0));
}

export function billTax(bill: Pick<Bill, "tax">): number {
  return Math.max(0, Number(bill.tax || 0));
}

/** Grand total = (subtotal − discount) + tax. Safe for legacy bills (discount/tax = 0). */
export function billGrandTotal(bill: Pick<Bill, "items" | "discount" | "tax">): number {
  const subtotal = billSubtotal(bill);
  const net = Math.max(0, subtotal - billDiscount(bill));
  return net + billTax(bill);
}

/** ---- Pharmacy inventory ---- */

export interface MedicationStock {
  medication: string;
  stockQty: number;
  minStock: number;
  supplier: string;
  /** True when at least one entry carries stock info for this medication. */
  hasData: boolean;
  /** Latest entry id for this medication (restock target). */
  entryId: string;
  lastDate: string;
}

export function isLowStock(stockQty: number, minStock: number): boolean {
  return minStock > 0 && stockQty <= minStock;
}

export function pharmStock(p: Pharm): {
  stockQty: number;
  minStock: number;
  supplier: string;
  known: boolean;
  low: boolean;
} {
  const known = p.stockQty !== undefined || p.minStock !== undefined || Boolean(p.supplier?.trim());
  const stockQty = Number(p.stockQty ?? 0);
  const minStock = Number(p.minStock ?? 0);
  return {
    stockQty,
    minStock,
    supplier: p.supplier?.trim() ?? "",
    known,
    low: known && isLowStock(stockQty, minStock),
  };
}

/** Aggregate dispensing entries into per-medication inventory levels. */
export function medicationInventory(pharms: Pharm[]): MedicationStock[] {
  const groups = new Map<string, Pharm[]>();
  for (const p of pharms) {
    const key = (p.medication || "").trim().toLowerCase();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const out: MedicationStock[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt - a.createdAt,
    );
    const latest = sorted[0];
    if (!latest) continue;
    const withData = sorted.find(
      (p) => p.stockQty !== undefined || p.minStock !== undefined || Boolean(p.supplier?.trim()),
    );
    const src = withData ?? latest;
    out.push({
      medication: latest.medication.trim(),
      stockQty: Number(src.stockQty ?? 0),
      minStock: Number(src.minStock ?? 0),
      supplier: src.supplier?.trim() ?? "",
      hasData: Boolean(withData),
      entryId: src.id,
      lastDate: latest.date,
    });
  }
  return out.sort((a, b) => a.medication.localeCompare(b.medication));
}

export function lowStockMedications(pharms: Pharm[]): MedicationStock[] {
  return medicationInventory(pharms).filter((m) => m.hasData && isLowStock(m.stockQty, m.minStock));
}

/** ---- Doctor roster ---- */

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 0 (Sun) – 6 (Sat) for a YYYY-MM-DD string, or null when unparseable. */
export function weekdayOf(dateStr: string): number | null {
  const d = new Date(`${(dateStr || "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay();
}

/** Active roster entries covering the weekday of the given date. */
export function doctorsAvailableOn(schedules: DoctorSchedule[], dateStr: string): DoctorSchedule[] {
  const day = weekdayOf(dateStr);
  if (day === null) return [];
  return schedules
    .filter((s) => s.active !== false && (s.days ?? []).includes(day))
    .sort((a, b) => a.doctor.localeCompare(b.doctor));
}

export function availableDoctorsToday(schedules: DoctorSchedule[]): DoctorSchedule[] {
  return doctorsAvailableOn(schedules, todayISO());
}

export function inRange(dateStr: string, range: RangeKey): boolean {
  if (range === "all") return true;
  const d = new Date((dateStr || "").slice(0, 10));
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (range === "today") return isSameDay(dateStr);
  if (range === "month")
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const days = Number(range);
  const cutoff = new Date();
  cutoff.setDate(now.getDate() - days);
  return d >= new Date(cutoff.toDateString());
}
