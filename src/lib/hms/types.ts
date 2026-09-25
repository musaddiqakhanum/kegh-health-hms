export type ID = string;

export interface Patient {
  id: ID;
  name: string;
  mrn: string;
  dob: string;
  gender: "M" | "F" | "Other" | string;
  phone: string;
  address: string;
  fatherName: string;
  bloodGroup: string;
  allergies: string;
  /** assigned / consulting doctor */
  doctor: string;
  /** 14-digit ABHA number (stored digits-only), e.g. "93124582713456". */
  abhaNumber?: string;
  /** ABHA address linked with the number, e.g. "name@sbx". */
  abhaAddress?: string;
  /** True once the number passed live ABDM OTP verification. */
  abhaVerified?: boolean;
  /** When the ABHA verification happened (ms epoch). */
  abhaVerifiedAt?: number;
  /** PM-JAY (Ayushman) golden card / beneficiary ID. */
  pmjayCardId?: string;
  /** PM-JAY family / household (ration card) ID. */
  pmjayFamilyId?: string;
  /** Scheme the card belongs to, e.g. "PM-JAY" or a state top-up. */
  pmjayScheme?: string;
  /** Enrollment status of the PM-JAY card. */
  pmjayStatus?: PmjayStatus;
  /** True once staff confirmed the card on the NHA / state beneficiary portal. */
  pmjayVerified?: boolean;
  /** When the PM-JAY card was last checked (ms epoch). */
  pmjayVerifiedAt?: number;
  createdAt: number;
}

/** Enrollment states tracked for an Ayushman (PM-JAY) card. */
export type PmjayStatus = "Not enrolled" | "Applied" | "Enrolled" | "Verified";

export const PMJAY_STATUSES: PmjayStatus[] = ["Not enrolled", "Applied", "Enrolled", "Verified"];

/** Quick picks for the scheme field next to the PM-JAY card. */
export const PMJAY_SCHEMES: string[] = [
  "PM-JAY (Ayushman Bharat)",
  "PM-JAY + State top-up",
  "State health scheme",
  "CGHS",
  "ESIC",
  "Private insurance",
];

export type VisitType = "OPD" | "IPD" | "Emergency";

export interface Visit {
  id: ID;
  patientId: ID;
  date: string;
  type: VisitType;
  doctor: string;
  department: string;
  diagnosis: string;
  notes: string;
  admissionDate: string;
  dischargeDate: string;
  /** IPD: procedures / interventions performed during admission. */
  procedures?: string;
  /** IPD: follow-up advice given at discharge. */
  followUp?: string;
  createdAt: number;
}

export type LabFlag = "normal" | "high" | "low" | "critical";

export interface Lab {
  id: ID;
  patientId: ID;
  visitId: ID;
  date: string;
  testName: string;
  result: string;
  unit: string;
  normalRange: string;
  flag: LabFlag;
  technician: string;
  createdAt: number;
}

export interface Rad {
  id: ID;
  patientId: ID;
  visitId: ID;
  date: string;
  studyType: string;
  findings: string;
  impression: string;
  radiologist: string;
  createdAt: number;
}

export interface Pharm {
  id: ID;
  patientId: ID;
  visitId: ID;
  date: string;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  qty: number;
  rate: number;
  /** Units currently in stock for this medication (inventory tracking). */
  stockQty?: number | undefined;
  /** Reorder level — flag low-stock when stockQty <= minStock. */
  minStock?: number | undefined;
  /** Supplier / distributor name for reorders. */
  supplier?: string | undefined;
  createdAt: number;
}

export interface BillItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface Bill {
  id: ID;
  patientId: ID;
  visitId: ID;
  date: string;
  items: BillItem[];
  /** Grand total = (items subtotal − discount) + tax. */
  totalAmount: number;
  /** Flat discount applied on the subtotal (₹). */
  discount?: number;
  /** Tax applied after discount (₹). */
  tax?: number;
  paid: number;
  due: number;
  paymentMode: string;
  createdAt: number;
}

export type AppointmentType = "OPD" | "Follow-up" | "Consultation" | "IPD" | "Emergency";
export type AppointmentStatus =
  "Scheduled" | "Confirmed" | "CheckedIn" | "Completed" | "Cancelled" | "NoShow";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "Completed",
  "Cancelled",
  "NoShow",
];

/** Types offered when booking — emergencies arrive through triage, not the diary. */
export const APPOINTMENT_TYPES: AppointmentType[] = ["OPD", "Follow-up", "Consultation", "IPD"];

export interface Appointment {
  id: ID;
  patientId: ID;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  doctor: string;
  department: string;
  type: AppointmentType;
  status: AppointmentStatus;
  notes: string;
  /** OPD token number derived from today's confirmed appointments. */
  tokenNo?: number;
  /** When the appointment was checked in at the queue (clock time). */
  tokenTime?: string;
  createdAt: number;
}

