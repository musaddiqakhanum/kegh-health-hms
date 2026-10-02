/* Smoke test for prescription fulfilment helpers. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-fulfil-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/fulfil.ts",
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
const f = require(join(dir, "lib/hms/fulfil.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const med = {
  id: "m1",
  name: "Dolo 650",
  genericName: "",
  category: "Tablet",
  unit: "tablet",
  reorderLevel: 0,
  saleRate: 2.5,
  supplier: "",
  hsn: "",
  active: true,
  notes: "",
  createdAt: 1,
};
const rx = (id, status, flags) => ({
  id,
  patientId: "p1",
  visitId: "",
  date: "2026-10-01",
  doctor: "Dr A",
  diagnosis: "",
  items: [
    { medication: "Dolo 650", dosage: "", frequency: "", duration: "" },
    { medication: "Azithral 500", dosage: "", frequency: "", duration: "" },
  ],
  notes: "",
  signOff: "",
  itemDispensed: flags,
  dispenseStatus: status,
  createdAt: 1,
});

const state = {
  meds: { m1: med },
  prescriptions: {
    r1: rx("r1", "Pending"),
    r2: rx("r2", "Partial", [true, false]),
    r3: rx("r3", "Dispensed", [true, true]),
  },
};

check(
  "matchMedicine finds by exact name (any case)",
  f.matchMedicine(state, "dolo 650")?.id === "m1",
);
check("matchMedicine rejects unknown names", f.matchMedicine(state, "Crocin") === undefined);
check("matchMedicine rejects empty", f.matchMedicine(state, "") === undefined);

check("fulfilStatus: none → Pending", f.fulfilStatus([false, false], 2) === "Pending");
check("fulfilStatus: some → Partial", f.fulfilStatus([true, false], 2) === "Partial");
check("fulfilStatus: all → Dispensed", f.fulfilStatus([true, true], 2) === "Dispensed");
check("fulfilStatus: holes are false", f.fulfilStatus([undefined, true], 2) === "Partial");
check("fulfilStatus: empty → Pending", f.fulfilStatus([], 0) === "Pending");

const flags = f.itemFlags(state.prescriptions.r2);
check(
  "itemFlags pads to item count",
  flags.length === 2 && flags[0] === true && flags[1] === false,
);

const open = f.pendingRx(state);
check("pendingRx excludes fully dispensed", open.length === 2 && open.every((r) => r.id !== "r3"));

const st = f.rxFulfilStats(state);
check("rxFulfilStats counts open + partial", st.open === 2 && st.partial === 1);

console.log(
  failures === 0 ? "\nAll fulfilment smoke tests passed." : `\n${failures} test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
