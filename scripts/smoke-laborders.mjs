/* Smoke test for the lab order queue helpers. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-laborders-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/laborders.ts",
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
const lo = require(join(dir, "lib/hms/laborders.js"));
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
  tests: "CBC",
  priority: "Routine",
  status: "Ordered",
  orderedBy: "Dr A",
  notes: "",
  createdAt: 1,
  ...over,
});

check("nextAction: Ordered → collect", lo.nextAction("Ordered") === "collect");
check("nextAction: Sample collected → result", lo.nextAction("Sample collected") === "result");
check(
  "nextAction: closed orders → none",
  lo.nextAction("Result ready") === null && lo.nextAction("Cancelled") === null,
);

const state = {
  labOrders: {
    a: mk("a", { priority: "Routine", date: "2026-09-30", createdAt: 1 }),
    b: mk("b", { priority: "Urgent", date: "2026-10-01", createdAt: 2 }),
    c: mk("c", { status: "Sample collected", createdAt: 3 }),
    d: mk("d", { status: "Result ready", date: "2026-10-02", createdAt: 4 }),
  },
};

const open = lo.openOrders(state);
check("openOrders list has 3 open, urgent first", open.length === 3 && open[0].id === "b");
check("routine older date before newer routine", open[1].id === "a");
check(
  "closed orders excluded from openOrders",
  open.every((o) => o.id !== "d"),
);

const st = lo.orderQueueStats(state);
check("queue stats: awaiting sample", st.awaitingSample === 2);
check("queue stats: awaiting result", st.awaitingResult === 1);
check("queue stats: urgent awaiting sample", st.urgent === 1);

const sorted = lo.sortOrders(Object.values(state.labOrders));
check("sortOrders: closed sink to bottom", sorted[sorted.length - 1].id === "d");

check(
  "searchOrders matches tests",
  lo.searchOrders(Object.values(state.labOrders), "cbc").length === 4,
);
check(
  "searchOrders matches priority",
  lo.searchOrders(Object.values(state.labOrders), "urgent").length === 1,
);
check(
  "searchOrders empty query returns all",
  lo.searchOrders(Object.values(state.labOrders), "").length === 4,
);

console.log(
  failures === 0 ? "\nAll lab order smoke tests passed." : `\n${failures} test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
