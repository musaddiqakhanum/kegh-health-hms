import type { HmsState, ImagingOrder, ImagingOrderStatus } from "./types";
import { todayISO } from "./format";

/** Statuses where the order still needs radiology action. */
export const OPEN_IMAGING_STATUSES: ImagingOrderStatus[] = ["Ordered", "Study done"];

/** The single next action for an order, mirroring the scan → report workflow. */
export function nextImagingAction(status: ImagingOrderStatus): "scan" | "report" | null {
  if (status === "Ordered") return "scan";
  if (status === "Study done") return "report";
  return null;
}

export function imagingOrderList(state: HmsState): ImagingOrder[] {
  return Object.values(state.imagingOrders ?? {});
}

/**
 * Queue order: open orders first — urgent before routine, then earliest
 * order date — closed orders (reported / cancelled) newest first.
 */
export function sortImagingOrders(rows: ImagingOrder[]): ImagingOrder[] {
  const closed = (s: ImagingOrderStatus) => (OPEN_IMAGING_STATUSES.includes(s) ? 0 : 1);
  return [...rows].sort((a, b) => {
    const open = closed(a.status) - closed(b.status);
    if (open !== 0) return open;
    if (closed(a.status) === 0) {
      const urgent = (a.priority === "Urgent" ? 0 : 1) - (b.priority === "Urgent" ? 0 : 1);
      if (urgent !== 0) return urgent;
      return (a.date || "").localeCompare(b.date || "") || a.createdAt - b.createdAt;
    }
    return (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt;
  });
}

export function openImagingOrders(state: HmsState): ImagingOrder[] {
  return sortImagingOrders(
    imagingOrderList(state).filter((o) => OPEN_IMAGING_STATUSES.includes(o.status)),
  );
}

/** Headline counts for the queue subtitle / workspace tiles. */
export function imagingQueueStats(state: HmsState) {
  const rows = imagingOrderList(state);
  const today = todayISO();
  return {
    awaitingScan: rows.filter((o) => o.status === "Ordered").length,
    awaitingReport: rows.filter((o) => o.status === "Study done").length,
    orderedToday: rows.filter((o) => (o.date || "") === today).length,
    reportedToday: rows.filter((o) => o.status === "Report ready" && (o.date || "") === today)
      .length,
    urgent: rows.filter((o) => OPEN_IMAGING_STATUSES.includes(o.status) && o.priority === "Urgent")
      .length,
  };
}

export function searchImagingOrders(rows: ImagingOrder[], q: string): ImagingOrder[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (o) =>
      o.study?.toLowerCase().includes(s) ||
      o.orderedBy?.toLowerCase().includes(s) ||
      o.priority?.toLowerCase().includes(s) ||
      o.status?.toLowerCase().includes(s) ||
      o.notes?.toLowerCase().includes(s),
  );
}

export function imagingOrdersForPatient(state: HmsState, patientId: string): ImagingOrder[] {
  return sortImagingOrders(imagingOrderList(state).filter((o) => o.patientId === patientId));
}
