import { inRange, type RangeKey } from "./selectors";
import { todayISO } from "./format";
import {
  SAFETY_CHECKS,
  type HmsState,
  type OtCheck,
  type ServiceRate,
  type Surgery,
  type SurgeryStatus,
} from "./types";

/** Badge tone a surgery status reads with. */
export type BadgeTone = "green" | "amber" | "red" | "neutral";

export function otTone(status: SurgeryStatus): BadgeTone {
  if (status === "Completed") return "green";
  if (status === "Cancelled") return "red";
  if (status === "In theatre") return "amber";
  return "neutral";
}

/* --------------------------------------------------------------- the list */

export function surgeryList(state: HmsState): Surgery[] {
  return Object.values(state.surgeries ?? {});
}

/** Theatre-list order: date, then planned start time, then booking order. */
export function sortTheatreList(rows: Surgery[]): Surgery[] {
  return [...rows].sort(
    (a, b) =>
      (a.date || "").localeCompare(b.date || "") ||
      (a.time || "").localeCompare(b.time || "") ||
      a.surgeryNo - b.surgeryNo ||
      a.createdAt - b.createdAt,
  );
}

/** Every case on one day, in start-time order (cancelled cases sink to the end). */
export function surgeriesOn(state: HmsState, date: string): Surgery[] {
  return sortTheatreList(surgeryList(state).filter((s) => s.date === date)).sort(
    (a, b) => Number(a.status === "Cancelled") - Number(b.status === "Cancelled"),
  );
}

/** Cases still to run from `ref` onward (today included), soonest first. */
export function upcomingSurgeries(state: HmsState, ref = todayISO()): Surgery[] {
  return sortTheatreList(
    surgeryList(state).filter((s) => s.status === "Scheduled" && (s.date || "") >= ref),
  );
}

/** Cases currently in theatre, wherever they are on the list. */
export function inTheatreNow(state: HmsState): Surgery[] {
  return sortTheatreList(surgeryList(state).filter((s) => s.status === "In theatre"));
}

export function surgeriesForPatient(state: HmsState, patientId: string): Surgery[] {
  return sortTheatreList(surgeryList(state).filter((s) => s.patientId === patientId)).reverse();
}

/** A surgeon's cases on one day — the "my list" view. */
export function surgeriesForSurgeon(
  state: HmsState,
  surgeon: string,
  date = todayISO(),
): Surgery[] {
  const name = (surgeon || "").trim().toLowerCase();
  if (!name) return [];
  return surgeriesOn(state, date).filter((s) => (s.surgeon || "").trim().toLowerCase() === name);
}

export function surgeriesInRange(state: HmsState, range: RangeKey): Surgery[] {
  return sortTheatreList(surgeryList(state).filter((s) => inRange(s.date, range)));
}

/**
 * Free-text theatre-list search. `nameFor` folds patient name / MRN into the
 * haystack, so "Ramesh" or "KEGH/26/0007" finds the case.
 */
export function searchSurgeries(
  rows: Surgery[],
  q: string,
  nameFor: (patientId: string) => string = () => "",
): Surgery[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  const digits = s.replace(/\D/g, "");
  return rows.filter(
    (x) =>
      x.procedure?.toLowerCase().includes(s) ||
      x.code?.toLowerCase().includes(s) ||
      x.room?.toLowerCase().includes(s) ||
      x.surgeon?.toLowerCase().includes(s) ||
      x.assistant?.toLowerCase().includes(s) ||
      x.anaesthetist?.toLowerCase().includes(s) ||
      x.anaesthesia?.toLowerCase().includes(s) ||
      x.diagnosis?.toLowerCase().includes(s) ||
      x.status?.toLowerCase().includes(s) ||
      nameFor(x.patientId).toLowerCase().includes(s) ||
      (digits.length > 0 && String(x.surgeryNo).includes(digits)),
  );
}

