import type {
  Admission,
  Bed,
  HmsState,
  NursingNote,
  NursingShift,
  Patient,
  VitalSeverity,
  Vitals,
} from "./types";
import { todayISO } from "./format";

/** The observations the ward charts — the columns of a TPR sheet. */
export type VitalKey =
  "temperature" | "pulse" | "respRate" | "bpSystolic" | "bpDiastolic" | "spo2" | "painScore";

export interface VitalRange {
  key: VitalKey;
  /** Short column heading for the chart and the flow sheet. */
  label: string;
  unit: string;
  /** Inclusive normal band. */
  low: number;
  high: number;
  /** Outside this wider band the reading is escalated to critical. */
  critLow: number;
  critHigh: number;
  /** Decimal places used when the value is displayed. */
  decimals: number;
  /** True when a 0 means "not taken this round" rather than a real zero. */
  zeroMeansMissing: boolean;
}

/**
 * Adult reference bands used to flag a reading. Deliberately simple and
 * hospital-editable by changing these numbers — a ward charting a child or an
 * ICU patient reads the printed value, this only drives colour and sorting.
 */
export const VITAL_RANGES: VitalRange[] = [
  {
    key: "temperature",
    label: "Temp",
    unit: "°F",
    low: 97,
    high: 99,
    critLow: 95,
    critHigh: 103,
    decimals: 1,
    zeroMeansMissing: true,
  },
  {
    key: "pulse",
    label: "Pulse",
    unit: "/min",
    low: 60,
    high: 100,
    critLow: 45,
    critHigh: 130,
    decimals: 0,
    zeroMeansMissing: true,
  },
  {
    key: "respRate",
    label: "Resp",
    unit: "/min",
    low: 12,
    high: 20,
    critLow: 8,
    critHigh: 30,
    decimals: 0,
    zeroMeansMissing: true,
  },
  {
    key: "bpSystolic",
    label: "BP sys",
    unit: "mmHg",
    low: 90,
    high: 139,
    critLow: 80,
    critHigh: 180,
    decimals: 0,
    zeroMeansMissing: true,
  },
  {
    key: "bpDiastolic",
    label: "BP dia",
    unit: "mmHg",
    low: 60,
    high: 89,
    critLow: 50,
    critHigh: 120,
    decimals: 0,
    zeroMeansMissing: true,
  },
  {
    key: "spo2",
    label: "SpO₂",
    unit: "%",
    low: 95,
    high: 100,
    critLow: 90,
    critHigh: 101,
    decimals: 0,
    zeroMeansMissing: true,
  },
  {
    key: "painScore",
    label: "Pain",
    unit: "/10",
    low: 0,
    high: 3,
    critLow: -1,
    critHigh: 7,
    decimals: 0,
    zeroMeansMissing: false,
  },
];

const RANGE_BY_KEY = new Map<VitalKey, VitalRange>(VITAL_RANGES.map((r) => [r.key, r]));

/** The reference band for one observation, if it is charted. */
export function vitalRange(key: VitalKey): VitalRange | undefined {
  return RANGE_BY_KEY.get(key);
}

/**
 * Validate a chart entry before persisting it. Keep this independent of the
 * browser form so CSV / sync callers can use the same unit expectations.
 * A zero in a required vital means it was not taken; pain can really be zero.
 */