/** Weekly roster entry: which weekdays (0=Sun..6=Sat) a doctor is available. */
export interface DoctorSchedule {
  id: ID;
  doctor: string;
  department: string;
  /** Weekdays the doctor is available, 0 (Sun) – 6 (Sat). */
  days: number[];
  /** Human-readable slots, e.g. "09:00-13:00, 17:00-20:00". */
  slots: string;
  active: boolean;
  createdAt: number;
}

/** One medication line on a prescription. */
export interface PrescriptionItem {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
}

export function isPrescriptionItem(v: unknown): v is PrescriptionItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o["medication"] === "string";
}

export type PrescriptionSource = "visit" | "queue";

export interface Prescription {
  id: ID;
  patientId: ID;
  visitId: ID;
  date: string;
  doctor: string;
  diagnosis: string;
  items: PrescriptionItem[];
  notes: string;
  /** Freely-typed sign-off; defaults to the prescribing doctor name. */
  signOff: string;
  createdAt: number;
}

/** Expense categories used on the expense entry page. */
export type ExpenseCategory =
  | "Salaries"
  | "Rent & utilities"
  | "Supplies & consumables"
  | "Equipment"
  | "Maintenance"
  | "Medicines"
  | "Miscellaneous";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Salaries",
  "Rent & utilities",
  "Supplies & consumables",
  "Equipment",
  "Maintenance",
  "Medicines",
  "Miscellaneous",
];

export interface Expense {
  id: ID;
  date: string;
  category: ExpenseCategory | string;
  amount: number;
  notes: string;
  paidBy: string;
  /** Payroll month (YYYY-MM) when the entry was posted by a payroll run. */
  payrollPeriod?: string | undefined;
  /** "payroll" entries are maintained from the Payroll page, not by hand. */
  source?: "manual" | "payroll" | undefined;
  createdAt: number;
}

/** Quick picks offered while registering a staff member. */
export const STAFF_ROLES: string[] = [
  "Doctor",
  "Nurse",
  "Receptionist",
  "Lab Technician",
  "Radiology Technician",
  "Pharmacist",
  "Accountant",
  "Administrator",
  "Housekeeping",
  "Security",
  "Other",
];

/** Quick picks for the department field on staff and payroll records. */
export const DEPARTMENTS: string[] = [
  "Administration",
  "Billing & Accounts",
  "Casualty / Emergency",
  "Housekeeping",
  "Laboratory",
  "Nursing",
  "OPD",
  "Pharmacy",
  "Radiology",
  "Reception",
  "Security",
];

/** A person on the hospital roll — the master record the payroll run reads. */
export interface Staff {
  id: ID;
  name: string;
  /** Job title, e.g. "Staff Nurse" or "Lab Technician". */
  role: string;
  department: string;
  phone: string;
  /** Gross monthly salary in ₹. */
  monthlySalary: number;
  /** Date of joining, YYYY-MM-DD. */
  joinDate: string;
  /** Last working day, YYYY-MM-DD. Empty while the person is on roll. */
  leaveDate: string;
  notes: string;
  createdAt: number;
}

export type PayrollStatus = "Draft" | "Approved" | "Paid";

export const PAYROLL_STATUSES: PayrollStatus[] = ["Draft", "Approved", "Paid"];

/** Salary disbursement modes offered on the payroll run. */
export const PAYROLL_MODES: string[] = ["Bank transfer", "Cash", "UPI", "Cheque"];

/** Quick picks shown next to the deduction field on a payroll entry. */
export const DEDUCTION_REASONS: string[] = [
  "PF",
  "ESI",
  "TDS",
  "Loan recovery",
  "Leave / absence",
  "Penalty",
  "Other",
];

/**
 * One staff member's pay for a single monthly payroll run.
 * `period` is the payroll month as YYYY-MM.
 */
export interface PayrollEntry {
  id: ID;
  /** Payroll month, YYYY-MM. */
  period: string;
  staffId: ID;
  /** Snapshot of the staff record, so printed payslips survive later edits. */
  staffName: string;
  role: string;
  department: string;
  /** Calendar days in the payroll month. */
  daysInMonth: number;
  /** Payable days after pro-rating the join / leave dates. */
  payableDays: number;
  /** Pro-rated gross salary for the month (₹). */
  gross: number;
  /** Advance handed over with this month's pay — added to the payout (₹). */
  advanceGiven: number;
  /** Recovery of an advance paid earlier — deducted from the payout (₹). */
  advanceRecovery: number;
  /** Other deductions: PF, ESI, TDS, loan, absence… (₹). */
  deductions: number;
  /** Free-text reason for `deductions`. */
  deductionNote: string;
  /** gross + advanceGiven − advanceRecovery − deductions (₹). */
  netPay: number;
  paymentMode: string;
  /** Date the salary was actually paid, YYYY-MM-DD. Empty until paid. */
  paidOn: string;
  status: PayrollStatus;
  notes: string;
  createdAt: number;
}

