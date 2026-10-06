import type { HmsState, ServiceRate, ServiceSection } from "./types";

/** Rate master rows for one section (or all), newest price edits last. */
export function serviceRateList(state: HmsState, section?: ServiceSection): ServiceRate[] {
  return Object.values(state.serviceRates ?? {})
    .filter((r) => !section || r.section === section)
    .sort(
      (a, b) =>
        (a.section || "").localeCompare(b.section || "") ||
        (a.item || "").localeCompare(b.item || "") ||
        a.createdAt - b.createdAt,
    );
}

/** Active rates for a section as item (lowercased, trimmed) → ₹ rate. */
export function rateMapFor(state: HmsState, section: ServiceSection): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of serviceRateList(state, section)) {
    if (!r.active) continue;
    map.set((r.item || "").trim().toLowerCase(), Number(r.rate) || 0);
  }
  return map;
}

/** Split a comma-separated order's items, preserving original spelling. */
export function orderItems(itemsText: string): string[] {
  return (itemsText || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface OrderCharge {
  /** Items that matched a priced rate. */
  matched: { item: string; rate: number }[];
  /** Items with no active rate — the caller refuses to post when non-empty. */
  missing: string[];
  /** Sum of matched rates. */
  amount: number;
  /** Bill-line description, e.g. "Lab charges — CBC, HbA1c". */
  description: string;
}

/**
 * Price one ready order against the rate master: every item must match an
 * active rate above zero, otherwise it lands in `missing` so the UI can ask
 * the Admin to complete the master first. Returns null when nothing matched.
 */
export function orderCharge(
  state: HmsState,
  section: ServiceSection,
  itemsText: string,
): OrderCharge | null {
  const items = orderItems(itemsText);
  if (items.length === 0) return null;
  const rates = rateMapFor(state, section);
  const matched: { item: string; rate: number }[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const rate = rates.get(item.toLowerCase());
    if (rate && rate > 0) matched.push({ item, rate });
    else missing.push(item);
  }
  if (matched.length === 0) return null;
  return {
    matched,
    missing,
    amount: matched.reduce((s, m) => s + m.rate, 0),
    description: `${section} charges — ${items.join(", ")}`,
  };
}
