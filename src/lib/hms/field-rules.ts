/**
 * Per-field write rules for the hospital room (design phase 4b, item 3).
 *
 * The room checks every change against these rules before it is logged. A change
 * is accepted only if the signed-in role may write every field that differs from
 * the room's current version (see `authorizeChange` in sync-auth.ts). Admin may
 * write every field and is not listed. An empty list means Admin only.
 *
 * Every field of every synced record type must have an entry here. The smoke
 * suite reads types.ts and fails if a field is missing, so a new field cannot
 * slip past the rules without a decision.
 *
 * Matrix: docs/phase-4b-draft.md, section 1 (approved). Rows marked "added" in
 * the PR description were not in the draft and need a second look.
 */
import type { Role } from "./types";

type Grants = Record<string, readonly Role[]>;

/** Fields `names` (space separated) may be written by `roles`. */
function grant(roles: readonly Role[], names: string): Grants {
  return Object.fromEntries(
    names
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => [n, roles]),
  );
}

const RECEPTION = "Reception" as const;
const NURSING = "Nursing" as const;
const DOCTOR = "Doctor" as const;
const LAB = "Lab" as const;
const PHARMACY = "Pharmacy" as const;
const BILLING = "Billing" as const;

/** Fields `names` that only Admin may write. */
const ADMIN = (names: string): Grants => grant([], names);

