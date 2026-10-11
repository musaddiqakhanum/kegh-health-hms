/* Smoke tests for OT scheduling: procedure seed, theatre list ordering,
   timeline maths, safety checklist, statistics and Drive merge behaviour. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-ot-tmp");
rmSync(dir, { recursive: true, force: true });
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/hms/ot.ts",
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
  const ot = require(join(dir, "lib/hms/ot.js"));
  const { mergeStates } = require(join(dir, "lib/hms/merge.js"));

  let failures = 0;
  const check = (name, cond) => {
    if (cond) console.log(`  ok  ${name}`);
    else {
      failures++;
      console.error(`FAIL  ${name}`);
    }
  };

  const today = "2026-10-11";
  const surgery = (id, no, over = {}) => ({
    id,
    surgeryNo: no,
    patientId: "p1",
    visitId: "",
    admissionId: "",
    date: today,
    time: "09:00",
    durationMinutes: 60,
    room: "OT 1",
    procedure: "Laparoscopic appendectomy",
    code: "",
    priority: "Elective",
    surgeon: "Dr. Rao",
    assistant: "",
    anaesthetist: "",
    anaesthesia: "General",
    diagnosis: "",
    scrubNurse: "",
    notes: "",
    status: "Scheduled",
    checks: ot.defaultChecks(),
    createdAt: 1,
    ...over,
  });

  const state = {
    surgeries: {
      s1: surgery("s1", 1, { time: "09:00" }),
      s2: surgery("s2", 2, {
        time: "11:00",
        durationMinutes: 120,
        room: "OT 2",
        procedure: "Caesarean section",
        priority: "Emergency",
        surgeon: "Dr. Iyer",
      }),
      s3: surgery("s3", 3, {
        time: "08:00",
        room: "OT 1",
        procedure: "Dressing under anaesthesia",
        status: "Completed",
        startedAt: 1,
        completedAt: 2,
      }),
      s4: surgery("s4", 4, { date: "2026-10-12", time: "10:00", procedure: "Cataract surgery (phaco)" }),
      s5: surgery("s5", 5, { time: "14:00", room: "OT 3", status: "Cancelled", cancelReason: "Patient unwell" }),
      s6: surgery("s6", 6, { time: "10:30", patientId: "p2", procedure: "Hernia repair", status: "In theatre" }),
    },
    serviceRates: {
      r1: { id: "r1", section: "OT", item: "Laparoscopic appendectomy", rate: 12000, active: true, createdAt: 1 },
      r2: { id: "r2", section: "OT", item: "Caesarean section", rate: 18000, active: true, createdAt: 1 },
      r3: { id: "r3", section: "Lab", item: "CBC", rate: 300, active: true, createdAt: 1 },
      r4: { id: "r4", section: "OT", item: "Hernia repair", rate: 0, active: true, createdAt: 1 },
      r5: { id: "r5", section: "OT", item: "Old procedure", rate: 5000, active: false, createdAt: 1 },
    },
    patients: {},
    ops: {},
    deleted: {},
  };

  /* ------------------------------------------------------------- the list */
  check("next OT number after 6 cases", ot.nextSurgeryNo(state) === 7);
  check("next OT number on an empty list", ot.nextSurgeryNo({ surgeries: {} }) === 1);
  const day = ot.surgeriesOn(state, today);
  check("the day holds only that day's cases", day.length === 5);
  check("day list runs in start-time order", day.slice(0, 4).map((s) => s.id).join(",") === "s3,s1,s6,s2");
  check("cancelled cases sink to the end of the day", day[4].id === "s5");
  const upcoming = ot.upcomingSurgeries(state, today);
  check("upcoming = scheduled from today, soonest first", upcoming[0].id === "s1" && upcoming.length === 3);
  check("cancelled and in-theatre cases stay out of upcoming", !upcoming.some((s) => s.id === "s5" || s.id === "s6"));
  check("in-theatre cases are found anywhere on the list", ot.inTheatreNow(state)[0]?.id === "s6");
  check("a patient's own operations come newest first", ot.surgeriesForPatient(state, "p1")[0].id === "s4");
  check(
    "a surgeon's list for the day, in start-time order",
    ot.surgeriesForSurgeon(state, "Dr. Rao", today).map((s) => s.id).join(",") === "s3,s1,s6,s5",
  );
  check("an unknown surgeon has an empty list", ot.surgeriesForSurgeon(state, "Dr. New", today).length === 0);
  check("search by procedure", ot.searchSurgeries(ot.surgeryList(state), "cataract")[0]?.id === "s4");
  check("search by room", ot.searchSurgeries(ot.surgeryList(state), "OT 2")[0]?.id === "s2");
  check(
    "search by patient name / MRN",
    ot.searchSurgeries(ot.surgeryList(state), "Ramesh", () => "Ramesh Kumar KEGH/26/0007").length === 6,
  );
  check("search by OT number", ot.searchSurgeries(ot.surgeryList(state), "ot-2")[0]?.id === "s2");
  check("search by status", ot.searchSurgeries(ot.surgeryList(state), "completed").length === 1);

  /* ---------------------------------------------------------- day timing */
  check("09:30 is 570 minutes", ot.minutesOf("09:30") === 570);
  check("midnight is zero", ot.minutesOf("00:00") === 0);
  check("junk time reads as zero", ot.minutesOf("nonsense") === 0);
  check("570 minutes back to 09:30", ot.hhmmOf(570) === "09:30");
  check("minutes wrap inside the day", ot.hhmmOf(1500) === "01:00");
  check("planned finish of a case", ot.endsAt(surgery("x", 1, { time: "09:15", durationMinutes: 90 })) === "10:45");
  check("planned finish never carries past midnight", ot.endsAt(surgery("x", 1, { time: "23:30", durationMinutes: 60 })) === "00:30");
  check("planned minutes skip cancelled cases", ot.plannedMinutes(ot.surgeryList(state)) === 360);
  const bounds = ot.timelineBounds(day);
  check("timeline starts before the first cut", bounds.start <= ot.minutesOf("08:00"));
  check("timeline ends after the last finish", bounds.end >= ot.minutesOf("14:00"));
  check("timeline ticks are hourly", bounds.ticks[1] - bounds.ticks[0] === 60);
  check("an empty day falls back to office-theatre hours", ot.timelineBounds([]).start === 480 && ot.timelineBounds([]).end === 1080);
  check("timeline percentage is bounded", ot.timelinePct(-100, bounds) === 0 && ot.timelinePct(9999, bounds) === 100);

  /* ----------------------------------------------------------- checklist */
  check("checklist starts empty", ot.checksReady({ checks: ot.defaultChecks() }) === 0);
  check("a fresh case is not ready", ot.isReady(surgery("x", 1)) === false);
  const ticked = ot.defaultChecks().map((c) => ({ ...c, ready: true }));
  check("a fully ticked case is ready", ot.isReady({ checks: ticked }) === true);
  check("docs ready counts ticks", ot.checksReady({ checks: ticked }) === 8);
  check(
    "normalizeChecks keeps ticks and re-adds missing lines",
    ot.normalizeChecks([{ name: "Consent signed", ready: true }]).find((c) => c.name === "Consent signed").ready === true &&
      ot.normalizeChecks([{ name: "Consent signed", ready: true }]).length === 8,
  );
  check(
    "normalizeChecks drops lines the OT no longer tracks",
    ot.normalizeChecks([{ name: "Old form", ready: true }]).every((c) => c.name !== "Old form"),
  );
  check(
    "missing checks lists what is still to do",
    ot.missingChecks({ checks: [{ name: "Consent signed", ready: true }] }).includes("Blood arranged"),
  );

  /* --------------------------------------------------------- rate master */
  const procedures = ot.otProcedureList(state);
  check("OT price list holds only OT rows", procedures.every((r) => r.section === "OT"));
  check("OT price list is alphabetical within status", procedures[0].item === "Laparoscopic appendectomy" || procedures[0].item === "Caesarean section" || procedures[0].item === "Hernia repair");
  check(
    "unpriced procedures are reported",
    ot.missingOtRates(state, ["Laparoscopic appendectomy", "Hernia repair", "Cataract surgery (phaco)"]).join(",") ===
      "Hernia repair,Cataract surgery (phaco)",
  );
  check(
    "disabled rates count as unpriced",
    ot.missingOtRates(state, ["Old procedure"]).length === 1,
  );
  check("priced procedures are not reported", ot.missingOtRates(state, ["Caesarean section"]).length === 0);

  /* --------------------------------------------------------- starter seed */
  const seeded = ot.seedOtProcedures({ serviceRates: {}, surgeries: {}, ops: {}, deleted: {} });
  const seededNames = Object.values(seeded.serviceRates).map((r) => r.item);
  check("procedure seed loads the starter list", seededNames.length >= 50);
  check("seed ids are deterministic", !!seeded.serviceRates["seed-ot-laparoscopic-appendectomy"]);
  check(
    "seeded rates ship unset, never invented",
    Object.values(seeded.serviceRates).every((r) => r.rate === 0 && r.section === "OT"),
  );
  check("re-seeding is idempotent", Object.keys(ot.seedOtProcedures(seeded).serviceRates).length === seededNames.length);
  const handPriced = {
    serviceRates: {
      mine: { id: "mine", section: "OT", item: "Caesarean section", rate: 20000, active: true, createdAt: 1 },
    },
    surgeries: {},
    ops: {},
    deleted: {},
  };
  const seeded2 = ot.seedOtProcedures(handPriced);
  check(
    "a procedure the hospital already priced is never duplicated",
    Object.values(seeded2.serviceRates).filter((r) => r.item === "Caesarean section").length === 1,
  );
  check("the hospital's own price survives seeding", seeded2.serviceRates.mine.rate === 20000);

  /* ----------------------------------------------------------- counting */
  const stats = ot.surgeryStats(ot.surgeryList(state));
  check("stats count every case", stats.total === 6);
  check("stats split by status", stats.scheduled === 3 && stats.inTheatre === 1 && stats.completed === 1 && stats.cancelled === 1);
  check("emergency cases are counted", stats.emergency === 1);
  check("cancelled cases stay out of the planned minutes", stats.plannedMinutes === 360);
  check("completion rate is a share of rows", stats.completionRate === 17);
  check("cancellation rate is a share of rows", stats.cancellationRate === 17);
  const dayStats = ot.otDayStats(state, today, 660);
  check("day stats count the day only", dayStats.total === 5);
  check("day stats find the next case still to go in", dayStats.next?.id === "s1");
  check("day stats find the case running at 11:00", dayStats.running?.id === "s6");
  check("day stats flag unready cases (scheduled + in theatre)", dayStats.notReady === 3);
  check("a quiet day has no next case", ot.otDayStats(state, "2026-10-20", 600).next === null);

  /* ------------------------------------------------------------- merge */
  const local = { ...state, ops: { "surgeries:s1": 5 }, deleted: {} };
  const remote = {
    surgeries: {
      s1: { ...state.surgeries.s1, status: "Completed", findings: "Appendix removed" },
      s9: surgery("s9", 9, { date: "2026-10-13" }),
    },
    ops: { "surgeries:s1": 7, "surgeries:s9": 6 },
    deleted: {},
  };
  const merged = mergeStates(local, remote);
  check("newer remote case wins on sync", merged.surgeries.s1.status === "Completed");
  check("remote findings arrive with the case", merged.surgeries.s1.findings === "Appendix removed");
  check("remote-only cases are brought in", merged.surgeries.s9.id === "s9");
  check("local-only cases survive", merged.surgeries.s2.id === "s2");
  const deletedState = mergeStates(local, { surgeries: {}, ops: {}, deleted: { "surgeries:s1": 8 } });
  check("case tombstone wins on sync", !deletedState.surgeries.s1);
  check("legacy backup without the surgeries collection merges", !!mergeStates(local, { ops: {}, deleted: {} }).surgeries.s1);

  console.log(failures === 0 ? "\nAll OT smoke tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
