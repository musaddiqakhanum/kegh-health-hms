import { useHms } from "@/lib/hms/store";
import { fmtDate } from "@/lib/hms/format";
import type { Patient, Prescription } from "@/lib/hms/types";
import { PrintOverlay } from "./PrintOverlay";

/** Printable patient identifier header used on prescriptions and discharge summaries. */
export function PatientHeader({ patient }: { patient: Patient }) {
  return (
    <table className="mb-4">
      <tbody>
        <tr>
          <th className="w-36">Name</th>
          <td>{patient.name}</td>
          <th className="w-36">MRN</th>
          <td>{patient.mrn}</td>
        </tr>
        <tr>
          <th>DOB / Sex</th>
          <td>
            {fmtDate(patient.dob)} / {patient.gender}
          </td>
          <th>Phone</th>
          <td>{patient.phone || "—"}</td>
        </tr>
        <tr>
          <th>Father / guardian</th>
          <td>{patient.fatherName || "—"}</td>
          <th>Blood group</th>
          <td>{patient.bloodGroup || "—"}</td>
        </tr>
        <tr>
          <th>Allergies</th>
          <td colSpan={3}>{patient.allergies || "None recorded"}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Medication table shared by prescription print/preview and the Patient 360 view. */
export function PrescriptionTable({
  prescription,
  patient,
}: {
  prescription: Prescription;
  patient: Patient | undefined;
}) {
  const { state } = useHms();
  const p =
    patient ?? (prescription.patientId ? state.patients[prescription.patientId] : undefined);
  const doctor = prescription.doctor || "—";
  const signOff = (prescription.signOff || "").trim() || doctor;
  return (
    <div>
      {p ? <PatientHeader patient={p} /> : null}
      <table className="mb-4">
        <tbody>
          <tr>
            <th className="w-36">Attending doctor</th>
            <td>{doctor}</td>
            <th className="w-36">Date</th>
            <td>{fmtDate(prescription.date)}</td>
          </tr>
          {prescription.diagnosis ? (
            <tr>
              <th>Diagnosis</th>
              <td colSpan={3}>{prescription.diagnosis}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <p className="mb-1 font-semibold">℞ Medications</p>
      <table className="mb-4">
        <thead>
          <tr>
            <th>#</th>
            <th>Medication</th>
            <th>Dosage</th>
            <th>Frequency</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {(prescription.items ?? []).map((m, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{m.medication || "—"}</td>
              <td>{m.dosage || "—"}</td>
              <td>{m.frequency || "—"}</td>
              <td>{m.duration || "—"}</td>
            </tr>
          ))}
          {(prescription.items ?? []).length === 0 ? (
            <tr>
              <td colSpan={5}>No medications listed.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {prescription.notes ? (
        <p className="mb-4">
          <strong>Instructions:</strong> {prescription.notes}
        </p>
      ) : null}

      <div className="mt-8 flex justify-end">
        <div className="w-56 text-center">
          <p className="border-t border-slate-400 pt-1 font-semibold">{signOff}</p>
          <p className="text-xs text-slate-500">Doctor's signature</p>
        </div>
      </div>
    </div>
  );
}

/** Renders a full prescription inside a print overlay for printing. */
export function PrescriptionPrint({
  open,
  onClose,
  prescription,
  patient,
}: {
  open: boolean;
  onClose: () => void;
  prescription: Prescription | null;
  patient: Patient | undefined;
}) {
  return (
    <PrintOverlay open={open} title="Prescription" onClose={onClose}>
      {prescription ? <PrescriptionTable prescription={prescription} patient={patient} /> : null}
    </PrintOverlay>
  );
}
