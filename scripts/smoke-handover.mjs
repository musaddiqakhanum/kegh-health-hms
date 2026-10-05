/* Smoke test for shift-handover helpers. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-handover-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/handover.ts",
    "--outDir",
    dir,
    "--rootDir",
    "src",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
  ],
  { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
);
writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
const { createRequire } = await import("node:module");
const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
const h = require(join(dir, "lib/hms/handover.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const note = (id, over) => ({
  id,
  date: "2026-10-03",
  time: "18:00",
  author: "Asha",
  role: "Nurse",
  category: "Handover",
  text: "Next dose 9 pm",
  resolved: false,
  createdAt: 1,
  ...over,
});

const state = {
  handoverNotes: {
    n1: note("n1", { date: "2026-10-02", time: "22:00", createdAt: 1 }),
    n2: note("n2", { date: "2026-10-03", time: "08:00", category: "Urgent", createdAt: 2 }),
    n3: note("n3", { date: "2026-10-03", time: "18:00", resolved: true, createdAt: 3 }),
  },
};

const sorted = h.sortNotes(Object.values(state.handoverNotes));
check("sortNotes newest first", sorted.map((n) => n.id).join(",") === "n3,n2,n1");

check(
  "openNotes drops handled",
  h
    .openNotes(state)
    .map((n) => n.id)
    .join(",") === "n2,n1",
);

const st = h.handoverStats(state);
check("stats: total/open/urgent", st.total === 3 && st.open === 2 && st.urgent === 1);

check("search finds by text", h.searchNotes(sorted, "dose", () => "").length === 3);
check("search finds by category", h.searchNotes(sorted, "urgent", () => "").length === 1);
check(
  "search finds patient via lookup fn",
  h.searchNotes([note("x", { patientId: "p1" })], "ramesh", () => "Ramesh K").length === 1,
);
check("search empty returns all", h.searchNotes(sorted, " ", () => "").length === 3);

/* per-patient notes for the Patient 360 card */
const perPatient = h.notesForPatient(
  {
    handoverNotes: {
      x1: note("x1", { patientId: "p1", date: "2026-10-01", createdAt: 1 }),
      x2: note("x2", { patientId: "p1", date: "2026-10-02", resolved: true, createdAt: 2 }),
      x3: note("x3", { patientId: "p2", date: "2026-10-03", createdAt: 3 }),
      x4: note("x4", { patientId: "p1", date: "2026-10-03", createdAt: 4 }),
    },
  },
  "p1",
);
check(
  "notesForPatient: open newest first, handled last",
  perPatient.map((n) => n.id).join(",") === "x4,x1,x2",
);
check(
  "notesForPatient: no other patient's notes",
  !perPatient.some((n) => n.id === "x3") &&
    h.notesForPatient({ handoverNotes: {} }, "p1").length === 0,
);

console.log(failures === 0 ? "\nAll handover smoke tests passed." : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
