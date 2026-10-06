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

/** Quick picks for the ward field on beds and the bed board. */
export const WARDS: string[] = [
  "General Ward",
  "Male Ward",
  "Female Ward",
  "Maternity",
  "Pediatric",
  "Private Room",
  "Semi-Private",
  "ICU",
  "Emergency",
];

/** One physical bed in the hospital — occupancy is derived from admissions. */
export interface Bed {
  id: ID;
  ward: string;
  /** Room / cubicle, e.g. "101". */
  room: string;
  /** Bed label shown on the board, e.g. "101-A". */
  label: string;
  /** Per-day bed charge (₹) — shown on the board, picked up by billing later. */
  rate: number;
  /** Inactive beds are hidden from the board and pickers. */
  active: boolean;
  notes: string;
  createdAt: number;
}

export type AdmissionStatus = "Admitted" | "Discharged";

export const ADMISSION_STATUSES: AdmissionStatus[] = ["Admitted", "Discharged"];

/** An IPD stay: occupies a bed from admit until discharge. */
export interface Admission {
  id: ID;
  patientId: ID;
  /** Linked IPD visit, when one exists. */
  visitId: ID;
  bedId: ID;
  admitDate: string;
  admitTime: string;
  /** Provisional diagnosis / reason for admission. */
  reason: string;
  /** Treating doctor. */
  doctor: string;
  status: AdmissionStatus;
  /** Discharge block — filled by the discharge modal. */
  dischargeDate?: string | undefined;
  dischargeTime?: string | undefined;
  dischargeSummary?: string | undefined;
  dischargeAdvice?: string | undefined;
  dischargedBy?: string | undefined;
  /** Bill the bed charges were posted to — guards against double-posting. */
  bedChargeBillId?: ID | undefined;
  createdAt: number;
}

/** Quick picks for the category of a shift handover note. */
export const HANDOVER_CATEGORIES: string[] = [
  "Handover",
  "Patient follow-up",
  "Urgent",
  "Billing",
  "Pharmacy",
  "Lab / sample",
  "Housekeeping",
  "Other",
];

/**
 * A note one shift leaves for the next — written text, optionally a photo
 * (downscaled snapshot) and/or a short voice recording (compressed audio).
 * Attachments are data URIs inside the record, so they travel with the
 * normal Drive sync like every other collection.
 */
export interface HandoverNote {
  id: ID;
  /** Date the note was written, YYYY-MM-DD. */
  date: string;
  /** Clock time, HH:MM. */
  time: string;
  /** Who wrote it — session display name or device name. */
  author: string;
  /** Their role (Reception / Doctor / Nursing staff…). */
  role: string;
  category: string;
  /** Optional link when the note is about one patient. */
  patientId?: ID | undefined;
  text: string;
  /** Next shift marks the note handled. */
  resolved: boolean;
  resolvedBy?: string | undefined;
  resolvedAt?: number | undefined;
  /** Downscaled JPEG snapshot as a data URI. */
  photoData?: string | undefined;
  /** Voice note as a data URI (webm/opus from the browser recorder). */
  audioData?: string | undefined;
  audioMime?: string | undefined;
  createdAt: number;
}

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

/** Statuses a lab order moves through on its way to a result. */
export type LabOrderStatus = "Ordered" | "Sample collected" | "Result ready" | "Cancelled";

export const LAB_ORDER_STATUSES: LabOrderStatus[] = [
  "Ordered",
  "Sample collected",
  "Result ready",
  "Cancelled",
];

export type LabOrderPriority = "Routine" | "Urgent";

export const LAB_ORDER_PRIORITIES: LabOrderPriority[] = ["Routine", "Urgent"];

/** Quick-pick chips on the order form — free text stays possible. */
export const COMMON_LAB_TESTS: string[] = [
  "CBC",
  "Haemoglobin",
  "Blood sugar (F)",
  "Blood sugar (PP)",
  "HbA1c",
  "LFT",
  "KFT / RFT",
  "Lipid profile",
  "Thyroid profile",
  "Urine routine",
  "CRP",
  "ESR",
  "Widal",
  "Dengue NS1",
  "HIV",
  "HBsAg",
];

/** A request for lab work: doctor orders → sample collected → result entered. */
export interface LabOrder {
  id: ID;
  patientId: ID;
  visitId: ID;
  /** Order date, YYYY-MM-DD. */
  date: string;
  /** Tests requested, text (one or more, comma-separated). */
  tests: string;
  priority: LabOrderPriority;
  status: LabOrderStatus;
  orderedBy: string;
  notes: string;
  /** Sample collection details, stamped when the sample is taken. */
  collectedDate?: string | undefined;
  collectedTime?: string | undefined;
  collectedBy?: string | undefined;
  /** Lab result entry fulfilling this order, when one was entered from it. */
  labResultId?: ID | undefined;
  createdAt: number;
}