export function validateVitals(v: Partial<Vitals>): string | null {
  const readings: { key: keyof Vitals; label: string; min: number; max: number }[] = [
    { key: "temperature", label: "Temperature", min: 85, max: 115 },
    { key: "pulse", label: "Pulse", min: 20, max: 250 },
    { key: "respRate", label: "Respiration", min: 4, max: 80 },
    { key: "bpSystolic", label: "BP systolic", min: 40, max: 300 },
    { key: "bpDiastolic", label: "BP diastolic", min: 20, max: 200 },
    { key: "spo2", label: "SpO₂", min: 40, max: 100 },
    { key: "painScore", label: "Pain score", min: 0, max: 10 },
    { key: "weightKg", label: "Weight", min: 1, max: 500 },
    { key: "intakeMl", label: "Intake", min: 0, max: 100000 },
    { key: "outputMl", label: "Output", min: 0, max: 100000 },
  ];
  for (const { key, label, min, max } of readings) {
    const raw = v[key];
    // Blank fields on the chart are omitted (0 is a genuine pain / I/O value).
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${label} must be a number`;
    if (n === 0 && key !== "painScore" && key !== "intakeMl" && key !== "outputMl") {
      continue;
    }
    if (n < min || n > max) return `${label} must be between ${min} and ${max}`;
  }
  const sys = Number(v.bpSystolic || 0);
  const dia = Number(v.bpDiastolic || 0);
  if (sys > 0 !== dia > 0) return "Enter both BP values or leave both blank";
  if (sys > 0 && sys <= dia) return "BP systolic must be higher than diastolic";
  if (![v.temperature, v.pulse, v.respRate, v.bpSystolic, v.spo2].some((x) => Number(x || 0) > 0)) {
    return "Record at least a temperature, pulse, respiration, BP or SpO₂";
  }
  return null;
}

/** Severity of a single reading. Missing values never raise a flag. */
export function vitalSeverity(key: VitalKey, value: number | undefined): VitalSeverity {
  const r = RANGE_BY_KEY.get(key);
  if (!r) return "normal";
  const v = Number(value);
  if (value === undefined || value === null || !Number.isFinite(v)) return "normal";
  if (r.zeroMeansMissing && v === 0) return "normal";
  if (v < r.critLow || v > r.critHigh) return "critical";
  if (v < r.low || v > r.high) return "abnormal";
  return "normal";
}

/** A reading formatted with its unit, e.g. `98.6°F`. Blank when not taken. */
export function formatVital(key: VitalKey, value: number | undefined): string {
  const r = RANGE_BY_KEY.get(key);
  const v = Number(value);
  if (!r || value === undefined || value === null || !Number.isFinite(v)) return "—";
  if (r.zeroMeansMissing && v === 0) return "—";
  return `${v.toFixed(r.decimals)}${r.unit}`;
}

export interface VitalFlag {
  key: VitalKey;
  label: string;
  value: string;
  severity: Exclude<VitalSeverity, "normal">;
}

/** Every reading on a set that sits outside its band, worst first. */
export function vitalFlags(v: Vitals): VitalFlag[] {
  const out: VitalFlag[] = [];
  for (const r of VITAL_RANGES) {
    const severity = vitalSeverity(r.key, v[r.key]);
    if (severity === "normal") continue;
    out.push({
      key: r.key,
      label: r.label,
      value: formatVital(r.key, v[r.key]),
      severity,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

const SEVERITY_RANK: Record<VitalSeverity, number> = {
  critical: 0,
  abnormal: 1,
  normal: 2,
};

/** Worst severity across a whole set — drives the row colour and sorting. */
export function vitalsSeverity(v: Vitals): VitalSeverity {
  let worst: VitalSeverity = "normal";
  for (const r of VITAL_RANGES) {
    const s = vitalSeverity(r.key, v[r.key]);
    if (SEVERITY_RANK[s] < SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

/** One-line chart summary: `98.6°F · 80 · 120/80 · 98%`. */
export function vitalsSummary(v: Vitals): string {
  const parts: string[] = [];
  const temp = formatVital("temperature", v.temperature);
  if (temp !== "—") parts.push(temp);
  const pulse = formatVital("pulse", v.pulse);
  if (pulse !== "—") parts.push(pulse);
  const sys = Number(v.bpSystolic);
  const dia = Number(v.bpDiastolic);
  if (sys > 0 && dia > 0) parts.push(`${sys}/${dia}`);
  const spo2 = formatVital("spo2", v.spo2);
  if (spo2 !== "—") parts.push(spo2);
  return parts.join(" · ") || "—";
}

/* ----------------------------------------------------------- shift stamps */

/**
 * Ward shift for a clock time: Morning 07:00–13:59, Evening 14:00–21:59,
 * Night 22:00–06:59. Anything unparseable defaults to Morning.
 */
export function shiftForTime(time: string): NursingShift {
  const m = /^(\d{1,2}):(\d{2})/.exec((time || "").trim());
  if (!m) return "Morning";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return "Morning";
  if (hh >= 7 && hh < 14) return "Morning";
  if (hh >= 14 && hh < 22) return "Evening";
  return "Night";
}

/* ------------------------------------------------------------ vitals list */

export function vitalsList(state: HmsState): Vitals[] {
  return Object.values(state.vitals ?? {});
}

/** Chart order: newest first, and within a day the latest reading first. */
export function sortVitals(rows: Vitals[]): Vitals[] {
  return [...rows].sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") ||
      (b.time || "").localeCompare(a.time || "") ||
      b.createdAt - a.createdAt,
  );
}

export function vitalsForPatient(state: HmsState, patientId: string): Vitals[] {
  return sortVitals(vitalsList(state).filter((v) => v.patientId === patientId));
}

export function vitalsForAdmission(state: HmsState, admissionId: string): Vitals[] {
  if (!admissionId) return [];
  return sortVitals(vitalsList(state).filter((v) => v.admissionId === admissionId));
}

/** The most recent set for a patient, or undefined when never charted. */
export function latestVitals(state: HmsState, patientId: string): Vitals | undefined {
  return vitalsForPatient(state, patientId)[0];
}

export interface VitalsFilter {
  patientId?: string | undefined;
  admissionId?: string | undefined;
  /** Inclusive YYYY-MM-DD lower bound. */
  from?: string | undefined;
  /** Inclusive YYYY-MM-DD upper bound. */
  to?: string | undefined;
  shift?: NursingShift | "" | undefined;
  /** Keep only sets that raised a flag. */
  abnormalOnly?: boolean;
}

export function filterVitals(rows: Vitals[], f: VitalsFilter = {}): Vitals[] {
  return rows.filter((v) => {
    if (f.patientId && v.patientId !== f.patientId) return false;
    if (f.admissionId && v.admissionId !== f.admissionId) return false;
    if (f.from && (v.date || "") < f.from) return false;
    if (f.to && (v.date || "") > f.to) return false;
    if (f.shift && v.shift !== f.shift) return false;
    if (f.abnormalOnly && vitalsSeverity(v) === "normal") return false;
    return true;
  });
}

/** Readings taken on a given day (default: today). */
export function vitalsOn(state: HmsState, date = todayISO()): Vitals[] {
  return sortVitals(vitalsList(state).filter((v) => (v.date || "") === date));
}

/* -------------------------------------------------------------- ward round */

export interface WardRoundRow {
  admission: Admission;
  patient: Patient | undefined;
  bed: Bed | undefined;
  /** Latest set ever charted for this patient. */
  last: Vitals | undefined;
  /** Latest set charted on `date`. */
  today: Vitals | undefined;
  severity: VitalSeverity;
}

/**
 * One row per patient currently in a bed: who still needs a round first, then
 * the sickest (critical → abnormal → normal), then by bed label.
 */
export function wardRounds(state: HmsState, date = todayISO()): WardRoundRow[] {
  const admitted = Object.values(state.admissions ?? {}).filter((a) => a.status === "Admitted");
  const rows: WardRoundRow[] = admitted.map((admission) => {
    // Do not let an earlier admission or a same-day OPD reading mark this
    // stay as charted. Every ward set is linked to the stay it was taken in.
    const forPatient = vitalsForAdmission(state, admission.id);
    const today = forPatient.find((v) => (v.date || "") === date);
    const last = forPatient[0];
    return {
      admission,
      patient: state.patients[admission.patientId],
      bed: state.beds[admission.bedId],
      last,
      today,
      severity: last ? vitalsSeverity(last) : "normal",
    };
  });
  return rows.sort((a, b) => {
    const due = (a.today ? 1 : 0) - (b.today ? 1 : 0);
    if (due !== 0) return due;
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return (a.bed?.label || "").localeCompare(b.bed?.label || "", undefined, { numeric: true });
  });
}

/** Admitted patients with nothing charted yet today. */
export function roundsDue(state: HmsState, date = todayISO()): WardRoundRow[] {
  return wardRounds(state, date).filter((r) => !r.today);
}

export interface NursingStats {
  admitted: number;
  /** Distinct patients with at least one set charted on `date`. */
  chartedToday: number;
  /** Sets recorded on `date`. */
  readingsToday: number;
  /** Admitted patients with nothing charted on `date`. */
  dueToday: number;
  /** Distinct patients with an out-of-band reading on `date`. */
  abnormalToday: number;
  criticalToday: number;
  notesToday: number;
}

/** Headline counts for the nursing workspace and the page subtitle. */
export function nursingStats(state: HmsState, date = todayISO()): NursingStats {
  const round = wardRounds(state, date);
  const day = vitalsOn(state, date);
  const flagged = day.filter((v) => vitalsSeverity(v) !== "normal");
  return {
    admitted: round.length,
    chartedToday: new Set(day.map((v) => v.patientId)).size,
    readingsToday: day.length,
    dueToday: round.filter((r) => !r.today).length,
    abnormalToday: new Set(flagged.map((v) => v.patientId)).size,
    criticalToday: new Set(
      flagged.filter((v) => vitalsSeverity(v) === "critical").map((v) => v.patientId),
    ).size,
    notesToday: noteList(state).filter((n) => (n.date || "") === date).length,
  };
}

/* ----------------------------------------------------------- nursing notes */

export function noteList(state: HmsState): NursingNote[] {
  return Object.values(state.nursingNotes ?? {});
}

/** Newest first — the chart reads top-down. */
export function sortNotes(rows: NursingNote[]): NursingNote[] {
  return [...rows].sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") ||
      (b.time || "").localeCompare(a.time || "") ||
      b.createdAt - a.createdAt,
  );
}

export function notesForPatient(state: HmsState, patientId: string): NursingNote[] {
  return sortNotes(noteList(state).filter((n) => n.patientId === patientId));
}

export function notesForAdmission(state: HmsState, admissionId: string): NursingNote[] {
  if (!admissionId) return [];
  return sortNotes(noteList(state).filter((n) => n.admissionId === admissionId));
}

export function searchNotes(rows: NursingNote[], q: string): NursingNote[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (n) =>
      n.text?.toLowerCase().includes(s) ||
      n.author?.toLowerCase().includes(s) ||
      n.category?.toLowerCase().includes(s) ||
      n.shift?.toLowerCase().includes(s),
  );
}
