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
  createdAt: number;
}

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
  createdAt: number;
}

export type AuditAction = "create" | "update" | "delete";

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
  | "auditLogs";

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
  auditLogs: Record<ID, AuditLog>;
  /** operation log: `${collection}:${id}` -> last write timestamp (ms) */
  ops: Record<string, number>;
  /** tombstones for deleted records: `${collection}:${id}` -> deletion timestamp */
  deleted: Record<string, number>;
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
