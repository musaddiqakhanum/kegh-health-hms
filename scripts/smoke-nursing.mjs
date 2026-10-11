/* Smoke tests for nursing vitals, ward rounds, notes, and reference flags. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-nursing-tmp");
rmSync(dir, { recursive: true, force: true });
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/hms/nursing.ts",
      "src/lib/hms/merge.ts",
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
    { cwd: process.cwd(), stdio: "pipe" },
  );
  writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
  const { createRequire } = await import("node:module");
  const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
  const ns = require(join(dir, "lib/hms/nursing.js"));
  const { mergeStates } = require(join(dir, "lib/hms/merge.js"));

  let failures = 0;
  const check = (name, cond) => {
    if (cond) console.log(`  ok  ${name}`);
    else {
      failures++;
      console.error(`FAIL  ${name}`);
    }
  };

  const dt = "2026-10-11";
  const v = (id, patientId, admissionId, date, time, over = {}) => ({
    id,
    patientId,
    visitId: "",
    admissionId,
    date,
    time,
    shift: ns.shiftForTime(time),
    temperature: 98.6,
    pulse: 80,
    respRate: 18,
    bpSystolic: 120,
    bpDiastolic: 80,
    spo2: 98,
    weightKg: 60,
    intakeMl: 0,
    outputMl: 0,
    recordedBy: "Nurse A",
    notes: "",
    createdAt: 2 * 86400000 + 8 * 3600000,
    ...over,
  });
  const adm = (id, patientId, bedId, status = "Admitted") => ({
    id,
    patientId,
    bedId,
    status,
    admitDate: "2026-10-10",
    visitId: "",
    createdAt: 86400000 + 8 * 3600000,
  });
  const note = (id, patientId, text, over = {}) => ({
    id,
    patientId,
    visitId: "",
    admissionId: "a1",
    date: dt,
    time: "14:15",
    shift: "Evening",
    category: "Progress note",
    author: "Nurse A",
    text,
    createdAt: 2 * 86400000 + 14 * 3600000,
    ...over,
  });

  const state = {
    patients: { p1: { name: "Asha", id: "p1" }, p2: { name: "Bala", id: "p2" } },
    beds: {
      b1: { id: "b1", ward: "General", label: "GW-1" },
      b2: { id: "b2", ward: "General", label: "GW-2" },
    },
    admissions: {
      a1: adm("a1", "p1", "b1"),
      a2: adm("a2", "p2", "b2"),
      old: adm("old", "p1", "b2", "Discharged"),
    },
    vitals: {
      v1: v("v1", "p1", "a1", dt, "09:00"),
      v2: v("v2", "p1", "a1", dt, "14:00", { spo2: 88 }),
      old: v("old", "p2", "", dt, "16:00", { pulse: 140 }),
      prev: v("prev", "p1", "old", "2026-10-10", "22:00"),
    },
    nursingNotes: {
      n1: note("n1", "p1", "Dressing dry"),
      n2: note("n2", "p2", "Alert and oriented", {
        admissionId: "a2",
        date: "2026-10-10",
        time: "08:00",
        createdAt: 86400000 + 8 * 3600000,
      }),
    },
  };

  check("shift schedule wraps midnight", ns.shiftForTime("06:59") === "Night");
  check("morning begins at 07:00", ns.shiftForTime("07:00") === "Morning");
  check("evening begins at 14:00", ns.shiftForTime("14:00") === "Evening");
  check("night begins at 22:00", ns.shiftForTime("22:00") === "Night");
  check("bad clock falls back to morning", ns.shiftForTime("99:99") === "Morning");

  check("normal reading not flagged", ns.vitalsSeverity(state.vitals.v1) === "normal");
  check("critical SpO2 flagged", ns.vitalsSeverity(state.vitals.v2) === "critical");
  check("abnormal but not critical pulse", ns.vitalSeverity("pulse", 112) === "abnormal");
  check("missing SpO2 is not flagged", ns.vitalSeverity("spo2", 0) === "normal");
  check("pain zero is charted not blank", ns.formatVital("painScore", 0) === "0/10");
  check("missing pain is blank", ns.formatVital("painScore", undefined) === "—");
  check("pain >=8 is critical", ns.vitalSeverity("painScore", 8) === "critical");
  check("single flag lists its value", ns.vitalFlags(state.vitals.v2)[0]?.value === "88%");
  check("quick summary has four vitals", ns.vitalsSummary(state.vitals.v1) === "98.6°F · 80/min · 120/80 · 98%");

  check("valid set passes", ns.validateVitals(state.vitals.v1) === null);
  check("must chart a real observation", ns.validateVitals({})?.includes("Record at least"));
  check("rejects impossible SpO2", ns.validateVitals({ ...state.vitals.v1, spo2: 101 })?.includes("SpO₂"));
  check("rejects incomplete BP", ns.validateVitals({ ...state.vitals.v1, bpDiastolic: 0 })?.includes("both BP"));
  check("rejects inverted BP", ns.validateVitals({ ...state.vitals.v1, bpDiastolic: 125 })?.includes("higher"));
  check("pain 0 is valid", ns.validateVitals({ ...state.vitals.v1, painScore: 0 }) === null);
  check("pain > 10 rejected", ns.validateVitals({ ...state.vitals.v1, painScore: 11 })?.includes("Pain"));

  check("vitals newest first", ns.vitalsForPatient(state, "p1").map((x) => x.id).join(",") === "v2,v1,prev");
  check("admission filter excludes other stays", ns.vitalsForAdmission(state, "a1").length === 2);
  check("date range is inclusive", ns.filterVitals(ns.vitalsList(state), { from: dt, to: dt }).length === 3);
  check("shift filters readings", ns.filterVitals(ns.vitalsList(state), { shift: "Evening" }).length === 2);
  check("flag filter excludes normal", ns.filterVitals(ns.vitalsList(state), { abnormalOnly: true }).length === 2);
  check("empty patient has no vitals", ns.vitalsForPatient(state, "missing").length === 0);

  const round = ns.wardRounds(state, dt);
  check("one row per admitted patient only", round.length === 2);
  check("uncharted patient first", round[0].patient.id === "p2" && !round[0].today);
  check("OPD set same day does not count for in-patient round", round[0].last === undefined);
  check("latest stay reading wins", round[1].last.id === "v2");
  check("roundsDue returns only uncharted in-patients", ns.roundsDue(state, dt).map((r) => r.patient.id).join(",") === "p2");
  const stats = ns.nursingStats(state, dt);
  check("workspace stats count patients, not duplicate sets", stats.admitted === 2 && stats.chartedToday === 2 && stats.readingsToday === 3 && stats.dueToday === 1);
  check("flags and notes in stats", stats.abnormalToday === 2 && stats.criticalToday === 2 && stats.notesToday === 1);

  check("notes newest first", ns.notesForPatient(state, "p1")[0]?.id === "n1");
  check("notes for admission exclude other patients", ns.notesForAdmission(state, "a1").length === 1);
  check("search note text", ns.searchNotes(ns.noteList(state), "dressing")[0]?.id === "n1");
  check("search note category", ns.searchNotes(ns.noteList(state), "progress")[0]?.id === "n1");

  /* New collections must survive the same Drive merge as other HMS records. */
  const local = { ...state, ops: { "vitals:v1": 5, "nursingNotes:n1": 5 }, deleted: {} };
  const remote = {
    vitals: { v1: { ...state.vitals.v1, pulse: 104 }, v3: v("v3", "p2", "a2", dt, "08:00") },
    nursingNotes: { n1: { ...state.nursingNotes.n1, text: "Settled overnight" } },
    ops: { "vitals:v1": 7, "vitals:v3": 6, "nursingNotes:n1": 7 },
    deleted: {},
  };
  const merged = mergeStates(local, remote);
  check("newer remote vitals win on sync", merged.vitals.v1.pulse === 104);
  check("remote nursing note wins on sync", merged.nursingNotes.n1.text === "Settled overnight");
  check("remote-only vitals are brought in", merged.vitals.v3.id === "v3");
  check("local-only nursing notes survive", merged.nursingNotes.n2.id === "n2");
  const deleted = mergeStates(local, {
    vitals: {}, nursingNotes: {}, ops: {}, deleted: { "vitals:v1": 8, "nursingNotes:n1": 8 },
  });
  check("vitals tombstone wins on sync", !deleted.vitals.v1);
  check("nursing note tombstone wins on sync", !deleted.nursingNotes.n1);
  check("legacy backup without new collections merges", !!mergeStates(local, { ops: {}, deleted: {} }).vitals.v1);

  console.log(failures === 0 ? "\nAll nursing smoke tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
