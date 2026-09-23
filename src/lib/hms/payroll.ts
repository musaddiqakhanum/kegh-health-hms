import type { PayrollEntry, Staff } from "./types";

/**
 * Payroll calendar + pay math.
 *
 * Everything here is pure so the same numbers show up on the payroll page, the
 * printed payslip, the Reports totals and the Salary expense that gets posted.
 * A payroll "period" is always a `YYYY-MM` month key.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Round to 2 decimals the way rupee amounts are stored everywhere else. */
export function round2(n: number): number {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function utcDay(iso: string): number {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.floor(t / 86_400_000);
}

/** `YYYY-MM` for a date (defaults to today, local time). */
export function periodKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function currentPeriod(): string {
  return periodKey(new Date());
}

function parsePeriod(period: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec((period || "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

/** "September 2026" */
export function periodLabel(period: string): string {
  const p = parsePeriod(period);
  if (!p) return period || "—";
  return `${MONTHS[p.month - 1]} ${p.year}`;
}

/** "Sep 2026" */
export function shortPeriodLabel(period: string): string {
  const p = parsePeriod(period);
  if (!p) return period || "—";
  return `${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** First day of the period, `YYYY-MM-DD`. */
export function periodStart(period: string): string {
  const p = parsePeriod(period);
  if (!p) return "";
  return `${period}-01`;
}

/** Calendar days in the period. */
export function periodDays(period: string): number {
  const p = parsePeriod(period);
  if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

/** Last day of the period, `YYYY-MM-DD`. */
export function periodEnd(period: string): string {
  const days = periodDays(period);
  if (!days) return "";
  return `${period}-${String(days).padStart(2, "0")}`;
}

/** Move a period by `delta` months (negative goes back). */
export function shiftPeriod(period: string, delta: number): string {
  const p = parsePeriod(period);
  if (!p) return period;
  const idx = p.year * 12 + (p.month - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Period list for the month picker: `back` months of history, the current
 * month and `forward` months ahead (so next month's run can be prepared).
 */
export function periodOptions(back = 18, forward = 2): string[] {
  const now = currentPeriod();
  const out: string[] = [];
  for (let i = back; i >= -forward; i--) out.push(shiftPeriod(now, -i));
  return out;
}

/** Month key (`YYYY-MM`) of an ISO date string. */
export function monthOf(dateStr?: string | null): string {
  return (dateStr || "").slice(0, 7);
}

/** Is the staff member on roll at any point during the period? */
export function staffPayableIn(staff: Staff, period: string): boolean {
  return payableDays(staff, period) > 0;
}

/**
 * Payable calendar days for a period, pro-rated by the join date and the
 * leave date. Someone who joins or leaves mid-month is paid for the days
 * they were on roll.
 */
export function payableDays(staff: Staff, period: string): number {
  const start = periodStart(period);
  const end = periodEnd(period);
  if (!start || !end) return 0;
  const join = (staff.joinDate || "").slice(0, 10);
  const leave = (staff.leaveDate || "").slice(0, 10);
  const from = join && join > start ? join : start;
  const to = leave && leave < end ? leave : end;
  if (to < from) return 0;
  const a = utcDay(from);
  const b = utcDay(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const total = periodDays(period);
  return Math.max(0, Math.min(total, b - a + 1));
}

/** Pro-rated gross salary for the period (₹). */
export function grossForPeriod(staff: Staff, period: string): number {
  const total = periodDays(period);
  const salary = Number(staff.monthlySalary || 0);
  if (!total || salary <= 0) return 0;
  const days = payableDays(staff, period);
  if (days <= 0) return 0;
  if (days >= total) return round2(salary);
  return round2((salary * days) / total);
}

export interface NetPayInput {
  gross?: number | undefined;
  advanceGiven?: number | undefined;
  advanceRecovery?: number | undefined;
  deductions?: number | undefined;
}

/** gross + advance given − advance recovery − deductions. */
export function netPay(input: NetPayInput): number {
  return round2(
    Number(input.gross || 0) +
      Number(input.advanceGiven || 0) -
      Number(input.advanceRecovery || 0) -
      Number(input.deductions || 0),
  );
}

/** Recalculate the net pay of an entry from its own parts. */
export function withNet(entry: PayrollEntry): PayrollEntry {
  return { ...entry, netPay: netPay(entry) };
}

/** A fresh (Draft) payroll line for one staff member in one period. */
export function draftPayroll(staff: Staff, period: string): Omit<PayrollEntry, "id"> {
  const gross = grossForPeriod(staff, period);
  const advanceGiven = 0;
  const advanceRecovery = 0;
  const deductions = 0;
  return {
    period,
    staffId: staff.id,
    staffName: staff.name,
    role: staff.role,
    department: staff.department,
    daysInMonth: periodDays(period),
    payableDays: payableDays(staff, period),
    gross,
    advanceGiven,
    advanceRecovery,
    deductions,
    deductionNote: "",
    netPay: netPay({ gross, advanceGiven, advanceRecovery, deductions }),
    paymentMode: "Bank transfer",
    paidOn: "",
    status: "Draft",
    notes: "",
    createdAt: Date.now(),
  };
}

/**
 * Refresh the salary/date-derived parts of an existing line after the staff
 * record changed. Money the admin typed (advances, deductions, status) is kept.
 */
export function refreshPayroll(entry: PayrollEntry, staff: Staff, period: string): PayrollEntry {
  return withNet({
    ...entry,
    period,
    staffName: staff.name,
    role: staff.role,
    department: staff.department,
    daysInMonth: periodDays(period),
    payableDays: payableDays(staff, period),
    gross: grossForPeriod(staff, period),
  });
}

export interface PayrollTotals {
  count: number;
  gross: number;
  advanceGiven: number;
  advanceRecovery: number;
  deductions: number;
  net: number;
  paidNet: number;
  pendingNet: number;
  paidCount: number;
  pendingCount: number;
}

export function payrollTotals(rows: PayrollEntry[]): PayrollTotals {
  const sum = (pick: (r: PayrollEntry) => number) =>
    round2(rows.reduce((s, r) => s + Number(pick(r) || 0), 0));
  const paid = rows.filter((r) => r.status === "Paid");
  return {
    count: rows.length,
    gross: sum((r) => r.gross),
    advanceGiven: sum((r) => r.advanceGiven),
    advanceRecovery: sum((r) => r.advanceRecovery),
    deductions: sum((r) => r.deductions),
    net: sum((r) => r.netPay),
    paidNet: round2(paid.reduce((s, r) => s + Number(r.netPay || 0), 0)),
    pendingNet: round2(
      rows.filter((r) => r.status !== "Paid").reduce((s, r) => s + Number(r.netPay || 0), 0),
    ),
    paidCount: paid.length,
    pendingCount: rows.length - paid.length,
  };
}