export type AuditAction = "create" | "update" | "delete" | "login" | "logout";

/** Lightweight audit trail entry for writes made on any device. */
export interface AuditLog {
  id: ID;
  action: AuditAction;
  collection: string;
  recordId: string;
  timestamp: number;
  deviceName: string;
  role: string;
  createdAt: number;
}

export type Collection =
  | "patients"
  | "visits"
  | "labs"
  | "rads"
  | "pharms"
  | "bills"
  | "appointments"
  | "doctorSchedules"
  | "prescriptions"
  | "expenses"
  | "staff"
  | "payrolls"
  | "users"
  | "auditLogs";

/** Every synced collection — merge, backup and import all iterate this list. */
export const COLLECTIONS: Collection[] = [
  "patients",
  "visits",
  "labs",
  "rads",
  "pharms",
  "bills",
  "appointments",
  "doctorSchedules",
  "prescriptions",
  "expenses",
  "staff",
  "payrolls",
  "users",
  "auditLogs",
];

export interface HmsState {
  patients: Record<ID, Patient>;
  visits: Record<ID, Visit>;
  labs: Record<ID, Lab>;
  rads: Record<ID, Rad>;
  pharms: Record<ID, Pharm>;
  bills: Record<ID, Bill>;
  appointments: Record<ID, Appointment>;
  doctorSchedules: Record<ID, DoctorSchedule>;
  prescriptions: Record<ID, Prescription>;
  expenses: Record<ID, Expense>;
  staff: Record<ID, Staff>;
  payrolls: Record<ID, PayrollEntry>;
  users: Record<ID, User>;
  auditLogs: Record<ID, AuditLog>;
  /** operation log: `${collection}:${id}` -> last write timestamp (ms) */
  ops: Record<string, number>;
  /** tombstones for deleted records: `${collection}:${id}` -> deletion timestamp */
  deleted: Record<string, number>;
}

/**
 * A staff login account. Passwords are never stored in plaintext — only a
 * PBKDF2-SHA-256 hash (100,000 iterations) of the password with a per-user
 * random salt, the same crypto pattern the .keg backup encryption uses.
 */
export interface User {
  id: ID;
  /** Login name — unique across the list, compared case-insensitively. */
  username: string;
  /** Human-readable name shown in the header, sidebar and on printed slips. */
  displayName: string;
  /** Workspace + nav this account gets after signing in. */
  role: Role;
  /** Optional link to a staff record (payroll / master data). */
  staffId?: ID | undefined;
  /** PBKDF2-SHA-256 (100k iterations) digest of the password, hex-encoded. */
  passwordHash: string;
  /** Random 16-byte salt for the password hash, hex-encoded. */
  salt: string;
  /** Inactive accounts are listed but cannot sign in. */
  active: boolean;
  createdAt: number;
}

export type Role = "Admin" | "Reception" | "Doctor" | "Lab" | "Pharmacy" | "Billing";

export interface Settings {
  hospitalName: string;
  hospitalAddress: string;
  hospitalPhone: string;
  registrationNumber: string;
  deviceName: string;
  deviceId: string;
  role: Role;
  /**
   * When true (and at least one active user exists) the app blocks behind the
   * login screen until a staff member signs in. With zero users the app keeps
   * today's behaviour: free role choice plus the optional device PIN.
   */
  requireLogin: boolean;
  /** doctors available for selection across the app */
  doctors: string[];
  pin: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  encryptionEnabled: boolean;
  driveClientId: string;
  driveFolderName: string;
  lastSyncAt: number | null;
  lastSyncFileCount: number;
}

export const emptyState = (): HmsState => ({
  patients: {},
  visits: {},
  labs: {},
  rads: {},
  pharms: {},
  bills: {},
  appointments: {},
  doctorSchedules: {},
  prescriptions: {},
  expenses: {},
  staff: {},
  payrolls: {},
  users: {},
  auditLogs: {},
  ops: {},
  deleted: {},
});

export const defaultSettings = (): Settings => ({
  hospitalName: "KEGH LLP",
  hospitalAddress: "",
  hospitalPhone: "",
  registrationNumber: "",
  deviceName: "This Device",
  deviceId: "",
  role: "Admin",
  requireLogin: false,
  doctors: [],
  pin: "",
  autoSync: true,
  syncIntervalMinutes: 10,
  encryptionEnabled: false,
  driveClientId: "",
  driveFolderName: "KEGH-HMS Health Records",
  lastSyncAt: null,
  lastSyncFileCount: 0,
});
