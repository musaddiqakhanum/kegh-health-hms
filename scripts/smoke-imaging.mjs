/* Smoke test for the imaging order queue helpers. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-imaging-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/imaging.ts",
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
const im = require(join(dir, "lib/hms/imaging.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const mk = (id, over) => ({
  id,
  patientId: "p1",
  visitId: "",
  date: "2026-10-01",
  study: "USG Abdomen",
  priority: "Routine",
  status: "Ordered",
  orderedBy: "Dr A",
  notes: "",
  createdAt: 1,
  ...over,
});

const stateOf = (rows) => ({
  imagingOrders: Object.fromEntries(rows.map((r) => [r.id, r])),
});

check("nextImagingAction: Ordered → scan", im.nextImagingAction("Ordered") === "scan");
check("nextImagingAction: Study done → report", im.nextImagingAction("Study done") === "report");
check(
  "nextImagingAction: closed orders → none",
  im.nextImagingAction("Report ready") === null && im.nextImagingAction("Cancelled") === null,
);

const sorted = im.sortImagingOrders([
  mk("done", { status: "Report ready", date: "2026-09-28", createdAt: 4 }),
  mk("routine-late", { date: "2026-10-02", createdAt: 3 }),
  mk("urgent-late", { priority: "Urgent", date: "2026-10-03", createdAt: 2 }),
  mk("routine-early", { date: "2026-09-30", createdAt: 1 }),
]);
check(
  "queue: open first — urgent, then earliest date",
  sorted.map((o) => o.id).join(",") === "urgent-late,routine-early,routine-late,done",
);

const open = im.openImagingOrders(
  stateOf([
    mk("a", { status: "Ordered" }),
    mk("b", { status: "Study done" }),
    mk("c", { status: "Report ready" }),
    mk("d", { status: "Cancelled" }),
  ]),
);
check(
  "openImagingOrders keeps only open statuses",
  open.length === 2 && open.every((o) => o.id === "a" || o.id === "b"),
);

const today = new Date();
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
  today.getDate(),
).padStart(2, "0")}`;
const stats = im.imagingQueueStats(
  stateOf([
    mk("w1", { status: "Ordered", date: iso, priority: "Urgent" }),
    mk("w2", { status: "Ordered", date: "2026-09-01" }),
    mk("r1", { status: "Study done" }),
    mk("done-today", { status: "Report ready", date: iso }),
    mk("cancelled", { status: "Cancelled", priority: "Urgent" }),
  ]),
);
check(
  "imagingQueueStats counts",
  stats.awaitingScan === 2 &&
    stats.awaitingReport === 1 &&
    stats.orderedToday === 2 &&
    stats.reportedToday === 1 &&
    stats.urgent === 1,
);

const found = im.searchImagingOrders(
  [
    mk("s1", { study: "CT Brain", notes: "rule out bleed" }),
    mk("s2", { study: "ECG", orderedBy: "Dr Mehta" }),
  ],
  "mehta",
);
check("search matches orderedBy", found.length === 1 && found[0].id === "s2");
check(
  "search matches study + notes",
  im.searchImagingOrders([mk("s1", { study: "CT Brain", notes: "rule out bleed" })], "bleed")
    .length === 1,
);
check("empty search returns all", im.searchImagingOrders([mk("s1"), mk("s2")], "  ").length === 2);

const mine = im.imagingOrdersForPatient(
  stateOf([mk("m1"), mk("m2", { patientId: "p2" }), mk("m3", { status: "Cancelled" })]),
  "p1",
);
check(
  "imagingOrdersForPatient filters + sorts",
  mine.length === 2 && mine.every((o) => o.patientId === "p1") && mine[mine.length - 1].id === "m3",
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll imaging order smoke checks passed.");
