/* Smoke test for the IPD / beds helpers. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-ipd-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/ipd.ts",
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
const ipd = require(join(dir, "lib/hms/ipd.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const bed = (id, ward, label) => ({
  id,
  ward,
  room: "",
  label,
  rate: 500,
  active: true,
  notes: "",
  createdAt: 1,
});
const adm = (id, patientId, bedId, over) => ({
  id,
  patientId,
  visitId: "",
  bedId,
  admitDate: "2026-09-30",
  admitTime: "10:00",
  reason: "",
  doctor: "Dr A",
  status: "Admitted",
  createdAt: 1,
  ...over,
});

check("stayDays is inclusive, min 1", ipd.stayDays("2026-10-01", "2026-10-01") === 1);
check("stayDays counts admit + discharge day", ipd.stayDays("2026-09-28", "2026-10-02") === 5);
check("stayDays end before admit still ≥ 1", ipd.stayDays("2026-10-05", "2026-10-01") === 1);
check("stayDays garbage → 0", ipd.stayDays("nope", "also-nope") === 0);

const state = {
  beds: {
    b1: bed("b1", "General Ward", "GW-1"),
    b2: bed("b2", "General Ward", "GW-2"),
    b3: bed("b3", "ICU", "ICU-1"),
    b4: { ...bed("b4", "ICU", "ICU-2"), active: false },
  },
  admissions: {
    a1: adm("a1", "p1", "b1"),
    a2: adm("a2", "p2", "b3", { status: "Discharged", dischargeDate: "2026-10-01" }),
  },
};

check(
  "inactive beds hidden from the board",
  ipd
    .bedList(state)
    .map((b) => b.id)
    .join(",") === "b1,b2,b3",
);
check("bed occupied by an admitted patient", ipd.activeAdmissionForBed(state, "b1")?.id === "a1");
check("freed after discharge", ipd.activeAdmissionForBed(state, "b3") === undefined);
check("patient has open admission", ipd.activeAdmissionForPatient(state, "p1")?.id === "a1");
check(
  "no open admission for discharged patient",
  ipd.activeAdmissionForPatient(state, "p2") === undefined,
);
check(
  "freeBeds excludes occupied",
  ipd
    .freeBeds(state)
    .map((b) => b.id)
    .join(",") === "b2,b3",
);

const wards = ipd.wardOccupancy(state);
const gw = wards.find((w) => w.ward === "General Ward");
check("ward occupancy counts", gw.total === 2 && gw.occupied === 1);

const stats = ipd.bedStats(state);
check(
  "bedStats totals",
  stats.total === 3 && stats.occupied === 1 && stats.free === 2 && stats.pct === 33,
);
check(
  "activeAdmissions only open",
  ipd
    .activeAdmissions(state)
    .map((a) => a.id)
    .join(",") === "a1",
);

/* bed charges: days stayed × bed rate */
const charge = ipd.bedChargeFor(state, state.admissions.a1);
check("bedChargeFor days × rate", charge.days >= 1 && charge.amount === charge.days * 500);
check(
  "bedChargeFor names ward and bed",
  charge.description.includes("General Ward") && charge.description.includes("GW-1"),
);
const noRate = { ...state, beds: { ...state.beds, b1: { ...state.beds.b1, rate: 0 } } };
check("bedChargeFor null without a rate", ipd.bedChargeFor(noRate, noRate.admissions.a1) === null);

/* per-patient stay history for Patient 360 */
const withStay = {
  ...state,
  admissions: {
    ...state.admissions,
    a3: adm("a3", "p1", "b2", {
      status: "Discharged",
      admitDate: "2026-08-10",
      dischargeDate: "2026-08-12",
    }),
  },
};
check(
  "admissionsForPatient: open first, then newest",
  ipd
    .admissionsForPatient(withStay, "p1")
    .map((a) => a.id)
    .join(",") === "a1,a3",
);
check(
  "admissionsForPatient: discharged patient still listed",
  ipd.admissionsForPatient(state, "p2").map((a) => a.id).join(",") === "a2",
);
check(
  "admissionsForPatient: unknown patient → empty",
  ipd.admissionsForPatient(state, "p9").length === 0,
);

/* expected-discharge "due today" strip */
const tdy = new Date();
const tdyISO = `${tdy.getFullYear()}-${String(tdy.getMonth() + 1).padStart(2, "0")}-${String(
  tdy.getDate(),
).padStart(2, "0")}`;
const dueState = {
  ...state,
  admissions: {
    ...state.admissions,
    a5: adm("a5", "p3", "b2", { expectedDischarge: tdyISO }),
    a6: adm("a6", "p4", "b3", { expectedDischarge: "2026-12-31" }),
    a7: adm("a7", "p5", "b1", {
      status: "Discharged",
      expectedDischarge: tdyISO,
      dischargeDate: tdyISO,
    }),
  },
};
check(
  "dueTodayDischarges: admitted + expected today only",
  ipd
    .dueTodayDischarges(dueState)
    .map((a) => a.id)
    .join(",") === "a5",
);
check(
  "dueTodayDischarges: explicit date works",
  ipd.dueTodayDischarges(dueState, "2026-12-31").map((a) => a.id).join(",") === "a6",
);
check(
  "dueTodayDischarges: quiet day → empty",
  ipd.dueTodayDischarges(dueState, "2030-01-01").length === 0,
);

console.log(failures === 0 ? "\nAll IPD smoke tests passed." : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
