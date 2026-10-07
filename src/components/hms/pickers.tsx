import { useEffect, useMemo, useRef, useState } from "react";
import { useHms } from "@/lib/hms/store";
import { searchPatients } from "@/lib/hms/selectors";
import { useCurrentPatient } from "@/lib/hms/patient-context";
import { Input, Select } from "./ui";

export function PatientPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { state } = useHms();
  const { patientId: current, setPatientId } = useCurrentPatient();
  const [q, setQ] = useState("");

  /* "Patient everywhere": an empty picker starts on the device's current
     patient (once), and whatever the user picks here becomes the current
     patient for the next screen. */
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefilled.current && !value && current && state.patients[current]) {
      prefilled.current = true;
      onChange(current);
    }
  }, [value, current, state.patients, onChange]);

  const handleChange = (id: string) => {
    setPatientId(id);
    onChange(id);
  };

  const list = useMemo(
    () => searchPatients(Object.values(state.patients), q).slice(0, 50),
    [state.patients, q],
  );
  return (
    <div className="space-y-2">
      <Input
        placeholder="Search name / MRN / phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Select value={value} onChange={(e) => handleChange(e.target.value)}>
        <option value="">Select patient…</option>
        {value && !list.some((p) => p.id === value) && state.patients[value] ? (
          <option value={value}>
            {state.patients[value].name} · {state.patients[value].mrn}
          </option>
        ) : null}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.mrn}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function VisitPicker({
  patientId,
  value,
  onChange,
}: {
  patientId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { state } = useHms();
  const visits = Object.values(state.visits).filter((v) => v.patientId === patientId);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No linked visit</option>
      {visits.map((v) => (
        <option key={v.id} value={v.id}>
          {v.date} · {v.type} {v.doctor ? `· ${v.doctor}` : ""}
        </option>
      ))}
    </Select>
  );
}

export function confirmDelete(what = "this record") {
  return window.confirm(`Delete ${what}? This cannot be undone.`);
}
