import { INDIAN_DRUGS } from "./indian-drugs";
import { MED_CATEGORIES, type HmsState, type MedCatalogItem } from "./types";

export function catalogList(state: HmsState): MedCatalogItem[] {
  return Object.values(state.medCatalog ?? {}).sort(
    (a, b) =>
      (a.name || "").localeCompare(b.name || "") ||
      (a.form || "").localeCompare(b.form || "") ||
      (a.strength || "").localeCompare(b.strength || "") ||
      a.createdAt - b.createdAt,
  );
}

const norm = (s: string) => s.trim().toLowerCase();

/** Case/form-strength identity used for duplicate detection on import. */
export function catalogKey(name: string, form: string, strength: string): string {
  return `${norm(name)}|${norm(form)}|${norm(strength)}`;
}

/** Every catalog entry for one drug name (case-insensitive), form-sorted. */
export function formsForName(state: HmsState, name: string): MedCatalogItem[] {
  const n = norm(name);
  if (!n) return [];
  return catalogList(state).filter((i) => norm(i.name) === n);
}

/**
 * Name suggestions for the prescription / stock name fields: prefix matches
 * first, then substring matches, deduplicated by exact name.
 */
export function suggestNames(state: HmsState, query: string, limit = 8): string[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const prefix = new Set<string>();
  const substr = new Set<string>();
  for (const i of catalogList(state)) {
    const n = norm(i.name);
    if (!n) continue;
    if (n.startsWith(q)) prefix.add(i.name);
    else if (n.includes(q)) substr.add(i.name);
    if (prefix.size >= limit) break;
  }
  return [...prefix, ...substr].slice(0, limit);
}

/** How a picked catalog entry reads on the prescription, e.g. "Augmentin 625 mg (Tablet)". */
export function composeMedText(item: Pick<MedCatalogItem, "name" | "strength" | "form">): string {
  const strength = item.strength.trim();
  const form = item.form.trim();
  return `${item.name.trim()}${strength ? ` ${strength}` : ""}${form ? ` (${form})` : ""}`;
}

export interface ParsedCatalog {
  items: { name: string; form: string; strength: string }[];
  errors: string[];
}

/**
 * Parse pasted CSV rows "name, form, strength" (header row optional). Form is
 * matched case-insensitively against MED_CATEGORIES; unknown forms import as
 * "Other". Blank strength is fine, a blank name is an error.
 */
export function parseCatalogCsv(text: string): ParsedCatalog {
  const items: ParsedCatalog["items"] = [];
  const errors: string[] = [];
  const forms = new Map(MED_CATEGORIES.map((f) => [f.toLowerCase(), f]));
  (text || "").split(/\r?\n/).forEach((line, idx) => {
    const raw = line.trim();
    if (!raw) return;
    const cols = raw.split(",").map((c) => c.trim());
    const [name = "", formRaw = "", strength = ""] = cols;
    if (idx === 0 && ["name", "drug", "medicine"].includes(name.toLowerCase())) return;
    if (!name) {
      errors.push(`Line ${idx + 1}: missing name`);
      return;
    }
    const form = formRaw ? (forms.get(formRaw.toLowerCase()) ?? "Other") : "";
    items.push({ name, form, strength });
  });
  return { items, errors };
}

/** Which of `items` are new (not already in the catalog, no in-file dupes). */
export function newCatalogRows(
  state: HmsState,
  items: { name: string; form: string; strength: string }[],
): { fresh: ParsedCatalog["items"]; skipped: number } {
  const seen = new Set(catalogList(state).map((i) => catalogKey(i.name, i.form, i.strength)));
  const fresh: ParsedCatalog["items"] = [];
  let skipped = 0;
  for (const i of items) {
    const key = catalogKey(i.name, i.form, i.strength);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    fresh.push(i);
  }
  return { fresh, skipped };
}

/* ---------------------------------------------------------- Indian starter list */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Seed the shared catalogue with the Indian starter list. Missing seed rows
 * are MERGED in (never overwriting anything the hospital added) — deterministic
 * ids per (name, form, strength) keep this idempotent and let two devices
 * seeding offline merge into the same rows. Runs once per seed version per
 * device (bump SEED_VERSION when the built-in list grows).
 */
export const DRUG_SEED_VERSION = "2";
const SEED_FLAG = "kegh-hms-drug-seed-version";

export function seedIndianDrugs(state: HmsState): HmsState {
  // No localStorage (tests / SSR): always evaluate the merge.
  let ls: Storage | null = null;
  try {
    ls = typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    ls = null;
  }
  if (ls?.getItem(SEED_FLAG) === DRUG_SEED_VERSION) return state;
  const medCatalog: Record<string, MedCatalogItem> = { ...state.medCatalog };
  let changed = false;
  for (const d of INDIAN_DRUGS) {
    const id = `seed-med-${slug(`${d.name}|${d.form}|${d.strength}`)}`;
    if (!medCatalog[id]) {
      medCatalog[id] = { id, name: d.name, form: d.form, strength: d.strength, createdAt: 0 };
      changed = true;
    }
  }
  ls?.setItem(SEED_FLAG, DRUG_SEED_VERSION);
  return changed ? { ...state, medCatalog } : state;
}