/** Collection → field → roles. Collections not listed here are not field-checked. */
export const FIELD_RULES: Record<string, Grants> = {
  patients: Object.assign(
    {},
    grant([RECEPTION, DOCTOR, NURSING], "name dob gender phone address fatherName"),
    grant([DOCTOR, NURSING], "bloodGroup allergies"),
    grant([RECEPTION, DOCTOR], "doctor"),
    grant([RECEPTION], "mrn"), // added: registration sets the MRN
    grant(
      [RECEPTION, BILLING],
      "abhaNumber abhaAddress abhaVerified abhaVerifiedAt pmjayCardId pmjayFamilyId pmjayScheme pmjayStatus pmjayVerified pmjayVerifiedAt",
    ),
  ),
  visits: Object.assign(
    {},
    grant([RECEPTION, DOCTOR, NURSING], "patientId"), // added: the roles that open visits
    grant([RECEPTION, DOCTOR], "date type doctor department admissionDate dischargeDate"),
    grant([DOCTOR], "diagnosis notes procedures followUp"),
  ),
  admissions: Object.assign(
    {},
    grant([RECEPTION, NURSING, DOCTOR], "patientId visitId bedId admitDate admitTime status"),
    grant([RECEPTION, DOCTOR], "reason doctor"), // changed: Reception enters reason and doctor on admission
    grant(
      [DOCTOR],
      "expectedDischarge dischargeDate dischargeTime dischargeSummary dischargeAdvice dischargedBy",
    ),
    grant([BILLING, RECEPTION, NURSING, DOCTOR], "bedChargeBillId"), // changed: bed charges are posted by these roles
  ),
  beds: Object.assign(
    {},
    grant([RECEPTION, NURSING], "ward room label active notes"),
    ADMIN("rate"),
  ),
  labs: grant([LAB], "patientId visitId date testName result unit normalRange flag technician"),
  labOrders: Object.assign(
    {},
    grant([DOCTOR], "patientId visitId date tests priority orderedBy notes"),
    grant([DOCTOR, LAB, NURSING], "status"), // added: an order is created with a status
    grant([LAB, NURSING], "collectedDate collectedTime collectedBy"),
    grant([LAB], "labResultId"),
    grant([BILLING, LAB, RECEPTION, DOCTOR, NURSING], "labChargeBillId"), // changed: charges posted from these roles
  ),
  rads: grant([LAB], "patientId visitId date studyType findings impression radiologist"),
  imagingOrders: Object.assign(
    {},
    grant([DOCTOR], "patientId visitId date study priority orderedBy notes"),
    grant([DOCTOR, LAB, NURSING], "status"), // added: an order is created with a status
    grant([LAB, NURSING], "performedDate performedTime performedBy"),
    grant([LAB], "radId"),
    grant([BILLING, LAB, RECEPTION, DOCTOR, NURSING], "imagingChargeBillId"), // changed: charges posted from these roles
  ),
  serviceRates: ADMIN("id section item rate active"),
  pharms: grant(
    [PHARMACY],
    "patientId visitId date medication dosage frequency duration qty rate medicineId stockDraws stockQty minStock supplier",
  ),
  meds: grant(
    [PHARMACY],
    "name genericName category unit reorderLevel saleRate supplier hsn active notes",
  ),
  medCatalog: grant([PHARMACY], "name form strength"),
  batches: grant(
    [PHARMACY],
    "medicineId batchNo expiry qtyOnHand qtyReceived purchaseRate mrp supplier grnId notes",
  ),
  grns: grant([PHARMACY], "grnNo date supplier invoiceNo invoiceDate items total receivedBy notes"),
  bills: Object.assign(
    {},
    grant([BILLING], "discount tax"),
    grant([BILLING, RECEPTION], "paid payerId payerName"),
    // changed: charges are posted to bills by these roles (lab, imaging, IPD bed charges, Billing)
    grant(
      [BILLING, RECEPTION, LAB, DOCTOR, NURSING],
      "items totalAmount due paymentMode patientId visitId date",
    ),
  ),
  payers: grant([BILLING], "name type code contact settlementDays active notes"),
  claims: grant(
    [BILLING],
    "claimNo patientId visitId admissionId billId payerId payerName scheme policyNo date treatment admissionDate dischargeDate packageCode claimedAmount approvedAmount settledAmount patientShare status reference docs events notes preparedBy settledOn settlementRef settlementPosted",
  ),
  surgeries: Object.assign(
    {},
    grant(
      [RECEPTION, DOCTOR],
      "surgeryNo patientId visitId admissionId date time durationMinutes room procedure code priority surgeon assistant anaesthetist anaesthesia diagnosis scrubNurse",
    ),
    grant([DOCTOR, NURSING], "checks startedAt completedAt cancelledAt cancelReason notes"),
    grant([RECEPTION, DOCTOR, NURSING], "status"), // added: a schedule is created with a status
    grant([DOCTOR], "findings postOpNotes"),
    grant([BILLING], "chargeBillId"),
  ),
  appointments: Object.assign(
    {},
    grant([RECEPTION], "patientId date time doctor department type notes tokenNo tokenTime"),
    grant([RECEPTION, DOCTOR], "status"),
  ),
  doctorSchedules: grant([RECEPTION], "doctor department days slots active"),
  prescriptions: Object.assign(
    {},
    grant([DOCTOR], "patientId visitId date doctor diagnosis items notes signOff"),
    grant([PHARMACY], "itemDispensed dispenseStatus dispensedBy dispensedAt"),
  ),
  handoverNotes: Object.assign(
    {},
    grant(
      [NURSING, DOCTOR, RECEPTION],
      "date time role category patientId text photoData audioData audioMime author",
    ),
    // added: any role may resolve a handover note (every role uses the handover page)
    grant([RECEPTION, NURSING, DOCTOR, LAB, PHARMACY, BILLING], "resolved resolvedBy resolvedAt"),
  ),
  vitals: grant(
    [NURSING],
    "patientId visitId admissionId date time shift temperature pulse respRate bpSystolic bpDiastolic spo2 painScore weightKg intakeMl outputMl recordedBy notes",
  ),
  nursingNotes: grant(
    [NURSING],
    "patientId visitId admissionId date time shift category author text",
  ),
  // Admin-only collections (expenses, staff, payrolls, users) are refused before field rules apply.
  expenses: ADMIN("date category amount notes paidBy payrollPeriod source"),
  staff: ADMIN("name role department phone monthlySalary joinDate leaveDate notes"),
  payrolls: ADMIN(
    "period staffId staffName role department daysInMonth payableDays gross advanceGiven advanceRecovery deductions deductionNote netPay paymentMode paidOn status notes",
  ),
  users: ADMIN("username displayName role staffId passwordHash salt active sessionsKickedAt"),
};

/**
 * Fields that may be set when a record is created and never changed afterwards
 * (by anyone but Admin). Collection → fields.
 */
export const CREATE_ONLY_FIELDS: Record<string, readonly string[]> = {
  handoverNotes: ["author"],
};
