import { INDIAN_PAYERS } from "./indian-payers";
import { inRange, type RangeKey } from "./selectors";
import { todayISO } from "./format";
import {
  CLAIM_DOCUMENTS,
  OPEN_CLAIM_STATUSES,
  type Bill,
  type Claim,
  type ClaimDoc,
  type ClaimStatus,
  type HmsState,
  type Payer,
} from "./types";

/* ------------------------------------------------------------------ payers */

/** Every payer on file: active first, then alphabetically by name. */
export function payerList(state: HmsState): Payer[] {
  return Object.values(state.payers ?? {}).sort(
    (a, b) =>
      Number(b.active !== false) - Number(a.active !== false) ||
      (a.name || "").localeCompare(b.name || ""),
  );
}

/** Active payers only — what the claim form offers. */
export function activePayers(state: HmsState): Payer[] {
  return payerList(state).filter((p) => p.active !== false);
}

export function payerById(state: HmsState, id: string): Payer | undefined {
  return state.payers?.[id];
}

export function searchPayers(rows: Payer[], q: string): Payer[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (p) =>
      p.name?.toLowerCase().includes(s) ||
      p.code?.toLowerCase().includes(s) ||
      p.type?.toLowerCase().includes(s) ||
      p.contact?.toLowerCase().includes(s),
  );
}

/**
 * How many claims reference a payer — the master asks before deleting one
 * that history depends on (deactivate it instead, per the usual pattern).
 */
export function claimsForPayer(state: HmsState, payerId: string): Claim[] {
  return claimList(state).filter((c) => c.payerId === payerId);
}

/* ------------------------------------------------------------- payer seed */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Seed the payer master with the built-in Indian scheme / insurer list.
 * Deterministic `seed-payer-<code>` ids keep this idempotent across devices,
 * and a name the hospital already typed in by hand is never duplicated — the
 * seed only adds what is genuinely missing. Runs once per version per device
 * (bump PAYER_SEED_VERSION when the built-in list changes).
 */
export const PAYER_SEED_VERSION = "1";
const SEED_FLAG = "kegh-hms-payer-seed-version";

export function seedPayers(state: HmsState): HmsState {
  // No localStorage (tests / SSR): always evaluate the merge.
  let ls: Storage | null = null;
  try {
    ls = typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    ls = null;
  }
  if (ls?.getItem(SEED_FLAG) === PAYER_SEED_VERSION) return state;

  const payers: Record<string, Payer> = { ...state.payers };
  const existingNames = new Set(
    Object.values(payers).map((p) => (p.name || "").trim().toLowerCase()),
  );
  let changed = false;
  for (const p of INDIAN_PAYERS) {
    const id = `seed-payer-${slug(p.code)}`;
    if (payers[id]) continue;
    if (existingNames.has(p.name.trim().toLowerCase())) continue;
    payers[id] = {
      id,
      name: p.name,
      type: p.type,
      code: p.code,
      contact: "",
      settlementDays: p.settlementDays,
      active: true,
      notes: "",
      createdAt: 0,
    };
    existingNames.add(p.name.trim().toLowerCase());
    changed = true;
  }
  ls?.setItem(SEED_FLAG, PAYER_SEED_VERSION);
  return changed ? { ...state, payers } : state;
}

/* ------------------------------------------------------------------ claims */

export function claimList(state: HmsState): Claim[] {
  return sortClaims(Object.values(state.claims ?? {}));
}

/**
 * Register order: claims still being worked come first (oldest first, so the
 * file the desk has been chasing longest tops the list), then closed claims
 * newest first.
 */
export function sortClaims(rows: Claim[]): Claim[] {
  const openRank = (c: Claim) => (OPEN_CLAIM_STATUSES.includes(c.status) ? 0 : 1);
  return [...rows].sort((a, b) => {
    const o = openRank(a) - openRank(b);
    if (o !== 0) return o;
    if (openRank(a) === 0) {
      return (a.date || "").localeCompare(b.date || "") || a.claimNo - b.claimNo;
    }
    return (b.date || "").localeCompare(a.date || "") || b.claimNo - a.claimNo;
  });
}