/** Next running OT number — one more than the highest on the list. */
export function nextSurgeryNo(state: HmsState): number {
  let max = 0;
  for (const s of surgeryList(state)) {
    if (Number(s.surgeryNo || 0) > max) max = Number(s.surgeryNo);
  }
  return max + 1;
}

/* ------------------------------------------------------------ day timing */

/** "09:30" → 570 minutes since midnight; invalid input reads as 0. */
export function minutesOf(hhmm: string): number {
  const parts = (hhmm || "").split(":");
  const h = parseInt(parts[0] ?? "", 10);
  const m = parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(h)) return 0;
  const mm = Number.isNaN(m) ? 0 : m;
  return Math.max(0, Math.min(24 * 60, h * 60 + mm));
}

/** Minutes past midnight for a clock time (defaults to now). */
export function nowMinutes(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** 570 → "09:30". Minutes past midnight wrap into the day. */
export function hhmmOf(minutes: number): string {
  const total = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Planned finish time of a case, e.g. "11:15". */
export function endsAt(surgery: Pick<Surgery, "time" | "durationMinutes">): string {
  return hhmmOf(minutesOf(surgery.time) + Math.max(0, Number(surgery.durationMinutes || 0)));
}

/** Total planned theatre minutes across the given cases (cancelled excluded). */
export function plannedMinutes(rows: Surgery[]): number {
  return rows
    .filter((s) => s.status !== "Cancelled")
    .reduce((sum, s) => sum + Math.max(0, Number(s.durationMinutes || 0)), 0);
}

export interface TimelineBounds {
  /** First hour shown, minutes past midnight. */
  start: number;
  /** Last hour shown, minutes past midnight. */
  end: number;
  /** Hour marks to label along the track. */
  ticks: number[];
}

/**
 * The window a day's list is drawn against: half an hour before the first cut
 * to half an hour after the last finish, rounded to the hour and clamped to
 * the day. An empty list falls back to a plain 08:00–18:00 theatre day.
 */
export function timelineBounds(rows: Surgery[]): TimelineBounds {
  const live = rows.filter((s) => s.status !== "Cancelled");
  let start = 8 * 60;
  let end = 18 * 60;
  if (live.length > 0) {
    start = Math.min(...live.map((s) => minutesOf(s.time)));
    end = Math.max(
      ...live.map((s) => minutesOf(s.time) + Math.max(0, Number(s.durationMinutes || 0))),
    );
    start = Math.max(0, Math.floor((start - 30) / 60) * 60);
    end = Math.min(24 * 60, Math.ceil((end + 30) / 60) * 60);
    if (end - start < 3 * 60) end = Math.min(24 * 60, start + 3 * 60);
  }
  const ticks: number[] = [];
  for (let t = start; t <= end; t += 60) ticks.push(t);
  return { start, end, ticks };
}

/** Where a moment sits inside the window, 0–100 %. */
export function timelinePct(minute: number, bounds: TimelineBounds): number {
  const span = Math.max(60, bounds.end - bounds.start);
  return Math.max(0, Math.min(100, ((minute - bounds.start) / span) * 100));
}

/* ------------------------------------------------------------- paperwork */

/** A fresh checklist with every line unchecked. */
export function defaultChecks(): OtCheck[] {
  return SAFETY_CHECKS.map((name) => ({ name, ready: false }));
}

/** Bring a stored checklist back to the current list, keeping ticks. */
export function normalizeChecks(checks: OtCheck[] | undefined): OtCheck[] {
  const byName = new Map(
    (checks ?? []).map((c) => [(c.name || "").trim().toLowerCase(), !!c.ready]),
  );
  return SAFETY_CHECKS.map((name) => ({
    name,
    ready: byName.get(name.trim().toLowerCase()) ?? false,
  }));
}

/** Ticked lines on a case's checklist (stored lists are re-based on the current set). */
export function checksReady(surgery: Pick<Surgery, "checks">): number {
  return normalizeChecks(surgery.checks).filter((c) => c.ready).length;
}

/** Checklist lines still to do before the patient can go in. */
export function missingChecks(surgery: Pick<Surgery, "checks">): string[] {
  return normalizeChecks(surgery.checks)
    .filter((c) => !c.ready)
    .map((c) => c.name);
}

/** A case is "ready for theatre" when every safety line is ticked. */
export function isReady(surgery: Pick<Surgery, "checks">): boolean {
  const checks = normalizeChecks(surgery.checks);
  return checks.length > 0 && checks.every((c) => c.ready);
}

/* -------------------------------------------------------------- pricing */

/** OT price-list rows (procedures), alphabetically — what the rate master holds. */
export function otProcedureList(state: HmsState): ServiceRate[] {
  return Object.values(state.serviceRates ?? {})
    .filter((r) => r.section === "OT")
    .sort(
      (a, b) =>
        Number(b.active !== false) - Number(a.active !== false) ||
        (a.item || "").localeCompare(b.item || ""),
    );
}

/** Procedures with no active OT rate yet — billing refuses until they are priced. */
export function missingOtRates(state: HmsState, procedures: string[]): string[] {
  const priced = new Map(
    otProcedureList(state)
      .filter((r) => r.active !== false && Number(r.rate || 0) > 0)
      .map((r) => [(r.item || "").trim().toLowerCase(), Number(r.rate)]),
  );
  return procedures.filter((p) => !priced.get((p || "").trim().toLowerCase()));
}

/* ---------------------------------------------------------- starter list */

/**
 * Common Indian-hospital procedures, used as the OT price list's starter rows
 * and as quick picks on the booking form. Rates are deliberately left at ₹0 —
 * a hospital's own pricing is the only truth here; the desk fills them in
 * under Settings → Price list, and the OT page lists whatever is still
 * unpriced before any charge can be posted.
 */
export const COMMON_PROCEDURES: readonly string[] = [
  "Laparoscopic appendectomy",
  "Open appendectomy",
  "Laparoscopic cholecystectomy",
  "Open cholecystectomy",
  "Laparoscopic hernia repair",
  "Inguinal hernia repair",
  "Umbilical hernia repair",
  "Haemorrhoidectomy",
  "Fissurectomy",
  "Fistulectomy",
  "Exploratory laparotomy",
  "Hysterectomy (abdominal)",
  "Hysterectomy (vaginal)",
  "Caesarean section",
  "Normal delivery (OT)",
  "Dilatation and curettage",
  "Diagnostic laparoscopy",
  "Ovarian cystectomy",
  "Ectopic pregnancy surgery",
  "Myomectomy",
  "Circumcision",
  "Hydrocele repair",
  "Varicocelectomy",
  "Transurethral resection of prostate (TURP)",
  "Ureteric stone removal",
  "PCNL",
  "ESWL",
  "Cystoscopy",
  "Suprapubic cystostomy",
  "Percutaneous nephrostomy",
  "Open reduction and internal fixation (ORIF)",
  "Fracture reduction — closed",
  "External fixator application",
  "K-wire fixation",
  "Amputation",
  "Debridement and dressing under anaesthesia",
  "Sequestrectomy",
  "Bone graft",
  "Tendon repair",
  "Arthroscopy",
  "Craniotomy",
  "Burr hole / evacuation of haematoma",
  "VP shunt",
  "Laminectomy / discectomy",
  "Thyroidectomy",
  "Excision of breast lump",
  "Modified radical mastectomy",
  "Mastectomy",
  "Excision of lipoma / sebaceous cyst",
  "Incision and drainage of abscess",
  "Nephrectomy",
  "Pyeloplasty",
  "Tonsillectomy",
  "Septoplasty",
  "Mastoidectomy",
  "Cataract surgery (SICS / phaco)",
  "Pterygium excision",
  "Dacryocystorhinostomy (DCR)",
  "Corneal foreign body removal",
  "Squint correction",
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Seed the OT section of the price list with the procedure starter names.
 * Deterministic `seed-ot-<slug>` ids and a version flag keep this idempotent
 * across devices; rates stay ₹0 (and the OT page lists what is unpriced) so a
 * hospital never bills from a seeded number. Bump OT_SEED_VERSION when the
 * list changes.
 */
export const OT_SEED_VERSION = "1";
const SEED_FLAG = "kegh-hms-ot-seed-version";

export function seedOtProcedures(state: HmsState): HmsState {
  // No localStorage (tests / SSR): always evaluate the merge.
  let ls: Storage | null = null;
  try {
    ls = typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    ls = null;
  }
  if (ls?.getItem(SEED_FLAG) === OT_SEED_VERSION) return state;

  const serviceRates: Record<string, ServiceRate> = { ...state.serviceRates };
  const existingNames = new Set(
    Object.values(serviceRates)
      .filter((r) => r.section === "OT")
      .map((r) => (r.item || "").trim().toLowerCase()),
  );
  let changed = false;
  for (const item of COMMON_PROCEDURES) {
    const id = `seed-ot-${slug(item)}`;
    if (serviceRates[id]) continue;
    if (existingNames.has(item.trim().toLowerCase())) continue;
    serviceRates[id] = { id, section: "OT", item, rate: 0, active: true, createdAt: 0 };
    existingNames.add(item.trim().toLowerCase());
    changed = true;
  }
  ls?.setItem(SEED_FLAG, OT_SEED_VERSION);
  return changed ? { ...state, serviceRates } : state;
}

/* -------------------------------------------------------------- counting */

export interface SurgeryStats {
  total: number;
  scheduled: number;
  inTheatre: number;
  completed: number;
  cancelled: number;
  emergency: number;
  /** Σ planned theatre minutes of everything not cancelled. */
  plannedMinutes: number;
  /** Share of rows that were completed, 0–100 %. */
  completionRate: number;
  /** Share of rows that were cancelled after booking, 0–100 %. */
  cancellationRate: number;
}

export function surgeryStats(rows: Surgery[]): SurgeryStats {
  const count = (s: SurgeryStatus) => rows.filter((x) => x.status === s).length;
  const total = rows.length;
  const completed = count("Completed");
  const cancelled = count("Cancelled");
  return {
    total,
    scheduled: count("Scheduled"),
    inTheatre: count("In theatre"),
    completed,
    cancelled,
    emergency: rows.filter((x) => x.priority === "Emergency" && x.status !== "Cancelled").length,
    plannedMinutes: plannedMinutes(rows),
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    cancellationRate: total ? Math.round((cancelled / total) * 100) : 0,
  };
}

export interface OtDayStats extends SurgeryStats {
  /** Cases on the given day, cancelled ones included in `total` only. */
  date: string;
  /** The next case that has not gone in yet. */
  next: Surgery | null;
  /** Surgery whose planned window covers `nowMinute`, if any. */
  running: Surgery | null;
  /** Cases today still to go in (or in theatre) with a safety line unticked. */
  notReady: number;
}

/** Everything the theatre desk needs to read one day at a glance. */
export function otDayStats(state: HmsState, date = todayISO(), nowMinute?: number): OtDayStats {
  const rows = surgeriesOn(state, date);
  const stats = surgeryStats(rows);
  const live = rows.filter((s) => s.status !== "Cancelled");
  const next = live.find((s) => s.status === "Scheduled") ?? null;
  const minute = nowMinute ?? (date === todayISO() ? nowMinutes() : -1);
  const running =
    live.find((s) => {
      if (s.status !== "In theatre" && s.status !== "Scheduled") return false;
      const start = minutesOf(s.time);
      return minute >= start && minute < start + Math.max(0, Number(s.durationMinutes || 0));
    }) ?? null;
  return {
    ...stats,
    date,
    next,
    running,
    notReady: rows.filter(
      (s) => (s.status === "Scheduled" || s.status === "In theatre") && !isReady(s),
    ).length,
  };
}
