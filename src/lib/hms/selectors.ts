import {
  EXPENSE_CATEGORIES,
  type Expense,
  type HmsState,
  type Patient,
  type PayrollEntry,
  type Staff,
  type Visit,
} from "./types";
import { isSameDay, todayISO } from "./format";
import { monthOf } from "./payroll";

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
  const digits = s.replace(/\D/g, "");
  return patients.filter(
    (p) =>
      p.name?.toLowerCase().includes(s) ||
      p.mrn?.toLowerCase().includes(s) ||
      p.phone?.toLowerCase().includes(s) ||
      p.abhaAddress?.toLowerCase().includes(s) ||
      p.pmjayCardId?.toLowerCase().includes(s) ||
      p.pmjayFamilyId?.toLowerCase().includes(s) ||
      // ABHA numbers are stored digits-only, so compare without formatting.
      (digits.length >= 4 && (p.abhaNumber ?? "").includes(digits)),
  );
}

export function dashboardStats(state: HmsState) {
  const today = todayISO();
  const month = today.slice(0, 7);
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
    admitted: Object.values(state.visits).filter((v) => v.type === "IPD" && !v.dischargeDate)
      .length,
    collectionAll: bills.reduce((s, b) => s + Number(b.paid || 0), 0),
    staffOnRoll: Object.values(state.staff ?? {}).filter((s) => !(s.leaveDate || "").trim()).length,
    salaryThisMonth: Object.values(state.expenses ?? {})
      .filter((e) => e.category === "Salaries" && (e.date || "").slice(0, 7) === month)
      .reduce((s, e) => s + Number(e.amount || 0), 0),
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
  if (range === "month")
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const days = Number(range);
  const cutoff = new Date();
  cutoff.setDate(now.getDate() - days);
  return d >= new Date(cutoff.toDateString());
}

/* ------------------------------------------------------------------ staff */

export function searchStaff(rows: Staff[], q: string): Staff[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (r) =>
      r.name?.toLowerCase().includes(s) ||
      r.role?.toLowerCase().includes(s) ||
      r.department?.toLowerCase().includes(s) ||
      r.phone?.toLowerCase().includes(s),
  );
}

/** Departments in use across the staff list, alphabetically. */
export function staffDepartments(rows: Staff[]): string[] {
  return Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

/** A staff member counts as "left" once a leave date is set. */
export function hasLeft(staff: Staff): boolean {
  return Boolean((staff.leaveDate || "").trim());
}

export function sortStaffByName(rows: Staff[]): Staff[] {
  return [...rows].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/* --------------------------------------------------------------- payroll */

/** All payroll lines for one month, sorted by staff name. */
export function payrollForPeriod(state: HmsState, period: string): PayrollEntry[] {
  return Object.values(state.payrolls ?? {})
    .filter((p) => p.period === period)
    .sort((a, b) => (a.staffName || "").localeCompare(b.staffName || ""));
}

/** Periods that already have a payroll run, newest first. */
export function payrollPeriods(state: HmsState): string[] {
  return Array.from(new Set(Object.values(state.payrolls ?? {}).map((p) => p.period)))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}

/* -------------------------------------------------------------- expenses */

function expenseRows(state: HmsState): Expense[] {
  return Object.values(state.expenses ?? {});
}

export function expenseTotal(state: HmsState): number {
  return expenseRows(state).reduce((s, e) => s + Number(e.amount || 0), 0);
}

/** Expense totals bucketed by month (`YYYY-MM`), newest month first. */
export function expenseMonthlyTotals(state: HmsState): [string, number][] {
  const months = new Map<string, number>();
  for (const e of expenseRows(state)) {
    const key = monthOf(e.date);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    months.set(key, (months.get(key) ?? 0) + Number(e.amount || 0));
  }
  return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** Salaries only, bucketed by month — what the payroll run feeds in. */
export function salaryMonthlyTotals(state: HmsState): Map<string, number> {
  const months = new Map<string, number>();
  for (const e of expenseRows(state)) {
    if (e.category !== "Salaries") continue;
    const key = monthOf(e.date);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    months.set(key, (months.get(key) ?? 0) + Number(e.amount || 0));
  }
  return months;
}

/** All-time totals per expense category, biggest first. */
export function expenseCategoryTotals(state: HmsState): [string, number][] {
  const map = new Map<string, number>();
  for (const cat of EXPENSE_CATEGORIES) map.set(cat, 0);
  for (const e of expenseRows(state)) {
    const c = e.category || "Miscellaneous";
    map.set(c, (map.get(c) ?? 0) + Number(e.amount || 0));
  }
  return [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

export function expensesForMonth(state: HmsState, period: string): Expense[] {
  return expenseRows(state).filter((e) => monthOf(e.date) === period);
}

/**
 * The Salary expense a payroll run posted for a period, if any. Runs tag the
 * expense with `payrollPeriod`, so re-posting a month updates the same record
 * instead of piling up duplicates on every device.
 */
export function payrollExpenseForPeriod(state: HmsState, period: string): Expense | undefined {
  const posted = expenseRows(state)
    .filter((e) => e.payrollPeriod === period)
    .sort((a, b) => b.createdAt - a.createdAt);
  return posted[0];
}