export function openClaims(state: HmsState): Claim[] {
  return claimList(state).filter((c) => OPEN_CLAIM_STATUSES.includes(c.status));
}

export function claimsForPatient(state: HmsState, patientId: string): Claim[] {
  return sortClaims(Object.values(state.claims ?? {}).filter((c) => c.patientId === patientId));
}

/** Claims raised against one bill — a bill normally has exactly one. */
export function claimsForBill(state: HmsState, billId: string): Claim[] {
  return claimList(state).filter((c) => c.billId === billId);
}

export function claimsInRange(state: HmsState, range: RangeKey): Claim[] {
  return claimList(state).filter((c) => inRange(c.date, range));
}

/**
 * Free-text claim search. `nameFor` lets the caller fold patient name / MRN
 * into the haystack, so "Ramesh" or "KEGH/26/0007" finds the right file.
 */
export function searchClaims(
  rows: Claim[],
  q: string,
  nameFor: (patientId: string) => string = () => "",
): Claim[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  // "CLM-7" should find claim 7 — compare on the digits.
  const digits = s.replace(/\D/g, "");
  return rows.filter(
    (c) =>
      c.payerName?.toLowerCase().includes(s) ||
      c.scheme?.toLowerCase().includes(s) ||
      c.policyNo?.toLowerCase().includes(s) ||
      c.reference?.toLowerCase().includes(s) ||
      c.treatment?.toLowerCase().includes(s) ||
      c.status?.toLowerCase().includes(s) ||
      c.preparedBy?.toLowerCase().includes(s) ||
      nameFor(c.patientId).toLowerCase().includes(s) ||
      (digits.length > 0 && String(c.claimNo).includes(digits)),
  );
}

/** Next running claim number — one more than the highest in the file. */
export function nextClaimNo(state: HmsState): number {
  let max = 0;
  for (const c of Object.values(state.claims ?? {})) {
    if (Number(c.claimNo || 0) > max) max = Number(c.claimNo);
  }
  return max + 1;
}

/** Badge tone a status reads with: settled green, money in flight amber, dead red. */
export type BadgeTone = "green" | "amber" | "red" | "neutral";

export function claimTone(s: ClaimStatus): BadgeTone {
  if (s === "Settled") return "green";
  if (s === "Partially settled") return "amber";
  if (s === "Rejected" || s === "Pre-auth rejected") return "red";
  if (s === "Claim submitted" || s === "Query raised" || s === "Approved") return "amber";
  return "neutral";
}

/* --------------------------------------------------------------- workflow */

/** The single next action the desk takes on a claim, or null when it is closed. */
export type ClaimStep =
  { kind: "status"; to: ClaimStatus; label: string } | { kind: "settle"; label: string } | null;

export function nextClaimStep(status: ClaimStatus): ClaimStep {
  switch (status) {
    case "Preparing":
      return { kind: "status", to: "Pre-auth sent", label: "Send pre-auth" };
    case "Pre-auth sent":
      return { kind: "status", to: "Pre-auth approved", label: "Pre-auth approved" };
    case "Pre-auth rejected":
      return { kind: "status", to: "Pre-auth sent", label: "Send pre-auth again" };
    case "Pre-auth approved":
      return { kind: "status", to: "Claim submitted", label: "Submit claim" };
    case "Query raised":
      return { kind: "status", to: "Claim submitted", label: "Resubmit" };
    case "Claim submitted":
      return { kind: "status", to: "Approved", label: "Mark approved" };
    case "Approved":
      return { kind: "settle", label: "Record settlement" };
    default:
      return null;
  }
}

export function isOpenClaim(claim: Claim): boolean {
  return OPEN_CLAIM_STATUSES.includes(claim.status);
}

/** When the claim was submitted to the payer (ms epoch), 0 when it never was. */
export function submittedAt(claim: Claim): number {
  const stamps = (claim.events ?? [])
    .filter((e) => e.status === "Claim submitted")
    .map((e) => Number(e.at) || 0);
  return stamps.length ? Math.max(...stamps) : 0;
}

