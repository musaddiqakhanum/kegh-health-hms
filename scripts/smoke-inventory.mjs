/* Smoke test for the pharmacy inventory domain logic (FEFO, expiry, alerts).
   Compiles the real TS modules with the project's tsc and runs assertions. */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "inv-test-"));
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/inventory.ts",
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
const { createRequire } = await import("node:module");
const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
const inv = require(join(dir, "lib/hms/inventory.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const medA = {
  id: "m1",
  name: "Dolo 650",
  genericName: "Paracetamol",
  category: "Tablet",
  unit: "tablet",
  reorderLevel: 20,
  saleRate: 2.5,
  supplier: "Micro Labs",
  hsn: "",
  active: true,
  notes: "",
  createdAt: 1,
};
const medB = {
  id: "m2",
  name: "Azithral 500",
  genericName: "Azithromycin",
  category: "Tablet",
  unit: "strip",
  reorderLevel: 0,
  saleRate: 80,
  supplier: "",
  hsn: "",
  active: true,
  notes: "",
  createdAt: 2,
};

const month = inv.currentMonth();
const in2 = inv.addMonths(month, 2);
const in1 = inv.addMonths(month, 1);
const past = inv.addMonths(month, -4);
check("addMonths rolls year correctly", /^\d{4}-\d{2}$/.test(in2) && in2 !== month);

check("expiryStatus past = expired", inv.expiryStatus(past) === "expired");
check("expiryStatus +1mo = soon", inv.expiryStatus(in1) === "soon");
check("expiryStatus +12mo = ok", inv.expiryStatus(inv.addMonths(month, 12)) === "ok");
check("expiryStatus garbage = none", inv.expiryStatus("n/a") === "none");

const state = {
  meds: { m1: medA, m2: medB },
  batches: {
    b_old_exp: {
      id: "b_old_exp",
      medicineId: "m1",
      batchNo: "X1",
      expiry: past,
      qtyOnHand: 5,
      qtyReceived: 10,
      purchaseRate: 1,
      mrp: 2.5,
      supplier: "",
      notes: "",
      createdAt: 1,
    },
    b_first: {
      id: "b_first",
      medicineId: "m1",
      batchNo: "X2",
      expiry: in1,
      qtyOnHand: 8,
      qtyReceived: 10,
      purchaseRate: 1,
      mrp: 2.5,
      supplier: "",
      notes: "",
      createdAt: 2,
    },
    b_second: {
      id: "b_second",
      medicineId: "m1",
      batchNo: "X3",
      expiry: in2,
      qtyOnHand: 30,
      qtyReceived: 30,
      purchaseRate: 1.2,
      mrp: 3,
      supplier: "",
      notes: "",
      createdAt: 3,
    },
    b_m2: {
      id: "b_m2",
      medicineId: "m2",
      batchNo: "A1",
      expiry: in2,
      qtyOnHand: 5,
      qtyReceived: 5,
      purchaseRate: 60,
      mrp: 80,
      supplier: "",
      grnId: "g1",
      notes: "",
      createdAt: 4,
    },
  },
  grns: {
    g1: {
      id: "g1",
      grnNo: 1,
      date: "2026-10-01",
      supplier: "S",
      invoiceNo: "",
      invoiceDate: "",
      items: [],
      total: 300,
      receivedBy: "",
      notes: "",
      createdAt: 1,
    },
  },
};

check("stockForMed sums all batches incl. expired", inv.stockForMed(state, "m1") === 43);
check("sellableStock excludes expired", inv.sellableStock(state, "m1") === 38);
check(
  "medList only active, sorted",
  inv
    .medList(state)
    .map((m) => m.name)
    .join(",") === "Azithral 500,Dolo 650",
);

/* FEFO: pulls from earliest expiry first, skips expired batch */
const draws = inv.allocateFEFO(state, "m1", 10);
check(
  "allocateFEFO covers 10 across two batches",
  JSON.stringify(draws) ===
    JSON.stringify([
      { batchId: "b_first", qty: 8 },
      { batchId: "b_second", qty: 2 },
    ]),
);
check("allocateFEFO refuses beyond sellable stock", inv.allocateFEFO(state, "m1", 39) === null);
check(
  "allocateFEFO exactly at sellable stock works",
  inv.allocateFEFO(state, "m1", 38)?.length === 2,
);

/* suggested rate: FEFO batch MRP when in stock, catalog rate otherwise */
check("suggestedRate uses FEFO batch MRP", inv.suggestedRate(state, medA) === 2.5);
check("suggestedRate falls back to catalog", inv.suggestedRate(state, medB) === 80);

/* stock health + alerts */
const rows = inv.medStockRows(state);
const dolo = rows.find((r) => r.med.id === "m1");
const azi = rows.find((r) => r.med.id === "m2");
check("dolo (43 > reorder 20) is ok", dolo.status === "ok");
check("azi (no reorder level) is ok", azi.status === "ok");
const stateOut = { ...state, batches: {} };
check(
  "empty stock = out",
  inv.medStockRows(stateOut).every((r) => r.status === "out"),
);
check("lowStockRows finds out-of-stock meds", inv.lowStockRows(stateOut).length === 2);
check(
  "stock value = Σ qty × purchase rate",
  Math.round(dolo.value) === Math.round(5 * 1 + 8 * 1 + 30 * 1.2),
);

/* GRN housekeeping */
check("nextGrnNo increments", inv.nextGrnNo(state) === 2);
const stateOpened = {
  ...state,
  batches: { ...state.batches, b_m2: { ...state.batches.b_m2, qtyOnHand: 3 } },
};
check("canDeleteGrn blocks opened batches", inv.canDeleteGrn(stateOpened, "g1").ok === false);
check(
  "canDeleteGrn allows intact GRN (5 of 5 in stock)",
  inv.canDeleteGrn(state, "g1").ok === true,
);

/* fmtExpiry sanity */
check("fmtExpiry renders month", inv.fmtExpiry("2026-03") === "Mar-2026");

console.log(
  failures === 0 ? "\nAll inventory smoke tests passed." : `\n${failures} test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
