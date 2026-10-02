import type { HandoverNote, HmsState } from "./types";

export function noteList(state: HmsState): HandoverNote[] {
  return Object.values(state.handoverNotes ?? {});
}

/** Newest first — the noticeboard order. */
export function sortNotes(rows: HandoverNote[]): HandoverNote[] {
  return [...rows].sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") ||
      (b.time || "").localeCompare(a.time || "") ||
      b.createdAt - a.createdAt,
  );
}

/** Notes still waiting for the next shift to handle. */
export function openNotes(state: HmsState): HandoverNote[] {
  return sortNotes(noteList(state).filter((n) => !n.resolved));
}

export function searchNotes(
  rows: HandoverNote[],
  q: string,
  patientName: (id: string) => string,
): HandoverNote[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter(
    (n) =>
      n.text?.toLowerCase().includes(s) ||
      n.author?.toLowerCase().includes(s) ||
      n.role?.toLowerCase().includes(s) ||
      n.category?.toLowerCase().includes(s) ||
      (n.patientId ? patientName(n.patientId).toLowerCase().includes(s) : false),
  );
}

/** Headline numbers for subtitles and workspace tiles. */
export function handoverStats(state: HmsState) {
  const rows = noteList(state);
  const open = rows.filter((n) => !n.resolved);
  return {
    open: open.length,
    urgent: open.filter((n) => (n.category || "").toLowerCase() === "urgent").length,
    total: rows.length,
  };
}
