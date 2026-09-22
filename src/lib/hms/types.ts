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
  totalAmount: number;
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
  createdAt: number;
}

export type Collection =
  "patients" | "visits" | "labs" | "rads" | "pharms" | "bills" | "appointments";

export interface HmsState {
  patients: Record<ID, Patient>;
  visits: Record<ID, Visit>;
  labs: Record<ID, Lab>;
  rads: Record<ID, Rad>;
  pharms: Record<ID, Pharm>;
  bills: Record<ID, Bill>;
  appointments: Record<ID, Appointment>;
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
  pin: "",
  autoSync: true,
  syncIntervalMinutes: 10,
  encryptionEnabled: false,
  driveClientId: "",
  driveFolderName: "KEGH-HMS Health Records",
  lastSyncAt: null,
  lastSyncFileCount: 0,
});
