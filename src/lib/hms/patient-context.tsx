import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * The "current patient" for this device. Picked once — on a patient file or
 * any patient picker — every empty PatientPicker across the app then starts
 * on that patient, so the doctor isn't re-selecting the same person on the
 * prescription, lab order, imaging order and bill. Device-local by design
 * (each workstation can follow its own patient).
 */

const KEY = "kegh-hms-current-patient";

interface CurrentPatientCtx {
  patientId: string;
  setPatientId: (id: string) => void;
}

const Ctx = createContext<CurrentPatientCtx | null>(null);

function readStored(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function CurrentPatientProvider({ children }: { children: React.ReactNode }) {
  const [patientId, setPatientIdState] = useState<string>(readStored);

  const setPatientId = useCallback((id: string) => {
    setPatientIdState(id);
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo(() => ({ patientId, setPatientId }), [patientId, setPatientId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentPatient(): CurrentPatientCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrentPatient must be used inside CurrentPatientProvider");
  return ctx;
}
