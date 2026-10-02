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

console.log(failures === 0 ? "\nAll IPD smoke tests passed." : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
