import {
  EXPENSE_CATEGORIES,
  type Appointment,
  type AppointmentStatus,
  type Bill,
  type DoctorSchedule,
  type Expense,
  type HmsState,
  type Patient,
  type PayrollEntry,
  type Prescription,
  type Staff,
  type User,
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
    /** Today's diary (cancelled appointments don't count). */
    appointmentsToday: Object.values(state.appointments ?? {}).filter(
      (a) => isSameDay(a.date, today) && a.status !== "Cancelled",
    ).length,
    /** Patients checked in and waiting in today's OPD token queue. */
    waitingNow: Object.values(state.appointments ?? {}).filter(
      (a) => isSameDay(a.date, today) && a.status === "CheckedIn",
    ).length,
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

/* ----------------------------------------------------------------- users */

/** All staff accounts, sorted by username (case-insensitive order). */
export function userList(state: HmsState): User[] {
  return Object.values(state.users ?? {}).sort((a, b) =>
    (a.username || "").localeCompare(b.username || "", undefined, { sensitivity: "base" }),
  );
}

/** Accounts that can currently sign in. */
export function activeUsers(state: HmsState): User[] {
  return userList(state).filter((u) => u.active);
}

/** Case-insensitive username lookup — usernames are unique per list. */
export function findUserByUsername(state: HmsState, username: string): User | undefined {
  const s = (username || "").trim().toLowerCase();
  if (!s) return undefined;
  return Object.values(state.users ?? {}).find(
    (u) => (u.username || "").trim().toLowerCase() === s,
  );
}

/** Display name of a linked staff record, for the Users section in Settings. */
export function staffNameFor(state: HmsState, staffId?: string): string {
  const id = (staffId || "").trim();
  if (!id) return "—";
  return state.staff[id]?.name ?? "—";
}

/* ------------------------------------------------------------- workspaces */

/** Case-insensitive match of a user's display name against a doctor field. */
export function doctorMatches(displayName: string, doctor?: string): boolean {
  const a = (displayName || "").trim().toLowerCase();
  const b = (doctor || "").trim().toLowerCase();
  return Boolean(a) && a === b;
}

/** The doctor's OPD queue today: checked-in tokens for that doctor, token order. */
export function myTodayQueue(state: HmsState, user: User): Appointment[] {
  const today = todayISO();
  return Object.values(state.appointments ?? {})
    .filter(
      (a) =>
        a.date === today && a.status === "CheckedIn" && doctorMatches(user.displayName, a.doctor),
    )
    .sort((a, b) => Number(a.tokenNo ?? 0) - Number(b.tokenNo ?? 0));
}

/** The doctor's open appointments today (scheduled / confirmed / checked in), time order. */
export function myTodayAppointments(state: HmsState, user: User): Appointment[] {
  const today = todayISO();
  return Object.values(state.appointments ?? {})
    .filter(
      (a) =>
        a.date === today &&
        OPEN_STATUSES.includes(a.status) &&
        doctorMatches(user.displayName, a.doctor),
    )
    .sort((a, b) => (a.time || "").localeCompare(b.time || "") || a.createdAt - b.createdAt);
}

/** Patients the doctor has seen most recently (newest visit first, unique patients). */
export function myRecentPatients(
  state: HmsState,
  user: User,
  limit = 6,
): { patient: Patient; visit: Visit }[] {
  const visits = sortByDateDesc(
    Object.values(state.visits ?? {}).filter((v) => doctorMatches(user.displayName, v.doctor)),
  );
  const seen = new Set<string>();
  const out: { patient: Patient; visit: Visit }[] = [];
  for (const visit of visits) {
    if (seen.has(visit.patientId)) continue;
    const patient = state.patients[visit.patientId];
    if (!patient) continue;
    seen.add(visit.patientId);
    out.push({ patient, visit });
    if (out.length >= limit) break;
  }
  return out;
}

/** Bills still owing money, newest first. `partial` = some payment received. */
export interface DueBill {
  bill: Bill;
  patientName: string;
  partial: boolean;
}

export function dueBills(state: HmsState): DueBill[] {
  return sortByDateDesc(Object.values(state.bills ?? {}).filter((b) => Number(b.due ?? 0) > 0)).map(
    (bill) => ({
      bill,
      patientName: state.patients[bill.patientId]?.name ?? "—",
      partial: Number(bill.paid ?? 0) > 0,
    }),
  );
}

/** Money collected today (sum of `paid` on bills dated today). */
export function todayCollection(state: HmsState): number {
  return Object.values(state.bills ?? {})
    .filter((b) => isSameDay(b.date))
    .reduce((s, b) => s + Number(b.paid || 0), 0);
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

/* ---------------------------------------------------------- appointments */

/** Statuses where the patient is still expected to be seen. */
export const OPEN_STATUSES: AppointmentStatus[] = ["Scheduled", "Confirmed", "CheckedIn"];

/** Short weekday names indexed by JS getDay() (0 = Sunday) — roster toggles. */
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Appointments on one day, in time order (then booking order). */
export function appointmentsOn(state: HmsState, date: string): Appointment[] {
  return Object.values(state.appointments ?? {})
    .filter((a) => a.date === date)
    .sort((a, b) => (a.time || "").localeCompare(b.time || "") || a.createdAt - b.createdAt);
}

/** Open appointments from today onward, soonest first. */
export function upcomingAppointments(state: HmsState, ref = todayISO()): Appointment[] {
  return Object.values(state.appointments ?? {})
    .filter((a) => OPEN_STATUSES.includes(a.status) && (a.date || "") >= ref)
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        (a.time || "").localeCompare(b.time || "") ||
        a.createdAt - b.createdAt,
    );
}

/** Next OPD token for a day: one more than the highest token already issued. */
export function nextTokenNo(state: HmsState, date: string): number {
  let max = 0;
  for (const a of Object.values(state.appointments ?? {})) {
    if (a.date === date && Number(a.tokenNo ?? 0) > max) max = Number(a.tokenNo ?? 0);
  }
  return max + 1;
}

/** Checked-in patients for a day, in token order — the live OPD queue. */
export function waitingQueue(state: HmsState, date: string): Appointment[] {
  return appointmentsOn(state, date)
    .filter((a) => a.status === "CheckedIn")
    .sort((a, b) => Number(a.tokenNo ?? 0) - Number(b.tokenNo ?? 0));
}

/** Headline numbers for the token-queue subtitle on one day. */
export function queueStats(state: HmsState, date: string) {
  const day = appointmentsOn(state, date);
  return {
    waiting: day.filter((a) => a.status === "CheckedIn").length,
    completed: day.filter((a) => a.status === "Completed").length,
    /** Tokens issued = appointments that carry a token number. */
    tokens: day.filter((a) => Number(a.tokenNo ?? 0) > 0).length,
  };
}

/* ---------------------------------------------------------------- roster */

/** All roster entries, doctors alphabetically. */
export function rosterList(state: HmsState): DoctorSchedule[] {
  return Object.values(state.doctorSchedules ?? {}).sort((a, b) =>
    (a.doctor || "").localeCompare(b.doctor || ""),
  );
}

/** The roster entry covering one doctor, if any. */
export function rosterFor(state: HmsState, doctor: string): DoctorSchedule | undefined {
  const d = doctor.trim().toLowerCase();
  if (!d) return undefined;
  return rosterList(state).find((s) => (s.doctor || "").trim().toLowerCase() === d);
}

/** Active roster entries whose weekday covers the given date — who is on duty. */
export function doctorsOnDuty(state: HmsState, date: string): DoctorSchedule[] {
  const d = new Date(`${(date || "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return [];
  const day = d.getDay();
  return rosterList(state).filter((s) => s.active !== false && (s.days ?? []).includes(day));
}

/* ----------------------------------------------------------- prescriptions */

export function prescriptionsForPatient(state: HmsState, patientId: string): Prescription[] {
  return sortByDateDesc(
    Object.values(state.prescriptions ?? {}).filter((p) => p.patientId === patientId),
  );
}

/** "Amoxicillin, Paracetamol" or "A, B +2 more". */
export function prescriptionSummary(rx: Prescription, max = 2): string {
  const names = (rx.items ?? []).map((i) => (i.medication || "").trim()).filter(Boolean);
  if (names.length === 0) return "—";
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}

/* --------------------------------------------- appointment / OPD reporting */

export function appointmentsInRange(state: HmsState, range: RangeKey): Appointment[] {
  return Object.values(state.appointments ?? {}).filter((a) => inRange(a.date, range));
}

export function prescriptionsInRange(state: HmsState, range: RangeKey): Prescription[] {
  return Object.values(state.prescriptions ?? {}).filter((p) => inRange(p.date, range));
}

export interface AppointmentStats {
  total: number;
  scheduled: number;
  confirmed: number;
  checkedIn: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Still expected to be seen (scheduled + confirmed + checked in). */
  open: number;
  /** Appointments that carry a token number. */
  tokens: number;
  /** Share of all appointments marked completed, 0–100 %. */
  completedRate: number;
  /** Share of all appointments marked no-show, 0–100 %. */
  noShowRate: number;
}

export function appointmentStats(rows: Appointment[]): AppointmentStats {
  const count = (s: AppointmentStatus) => rows.filter((a) => a.status === s).length;
  const total = rows.length;
  const completed = count("Completed");
  const noShow = count("NoShow");
  return {
    total,
    scheduled: count("Scheduled"),
    confirmed: count("Confirmed"),
    checkedIn: count("CheckedIn"),
    completed,
    cancelled: count("Cancelled"),
    noShow,
    open: rows.filter((a) => OPEN_STATUSES.includes(a.status)).length,
    tokens: rows.filter((a) => Number(a.tokenNo ?? 0) > 0).length,
    completedRate: total ? Math.round((completed / total) * 100) : 0,
    noShowRate: total ? Math.round((noShow / total) * 100) : 0,
  };
}

export interface DoctorActivityRow extends AppointmentStats {
  doctor: string;
  prescriptions: number;
  medicines: number;
}

/** Per-doctor OPD activity for a range: appointments, tokens and prescribing. */
export function doctorActivityRows(state: HmsState, range: RangeKey): DoctorActivityRow[] {
  const appts = appointmentsInRange(state, range);
  const rxs = prescriptionsInRange(state, range);
  const names = new Set<string>();
  for (const a of appts) {
    const d = (a.doctor || "").trim();
    if (d) names.add(d);
  }
  for (const r of rxs) {
    const d = (r.doctor || "").trim();
    if (d) names.add(d);
  }
  return [...names]
    .map((doctor) => {
      const myAppts = appts.filter((a) => (a.doctor || "").trim() === doctor);
      const myRx = rxs.filter((r) => (r.doctor || "").trim() === doctor);
      return {
        doctor,
        ...appointmentStats(myAppts),
        prescriptions: myRx.length,
        medicines: myRx.reduce((s, r) => s + (r.items ?? []).length, 0),
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total || b.prescriptions - a.prescriptions || a.doctor.localeCompare(b.doctor),
    );
}

/** Most-prescribed medicines across the given prescriptions, biggest first. */
export function topMedicines(rows: Prescription[], limit = 8): [string, number][] {
  const counts = new Map<string, number>();
  for (const rx of rows) {
    for (const item of rx.items ?? []) {
      const name = (item.medication || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}
