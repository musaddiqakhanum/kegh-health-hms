/* Smoke test for the service-rate master and order-pricing helper. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-charges-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/charges.ts",
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
const ch = require(join(dir, "lib/hms/charges.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const rate = (id, section, item, r, over) => ({
  id,
  section,
  item,
  rate: r,
  active: true,
  createdAt: 1,
  ...over,
});

const state = {
  serviceRates: {
    r1: rate("r1", "Lab", "CBC", 300),
    r2: rate("r2", "Lab", "HbA1c", 450),
    r3: rate("r3", "Imaging", "USG Abdomen", 900),
    r4: rate("r4", "Imaging", "CT Brain", 2500, { active: false }),
    r5: rate("r5", "Lab", "Zero", 0),
  },
};

const full = ch.orderCharge(state, "Lab", "CBC, HbA1c");
check(
  "orderCharge prices every matched item",
  full.matched.length === 2 && full.amount === 750 && full.missing.length === 0,
);
check(
  "orderCharge description names the section and items",
  full.description === "Lab charges — CBC, HbA1c",
);

check(
  "case-insensitive matching keeps original spelling",
  ch.orderCharge(state, "Lab", "cbc").matched[0].item === "cbc" &&
    ch.orderCharge(state, "Lab", "cbc").amount === 300,
);

const partial = ch.orderCharge(state, "Lab", "CBC, Vitamin D");
check(
  "unpriced items land in missing",
  partial.missing.join(",") === "Vitamin D" && partial.amount === 300,
);

check(
  "disabled rates count as missing",
  ch.orderCharge(state, "Imaging", "USG Abdomen, CT Brain").missing.join(",") === "CT Brain" &&
    ch.orderCharge(state, "Imaging", "USG Abdomen, CT Brain").amount === 900,
);
check(
  "zero rates count as missing",
  ch.orderCharge(state, "Lab", "CBC, Zero").missing.join(",") === "Zero",
);
check("disabled-only order → null", ch.orderCharge(state, "Imaging", "CT Brain") === null);
check("nothing matched → null, never a ₹0 bill line", ch.orderCharge(state, "Lab", "X") === null);
check("empty order text → null", ch.orderCharge(state, "Lab", " , ") === null);
check(
  "sections never cross-price",
  ch.orderCharge(state, "Imaging", "USG Abdomen").amount === 900 &&
    ch.orderCharge(state, "Lab", "USG Abdomen") === null,
);

const list = ch.serviceRateList(state);
check("serviceRateList sorts by section then item", list.map((r) => r.id).join(",") === "r4,r3,r1,r2,r5");
check(
  "serviceRateList filters by section",
  ch.serviceRateList(state, "Lab").every((r) => r.section === "Lab"),
);
check("orderItems trims and drops blanks", ch.orderItems(" A , ,B ,").join("|") === "A|B");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll charge smoke checks passed.");
