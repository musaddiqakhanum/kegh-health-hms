import type { HmsState } from "./types";

export function nextMrn(state: HmsState): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `KEGH/${yy}/`;
  let max = 0;
  for (const p of Object.values(state.patients)) {
    if (p.mrn?.startsWith(prefix)) {
      const n = parseInt(p.mrn.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
