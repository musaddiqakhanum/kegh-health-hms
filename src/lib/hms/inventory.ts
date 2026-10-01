import type { Grn, HmsState, Med, StockBatch, StockDraw } from "./types";
import { todayISO } from "./format";

/* ---------------------------------------------------------------- search */

export function searchMeds(rows: Med[], q: string): Med[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (m) =>
      m.name?.toLowerCase().includes(s) ||
      m.genericName?.toLowerCase().includes(s) ||
      m.category?.toLowerCase().includes(s) ||
      m.supplier?.toLowerCase().includes(s) ||
      m.hsn?.toLowerCase().includes(s),
  );
}

export function sortMedsByName(rows: Med[]): Med[] {
  return [...rows].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/** Active catalog medicines, alphabetically — what the pickers offer. */
export function medList(state: HmsState): Med[] {
  return sortMedsByName(Object.values(state.meds ?? {}).filter((m) => m.active !== false));
}

/* ---------------------------------------------------------------- expiry */

/** Current month as YYYY-MM — expiry months are compared against this. */
export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

/** Add `n` months to a YYYY-MM month string. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Batches expiring within this many months (incl. the current one) are "expiring soon". */
export const EXPIRY_SOON_MONTHS = 3;

export type ExpiryStatus = "expired" | "soon" | "ok" | "none";

/** Status of an expiry month: past month = expired, within the alert window = soon. */
export function expiryStatus(expiry: string, ref = currentMonth()): ExpiryStatus {
  if (!/^\d{4}-\d{2}$/.test(expiry || "")) return "none";
  if (expiry < ref) return "expired";
  if (expiry <= addMonths(ref, EXPIRY_SOON_MONTHS)) return "soon";
  return "ok";
}

/** "Dec-2026" for a YYYY-MM expiry month. */
export function fmtExpiry(expiry: string): string {
  if (!/^\d{4}-\d{2}$/.test(expiry || "")) return expiry || "—";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [y, m] = expiry.split("-").map(Number);
  return `${months[(m ?? 1) - 1]}-${y}`;
}

/* ---------------------------------------------------------------- batches */

export function batchList(state: HmsState): StockBatch[] {
  return Object.values(state.batches ?? {});
}

/** Batches of one medicine, earliest expiry first (FEFO order), then receipt order. */
export function batchesForMed(state: HmsState, medicineId: string): StockBatch[] {
  return batchList(state)
    .filter((b) => b.medicineId === medicineId)
    .sort((a, b) => (a.expiry || "").localeCompare(b.expiry || "") || a.createdAt - b.createdAt);
}

/** Total units on hand for one medicine (expired batches still count as stock — they're written off, not sold). */
export function stockForMed(state: HmsState, medicineId: string): number {
  return batchesForMed(state, medicineId).reduce((s, b) => s + Number(b.qtyOnHand || 0), 0);
}

/** Sellable (not expired) stock for one medicine — the ceiling a dispense can draw. */
export function sellableStock(state: HmsState, medicineId: string): number {
  const ref = currentMonth();
  return batchesForMed(state, medicineId)
    .filter((b) => expiryStatus(b.expiry, ref) !== "expired")
    .reduce((s, b) => s + Number(b.qtyOnHand || 0), 0);
}

/**
 * FEFO draw plan: earliest-expiry sellable batches first. Returns the draw
 * list, or null when sellable stock can't cover `qty` (callers refuse to save).
 */
export function allocateFEFO(state: HmsState, medicineId: string, qty: number): StockDraw[] | null {
  const need = Number(qty || 0);
  if (need <= 0) return [];
  const ref = currentMonth();
  const sellable = batchesForMed(state, medicineId).filter(
    (b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, ref) !== "expired",
  );
  const draws: StockDraw[] = [];
  let remaining = need;
  for (const b of sellable) {
    if (remaining <= 0) break;
    const take = Math.min(Number(b.qtyOnHand || 0), remaining);
    if (take > 0) {
      draws.push({ batchId: b.id, qty: take });
      remaining -= take;
    }
  }
  return remaining > 0 ? null : draws;
}

/** The expiry month a patient buying now would get — the nearest sellable expiry. */
export function nearestSellableExpiry(state: HmsState, medicineId: string): string {
  const ref = currentMonth();
  const sellable = batchesForMed(state, medicineId).filter(
    (b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, ref) !== "expired",
  );
  return sellable[0]?.expiry ?? "";
}

/** Rate a dispense entry pre-fills with: MRP of the FEFO batch, else the catalog sale rate. */
export function suggestedRate(state: HmsState, med: Med): number {
  const ref = currentMonth();
  const first = batchesForMed(state, med.id).find(
    (b) => Number(b.qtyOnHand || 0) > 0 && expiryStatus(b.expiry, ref) !== "expired",
  );
  return Number(first?.mrp || 0) > 0 ? Number(first!.mrp) : Number(med.saleRate || 0);
}

/* ----------------------------------------------------------- stock health */

export type StockStatus = "out" | "low" | "ok";

export function stockStatus(stock: number, reorderLevel: number): StockStatus {
  if (stock <= 0) return "out";
  if (Number(reorderLevel || 0) > 0 && stock <= Number(reorderLevel)) return "low";
  return "ok";
}

export interface MedStockRow {
  med: Med;
  /** Units on hand across every batch. */
  stock: number;
  /** Units actually sellable (expired batches excluded). */
  sellable: number;
  /** Nearest sellable expiry month; empty when nothing sellable remains. */
  expiry: string;
  status: StockStatus;
  /** Stock valued at the latest purchase rate per batch (₹). */
  value: number;
}

/** One inventory row per active medicine, worst-first (out, then low), then by name. */
export function medStockRows(state: HmsState): MedStockRow[] {
  const rank = { out: 0, low: 1, ok: 2 } as const;
  return medList(state)
    .map((med) => {
      const batches = batchesForMed(state, med.id);
      const stock = batches.reduce((s, b) => s + Number(b.qtyOnHand || 0), 0);
      return {
        med,
        stock,
        sellable: sellableStock(state, med.id),
        expiry: nearestSellableExpiry(state, med.id),
        status: stockStatus(stock, Number(med.reorderLevel || 0)),
        value: batches.reduce(
          (s, b) => s + Number(b.qtyOnHand || 0) * Number(b.purchaseRate || 0),
          0,
        ),
      };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.med.name.localeCompare(b.med.name));
}

export function lowStockRows(state: HmsState): MedStockRow[] {
  return medStockRows(state).filter((r) => r.status !== "ok");
}

/* ------------------------------------------------------------------- GRN */

export function grnList(state: HmsState): Grn[] {
  return Object.values(state.grns ?? {}).sort((a, b) => b.grnNo - a.grnNo);
}

/** Next running GRN number — one more than the highest in the file. */
export function nextGrnNo(state: HmsState): number {
  let max = 0;
  for (const g of Object.values(state.grns ?? {})) {
    if (Number(g.grnNo || 0) > max) max = Number(g.grnNo);
  }
  return max + 1;
}

/** Every batch a GRN line posted into stock. */
export function batchesForGrn(state: HmsState, grnId: string): StockBatch[] {
  return batchList(state).filter((b) => b.grnId === grnId);
}

/**
 * A GRN may only be deleted when every batch it brought in is still intact —
 * otherwise the stock books would disagree with what was dispensed.
 */
export function canDeleteGrn(state: HmsState, grnId: string): { ok: boolean; reason: string } {
  const opened = batchesForGrn(state, grnId).filter(
    (b) => Number(b.qtyOnHand || 0) < Number(b.qtyReceived || 0),
  );
  return opened.length > 0
    ? {
        ok: false,
        reason:
          "Stock from this GRN has already been dispensed — deleting it would break stock figures. Adjust the batches instead.",
      }
    : { ok: true, reason: "" };
}

/* ------------------------------------------------------------- reporting */

/** Stock units by medicine name across all batches — for dispense hints. */
export function stockByMedicineName(state: HmsState): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of medStockRows(state)) {
    map.set(row.med.name.toLowerCase(), row.stock);
  }
  return map;
}