/** Statuses an imaging order moves through on its way to a report. */
export type ImagingOrderStatus = "Ordered" | "Study done" | "Report ready" | "Cancelled";

export const IMAGING_ORDER_STATUSES: ImagingOrderStatus[] = [
  "Ordered",
  "Study done",
  "Report ready",
  "Cancelled",
];

/** Quick-pick chips on the imaging order form — free text stays possible. */
export const COMMON_IMAGING_STUDIES: string[] = [
  "X-Ray Chest PA",
  "X-Ray KUB",
  "USG Abdomen",
  "USG Pelvis",
  "USG Obstetric (ANC)",
  "CT Brain",
  "CT Abdomen",
  "MRI Brain",
  "MRI Spine",
  "ECG",
  "2D Echo",
  "Mammography",
];

/** A request for imaging: doctor orders → study performed → report entered. */
export interface ImagingOrder {
  id: ID;
  patientId: ID;
  visitId: ID;
  /** Order date, YYYY-MM-DD. */
  date: string;
  /** Studies requested, text (one or more, comma-separated). */
  study: string;
  priority: LabOrderPriority;
  status: ImagingOrderStatus;
  orderedBy: string;
  notes: string;
  /** Scan details, stamped when the study is performed. */
  performedDate?: string | undefined;
  performedTime?: string | undefined;
  performedBy?: string | undefined;
  /** Radiology report fulfilling this order, when one was entered from it. */
  radId?: ID | undefined;
  createdAt: number;
}

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

/** One batch draw-down a dispense entry applied against stock. */
export interface StockDraw {
  batchId: ID;
  qty: number;
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
  /** Catalog medicine this entry dispensed, when stock-tracked. */
  medicineId?: ID | undefined;
  /** Batch draw-downs applied on save — reversed when the entry is edited / deleted. */
  stockDraws?: StockDraw[] | undefined;
  /** Units currently in stock for this medication (inventory tracking). */
  stockQty?: number | undefined;
  /** Reorder level — flag low-stock when stockQty <= minStock. */
  minStock?: number | undefined;
  /** Supplier / distributor name for reorders. */
  supplier?: string | undefined;
  createdAt: number;
}

/** Quick picks for the dosage-form field on a catalog medicine. */
export const MED_CATEGORIES: string[] = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Ointment / Cream",
  "Drops",
  "Inhaler",
  "Sachet",
  "Suppository",
  "Consumable",
  "Other",
];

/** Units stock is counted in — shown across inventory, GRN and dispense. */
export const MED_UNITS: string[] = [
  "tablet",
  "capsule",
  "strip",
  "bottle",
  "vial",
  "ampoule",
  "tube",
  "sachet",
  "box",
  "piece",
];

/** A medicine in the pharmacy catalog — the master record stock is tracked against. */
export interface Med {
  id: ID;
  /** Brand / product name, e.g. "Dolo 650". */
  name: string;
  /** Generic / salt name, e.g. "Paracetamol 650 mg". */
  genericName: string;
  /** Dosage form, from MED_CATEGORIES or free text. */
  category: string;
  /** Unit stock is counted in (tablet, strip, bottle…). */
  unit: string;
  /** Reorder level — flag low stock when on-hand stock falls to or below this. */
  reorderLevel: number;
  /** Default sale rate per unit (₹), pre-fills the dispense rate. */
  saleRate: number;
  /** Preferred supplier / distributor for reorders. */
  supplier: string;
  /** HSN / product code for purchase records. */
  hsn: string;
  /** Inactive medicines stay on file but are hidden from pickers. */
  active: boolean;
  notes: string;
  createdAt: number;
}

/** One physical stock batch of a medicine — created by a GRN line (or a manual add), drawn down by dispensing. */
export interface StockBatch {
  id: ID;
  medicineId: ID;
  batchNo: string;
  /** Expiry month as YYYY-MM (pack labels give month precision). */
  expiry: string;
  qtyOnHand: number;
  /** Qty originally received incl. free qty — a batch counts as "opened" once qtyOnHand < qtyReceived. */
  qtyReceived: number;
  /** Purchase price per unit (₹). */
  purchaseRate: number;
  /** MRP per unit (₹). */
  mrp: number;
  supplier: string;
  /** GRN that brought this batch into stock. Empty for manual / opening-stock adds. */
  grnId?: ID | undefined;
  /** Adjustment note, e.g. "10 tabs broken in transit". */
  notes: string;
  createdAt: number;
}

/** One line on a Goods Receipt Note. */
export interface GrnItem {
  medicineId: ID;
  /** Snapshot of the medicine name at posting time, so printed GRNs survive catalog edits. */
  medicineName: string;
  batchNo: string;
  /** Expiry month, YYYY-MM. */
  expiry: string;
  qty: number;
  freeQty: number;
  purchaseRate: number;
  mrp: number;
  /** Stock batch this line created, after the GRN is posted. */
  batchId?: ID | undefined;
}

