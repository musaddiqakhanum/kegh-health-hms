import type { HmsState, LabOrder, LabOrderStatus } from "./types";
import { todayISO } from "./format";

/** Statuses where the order still needs lab action. */
export const OPEN_ORDER_STATUSES: LabOrderStatus[] = ["Ordered", "Sample collected"];

/** The single next action for an order, mirroring the queue workflow. */
export function nextAction(status: LabOrderStatus): "collect" | "result" | null {
  if (status === "Ordered") return "collect";
  if (status === "Sample collected") return "result";
  return null;
}

export function orderList(state: HmsState): LabOrder[] {
  return Object.values(state.labOrders ?? {});
}

/**
 * Queue order: open orders first — urgent before routine, then earliest
 * order date / time — closed orders (ready / cancelled) newest first.
 */
export function sortOrders(rows: LabOrder[]): LabOrder[] {
  const closed = (s: LabOrderStatus) => (OPEN_ORDER_STATUSES.includes(s) ? 0 : 1);
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

export function openOrders(state: HmsState): LabOrder[] {
  return sortOrders(orderList(state).filter((o) => OPEN_ORDER_STATUSES.includes(o.status)));
}

/** Headline counts for the queue subtitle / workspace tiles. */
export function orderQueueStats(state: HmsState) {
  const rows = orderList(state);
  const today = todayISO();
  return {
    awaitingSample: rows.filter((o) => o.status === "Ordered").length,
    awaitingResult: rows.filter((o) => o.status === "Sample collected").length,
    orderedToday: rows.filter((o) => (o.date || "") === today).length,
    readyToday: rows.filter((o) => o.status === "Result ready" && (o.date || "") === today).length,
    urgent: rows.filter((o) => o.status === "Ordered" && o.priority === "Urgent").length,
  };
}

export function searchOrders(rows: LabOrder[], q: string): LabOrder[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (o) =>
      o.tests?.toLowerCase().includes(s) ||
      o.orderedBy?.toLowerCase().includes(s) ||
      o.priority?.toLowerCase().includes(s) ||
      o.status?.toLowerCase().includes(s) ||
      o.notes?.toLowerCase().includes(s),
  );
}

export function ordersForPatient(state: HmsState, patientId: string): LabOrder[] {
  return sortOrders(orderList(state).filter((o) => o.patientId === patientId));
}
