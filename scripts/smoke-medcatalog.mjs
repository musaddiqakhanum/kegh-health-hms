/* Smoke test for the shared medicine catalogue (import parse, dedupe,
   suggestions and the form-picker data). */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-medcatalog-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/medcatalog.ts",
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
const mc = require(join(dir, "lib/hms/medcatalog.js"));
const types = require(join(dir, "lib/hms/types.js"));
const { INDIAN_DRUGS } = require(join(dir, "lib/hms/indian-drugs.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const item = (id, name, form, strength) => ({ id, name, form, strength, createdAt: 1 });
const state = {
  medCatalog: {
    a1: item("a1", "Augmentin Duo", "Syrup", "457 mg/5 ml"),
    a2: item("a2", "Augmentin Duo", "Tablet", "625 mg"),
    a3: item("a3", "Azithral", "Suspension", "200 mg/5 ml"),
    a4: item("a4", "Azithral", "Drops", "100 mg/ml"),
    a5: item("a5", "Dolo 650", "Tablet", "650 mg"),
  },
};

check(
  "catalogList sorted by name then form",
  mc.catalogList(state).map((i) => i.id).join(",") === "a1,a2,a4,a3,a5",
);

check(
  "formsForName: every variant, case-insensitive",
  mc.formsForName(state, "augmentin duo").map((i) => i.id).join(",") === "a1,a2",
);
check(
  "formsForName: drops & suspension both offered",
  mc.formsForName(state, "Azithral").map((i) => i.form).join(",") === "Drops,Suspension",
);
check("formsForName: unknown name → empty", mc.formsForName(state, "Crocin").length === 0);
check("formsForName: blank → empty", mc.formsForName(state, "  ").length === 0);

check(
  "suggestNames: prefix before substring",
  mc.suggestNames(state, "azi").join(",") === "Azithral",
);
check(
  "suggestNames: substring match when no prefix",
  mc.suggestNames(state, "650").join(",") === "Dolo 650",
);
check(
  "suggestNames: prefix names sort before substring names",
  mc.suggestNames(state, "au")[0] === "Augmentin Duo" &&
    mc.suggestNames(state, "au").includes("Azithral") === false,
);
check("suggestNames: one letter is not enough", mc.suggestNames(state, "a").length === 0);

check(
  "composeMedText full",
  mc.composeMedText({ name: "Augmentin Duo", strength: "625 mg", form: "Tablet" }) ===
    "Augmentin Duo 625 mg (Tablet)",
);
check(
  "composeMedText without strength",
  mc.composeMedText({ name: "Benadryl", strength: "", form: "Syrup" }) === "Benadryl (Syrup)",
);

const parsed = mc.parseCatalogCsv(
  "name, form, strength\nDolo 650, tablet, 650 mg\nAugmentin Duo, syrup, 457 mg/5 ml\nWikoryl, suspension\nAsthalin, nebuliser, 5 ml\n, Tablet, 5 mg\n",
);
check("parse: header skipped, rows read", parsed.items.length === 4);
check(
  "parse: form casing canonicalised + unknown → Other",
  parsed.items[0].form === "Tablet" &&
    parsed.items[1].form === "Syrup" &&
    parsed.items[2].form === "Suspension" &&
    parsed.items[3].form === "Other",
);
check("parse: blank strength tolerated, blank name errors", parsed.errors.length === 1);
check("parse: empty text → nothing", mc.parseCatalogCsv(" \n\n").items.length === 0);

const dedupe = mc.newCatalogRows(state, [
  { name: "Dolo 650", form: "Tablet", strength: "650 mg" }, // existing
  { name: " Dolo 650 ", form: "tablet", strength: "650 mg" }, // same, different casing
  { name: "Crocin", form: "Tablet", strength: "500 mg" },
  { name: "Crocin", form: "Tablet", strength: "500 mg" }, // in-file dupe
]);
check(
  "newCatalogRows: existing + in-file dupes skipped, novel kept",
  dedupe.skipped === 3 && dedupe.fresh.length === 1 && dedupe.fresh[0].name === "Crocin",
);

/* ---- Indian starter list ---- */
check(
  "Indian list: every form is a canonical MED_CATEGORIES entry",
  INDIAN_DRUGS.every((d) => types.MED_CATEGORIES.includes(d.form)),
);
check(
  "Indian list: no duplicate name/form/strength keys",
  new Set(INDIAN_DRUGS.map((d) => mc.catalogKey(d.name, d.form, d.strength))).size ===
    INDIAN_DRUGS.length,
);

const seeded = mc.seedIndianDrugs({ medCatalog: {} });
check(
  "seed: every Indian row lands in an empty catalogue",
  Object.keys(seeded.medCatalog).length === INDIAN_DRUGS.length,
);
check(
  "seed: fully seeded catalogue is stable (identity check)",
  mc.seedIndianDrugs(seeded) === seeded,
);
const toppedUp = mc.seedIndianDrugs(state);
check(
  "seed: top-up merges missing rows without touching existing ones",
  // fixture rows use synthetic ids, so every deterministic seed id is new here;
  // real devices already seeded with seed ids keep them (no duplicates).
  Object.keys(toppedUp.medCatalog).length === Object.keys(state.medCatalog).length + INDIAN_DRUGS.length &&
    toppedUp.medCatalog.a1.name === "Augmentin Duo" &&
    mc.catalogKey(
      toppedUp.medCatalog.a5.name,
      toppedUp.medCatalog.a5.form,
      toppedUp.medCatalog.a5.strength,
    ) === mc.catalogKey("Dolo 650", "Tablet", "650 mg"),
);
const seededTwice = mc.seedIndianDrugs({ medCatalog: {} });
check(
  "seed: deterministic ids (two offline devices merge to the same rows)",
  JSON.stringify(Object.keys(seeded.medCatalog).sort()) ===
    JSON.stringify(Object.keys(seededTwice.medCatalog).sort()),
);
check(
  "seed: Augmentin offers all 4 forms on screen, form-sorted",
  mc.formsForName(seeded, "Augmentin").map((i) => i.form).join(",") ===
    "Injection,Suspension,Syrup,Tablet",
);
check(
  "seed: strength choice too — Wysolone 5/10/20 mg",
  mc.formsForName(seeded, "WySoLoNe").map((i) => i.strength).join(",") === "10 mg,20 mg,5 mg",
);
check("seed: suggestions cover doctor+pharmacist typing", mc.suggestNames(seeded, "azi").join(",") === "Azithral");
check("seed: comprehensive Indian-market coverage (300+ entries)", INDIAN_DRUGS.length >= 300);
check(
  "seed: A–Z navigation has wide letter coverage (>= 20 letters)",
  new Set(INDIAN_DRUGS.map((d) => d.name[0].toUpperCase())).size >= 20,
);
check(
  "seed: multi-form showcases — Emeset 3, Calpol 3, Sinarest 3",
  mc.formsForName(seeded, "Emeset").length === 3 &&
    mc.formsForName(seeded, "Calpol").length === 3 &&
    mc.formsForName(seeded, "Sinarest").length === 3,
);
check(
  "seed: strength showcases — Thyronorm 4, Glycomet 3",
  mc.formsForName(seeded, "Thyronorm").length === 4 &&
    mc.formsForName(seeded, "Glycomet").length === 3,
);
check(
  "seed: hospital injectables present",
  mc.formsForName(seeded, "Adrenaline").length === 1 &&
    mc.formsForName(seeded, "Monocef").length === 1 &&
    mc.formsForName(seeded, "Metrogyl").some((i) => i.form === "Injection"),
);
check(
  "seed: catalog list is alphabetically navigable (no null starts)",
  mc.catalogList(seeded).every((i) => /^[A-Z0-9]/i.test(i.name[0] ?? "")),
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll medicine catalogue smoke checks passed.");