/** Goods Receipt Note — a supplier delivery posted into batch stock. */
export interface Grn {
  id: ID;
  /** Running number, shown as GRN-42. */
  grnNo: number;
  /** Date the goods were received, YYYY-MM-DD. */
  date: string;
  supplier: string;
  invoiceNo: string;
  invoiceDate: string;
  items: GrnItem[];
  /** Purchase value = Σ qty × purchaseRate (free qty excluded). */
  total: number;
  receivedBy: string;
  notes: string;
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

/** Fulfilment state of a prescription at the pharmacy counter. */
export type RxFulfilStatus = "Pending" | "Partial" | "Dispensed";

export const RX_FULFIL_STATUSES: RxFulfilStatus[] = ["Pending", "Partial", "Dispensed"];

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
  /** Parallel to items: true once the pharmacy has handed that medicine over. */
  itemDispensed?: boolean[] | undefined;
  /** Derived fulfilment state — kept on the record for filtering and reports. */
  dispenseStatus?: RxFulfilStatus | undefined;
  /** Who last dispensed against this prescription, and when (ms epoch). */
  dispensedBy?: string | undefined;
  dispensedAt?: number | undefined;
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
  | "admissions"
  | "beds"
  | "labs"
  | "labOrders"
  | "rads"
  | "imagingOrders"
  | "pharms"
  | "meds"
  | "batches"
  | "grns"
  | "bills"
  | "appointments"
  | "doctorSchedules"
  | "prescriptions"
  | "handoverNotes"
  | "expenses"
  | "staff"
  | "payrolls"
  | "users"
  | "auditLogs";

/** Every synced collection — merge, backup and import all iterate this list. */
export const COLLECTIONS: Collection[] = [
  "patients",
  "visits",
  "admissions",
  "beds",
  "labs",
  "labOrders",
  "rads",
  "imagingOrders",
  "pharms",
  "meds",
  "batches",
  "grns",
  "bills",
  "appointments",
  "doctorSchedules",
  "prescriptions",
  "handoverNotes",
  "expenses",
  "staff",
  "payrolls",
  "users",
  "auditLogs",
];

export interface HmsState {
  patients: Record<ID, Patient>;
  visits: Record<ID, Visit>;
  admissions: Record<ID, Admission>;
  beds: Record<ID, Bed>;
  labs: Record<ID, Lab>;
  labOrders: Record<ID, LabOrder>;
  rads: Record<ID, Rad>;
  imagingOrders: Record<ID, ImagingOrder>;
  pharms: Record<ID, Pharm>;
  meds: Record<ID, Med>;
  batches: Record<ID, StockBatch>;
  grns: Record<ID, Grn>;
  bills: Record<ID, Bill>;
  appointments: Record<ID, Appointment>;
  doctorSchedules: Record<ID, DoctorSchedule>;
  prescriptions: Record<ID, Prescription>;
  handoverNotes: Record<ID, HandoverNote>;
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
  /**
   * Force sign-out stamp: any device session for this account that began
   * BEFORE this time is dropped the moment the stamp arrives with a sync.
   */
  sessionsKickedAt?: number | undefined;
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
  /**
   * Idle auto-lock per device, in minutes (0 = off): a signed-in session is
   * dropped after this long without keyboard / pointer activity.
   */
  idleLockMinutes: number;
  /** doctors available for selection across the app */
  doctors: string[];
  pin: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  encryptionEnabled: boolean;
  driveClientId: string;
  driveFolderName: string;
  /**
   * Team mode: several staff members' own Google accounts sync one shared
   * folder. Requires the full `drive` scope (Google's `drive.file` scope is
   * per-account), so the folder is pinned by id below.
   */
  driveTeamMode: boolean;
  /** Shared folder link or id (Team mode). Empty = find / create by name. */
  driveFolderId: string;
  lastSyncAt: number | null;
  lastSyncFileCount: number;
}

export const emptyState = (): HmsState => ({
  patients: {},
  visits: {},
  admissions: {},
  beds: {},
  labs: {},
  labOrders: {},
  rads: {},
  imagingOrders: {},
  pharms: {},
  meds: {},
  batches: {},
  grns: {},
  bills: {},
  appointments: {},
  doctorSchedules: {},
  prescriptions: {},
  handoverNotes: {},
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
  idleLockMinutes: 0,
  doctors: [],
  pin: "",
  autoSync: true,
  syncIntervalMinutes: 10,
  encryptionEnabled: false,
  driveClientId: "",
  driveFolderName: "KEGH-HMS Health Records",
  driveTeamMode: false,
  driveFolderId: "",
  lastSyncAt: null,
  lastSyncFileCount: 0,
});