/**
 * Days the file has been with the payer: from submission when it was
 * submitted, else from the day it was opened. Closed claims age to their
 * settlement event, so the register can show "settled in 31 days".
 */
export function claimAgeDays(claim: Claim, now = Date.now()): number {
  const from =
    submittedAt(claim) || new Date(`${(claim.date || "").slice(0, 10)}T00:00:00`).getTime();
  if (!from || Number.isNaN(from)) return 0;
  const closed = !isOpenClaim(claim);
  const end = closed ? Math.max(...(claim.events ?? []).map((e) => Number(e.at) || 0), from) : now;
  return Math.max(0, Math.floor((end - from) / 86_400_000));
}

/** Date the payer should have settled by: submitted + its usual window. */
export function claimDueDate(claim: Claim, payer?: Payer): string {
  const days = Number(payer?.settlementDays || 0);
  const from = submittedAt(claim) || 0;
  if (!from || days <= 0) return "";
  const d = new Date(from + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** An open, submitted claim past the payer's usual settlement window. */
export function isOverdue(claim: Claim, payer: Payer | undefined, now = Date.now()): boolean {
  if (!isOpenClaim(claim) || claim.status === "Preparing" || claim.status === "Pre-auth sent") {
    return false;
  }
  const due = claimDueDate(claim, payer);
  if (!due) return false;
  return todayISO() > due && claimAgeDays(claim, now) > 0;
}

/**
 * Money still expected on a claim. Rejected files and settlements owe nothing
 * (a deduction on a settled claim went to the patient's share, not to a debt);
 * otherwise the payer is expected to pay what it approved — or the full claim
 * while no approval is on file — less whatever has already come in.
 */
export function claimPending(claim: Claim): number {
  if (
    claim.status === "Rejected" ||
    claim.status === "Pre-auth rejected" ||
    claim.status === "Settled"
  ) {
    return 0;
  }
  const target =
    Number(claim.approvedAmount || 0) > 0
      ? Number(claim.approvedAmount)
      : Number(claim.claimedAmount || 0);
  return Math.max(0, target - Number(claim.settledAmount || 0));
}

/* ------------------------------------------------------------------ money */

/** What a settlement of this size means for the claim's status. */
export function settledStatus(settledAmount: number, approvedAmount: number): ClaimStatus {
  const approved = Number(approvedAmount || 0);
  const settled = Number(settledAmount || 0);
  // With no approval on file, a full payout of what was claimed is a settlement.
  const target = approved > 0 ? approved : settled;
  return settled >= target ? "Settled" : "Partially settled";
}

/**
 * Extra money to post to the bill when a settlement is saved: the difference
 * between what is being settled now and what was posted before, so re-saving
 * a corrected settlement never pays the bill twice.
 */
export function settlementDelta(claim: Claim, settledAmount: number): number {
  return Number(settledAmount || 0) - Number(claim.settlementPosted || 0);
}

/**
 * Apply a payer payment (insurance / scheme money) to a bill: it increases
 * `paid` — never the total — and clamps at the bill value, because a payer
 * settling more than the hospital billed must not show as negative dues.
 * Returns the patch to upsert (the bill id is included).
 */
export function applyPayment(
  bill: Bill,
  amount: number,
  mode = "Insurance / TPA",
): Partial<Bill> & { id: string } {
  const total = Number(bill.totalAmount || 0);
  const paid = Math.min(Math.max(0, Number(bill.paid || 0) + Number(amount || 0)), total);
  return {
    id: bill.id,
    paid,
    due: Math.max(0, total - paid),
    paymentMode: mode,
  };
}

/** What a claim raised against a bill should ask the payer for (₹). */
export function claimedAmountForBill(bill: Bill): number {
  return Number(bill.totalAmount || 0);
}

/* --------------------------------------------------------------- paperwork */

/** A fresh checklist with every line unchecked. */
export function defaultDocs(): ClaimDoc[] {
  return CLAIM_DOCUMENTS.map((name) => ({ name, ready: false }));
}

/** Bring any stored checklist back to the current document list, keeping ticks. */
export function normalizeDocs(docs: ClaimDoc[] | undefined): ClaimDoc[] {
  const byName = new Map((docs ?? []).map((d) => [(d.name || "").trim().toLowerCase(), !!d.ready]));
  return CLAIM_DOCUMENTS.map((name) => ({
    name,
    ready: byName.get(name.trim().toLowerCase()) ?? false,
  }));
}

export function docsReady(claim: Pick<Claim, "docs">): number {
  return (claim.docs ?? []).filter((d) => d.ready).length;
}

export function missingDocs(claim: Pick<Claim, "docs">): string[] {
  return (claim.docs ?? []).filter((d) => !d.ready).map((d) => d.name);
}

/* -------------------------------------------------------------- statistics */

export interface ClaimStats {
  total: number;
  open: number;
  closed: number;
  /** Count per status, for the register's chips. */
  byStatus: Record<string, number>;
  /** Σ claimed across the rows. */
  claimed: number;
  /** Σ approved across the rows. */
  approved: number;
  /** Σ actually received. */
  settled: number;
  /** Σ still expected on open rows. */
  pending: number;
  /** Σ the patients themselves bear (co-pay / non-payable). */
  patientShare: number;
  /** Share of the claimed money that has come in, 0–100 %. */
  settlementRate: number;
  /** Share of rows the payer threw out, 0–100 %. */
  rejectionRate: number;
}

export function claimStats(rows: Claim[]): ClaimStats {
  const byStatus: Record<string, number> = {};
  for (const c of rows) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const sum = (pick: (c: Claim) => number) => rows.reduce((s, c) => s + Number(pick(c) || 0), 0);
  const claimed = sum((c) => c.claimedAmount);
  const settled = sum((c) => c.settledAmount);
  const rejected = rows.filter((c) => c.status === "Rejected").length;
  return {
    total: rows.length,
    open: rows.filter(isOpenClaim).length,
    closed: rows.filter((c) => !isOpenClaim(c)).length,
    byStatus,
    claimed,
    approved: sum((c) => c.approvedAmount),
    settled,
    pending: rows.reduce((s, c) => s + claimPending(c), 0),
    patientShare: sum((c) => c.patientShare),
    settlementRate: claimed > 0 ? Math.round((settled / claimed) * 100) : 0,
    rejectionRate: rows.length ? Math.round((rejected / rows.length) * 100) : 0,
  };
}

/** Headline numbers for the page subtitle and the Billing desk tiles. */
export function claimQueueStats(state: HmsState, now = Date.now()) {
  const rows = claimList(state);
  const month = todayISO().slice(0, 7);
  const settled = rows.filter(
    (c) =>
      (c.status === "Settled" || c.status === "Partially settled") &&
      (c.settledOn || "").slice(0, 7) === month,
  );
  return {
    total: rows.length,
    open: rows.filter(isOpenClaim).length,
    preAuthPending: rows.filter((c) => c.status === "Preparing" || c.status === "Pre-auth sent")
      .length,
    awaitingSubmission: rows.filter(
      (c) => c.status === "Pre-auth approved" || c.status === "Query raised",
    ).length,
    awaitingSettlement: rows.filter(
      (c) => c.status === "Claim submitted" || c.status === "Approved",
    ).length,
    rejected: rows.filter((c) => c.status === "Rejected").length,
    overdue: rows.filter((c) => {
      const payer = state.payers?.[c.payerId];
      return isOverdue(c, payer, now);
    }).length,
    pendingAmount: rows.reduce((s, c) => s + claimPending(c), 0),
    settledThisMonth: settled.length,
    settledThisMonthAmount: settled.reduce((s, c) => s + Number(c.settledAmount || 0), 0),
  };
}

/** "CLM-42 · PM-JAY (Ayushman Bharat)" — how a claim reads in a list. */
export function claimLabel(claim: Claim): string {
  return `CLM-${claim.claimNo}${claim.payerName ? ` · ${claim.payerName}` : ""}`;
}
