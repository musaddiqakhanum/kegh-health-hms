/* Smoke test for the CRUD audit writer: role resolution, skipped collections,
   and entry fields — compiled from the real TS module with the project's tsc. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* Inside the project so bare imports (react via session-context) resolve. */
const dir = join(process.cwd(), ".smoke-audit-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/audit.ts",
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
    "--lib",
    "es2022,dom,dom.iterable",
  ],
  { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
);
/* The project is "type": "module" — mark the compiled output as CommonJS. */
writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
const { createRequire } = await import("node:module");
const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
const audit = require(join(dir, "lib/hms/audit.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const settings = { deviceName: "Front Desk PC", role: "Admin" };
const doctor = {
  id: "u1",
  username: "drasha",
  displayName: "Dr Asha",
  role: "Doctor",
  active: true,
  passwordHash: "",
  salt: "",
  createdAt: 1,
};

/* No session in Node (window undefined): falls back to the device role. */
const stateNoSession = { users: { u1: doctor } };
check(
  "role = device role when nobody is signed in",
  audit.effectiveRole(stateNoSession, settings) === "Admin",
);

/* craftAuditEntry basic shape */
const e1 = audit.craftAuditEntry({
  state: stateNoSession,
  settings,
  action: "create",
  collection: "patients",
  recordId: "p-42",
  now: 1700000000000,
  id: "audit-1",
});
check(
  "entry carries action/collection/recordId",
  e1.action === "create" && e1.collection === "patients" && e1.recordId === "p-42",
);
check(
  "entry carries device, role, timestamp",
  e1.deviceName === "Front Desk PC" &&
    e1.role === "Admin" &&
    e1.timestamp === 1700000000000 &&
    e1.createdAt === 1700000000000,
);
check("caller-supplied id is used", e1.id === "audit-1");

const e2 = audit.craftAuditEntry({
  state: stateNoSession,
  settings,
  action: "update",
  collection: "meds",
  recordId: "m1",
});
check(
  "auto id + timestamp generated",
  typeof e2.id === "string" && e2.id.length === 36 && e2.timestamp > 0,
);

/* auditLogs itself is never audited (no recursion / noise) */
check("auditLogs collection is skipped", audit.isAuditedCollection("auditLogs") === false);
check("patients collection is audited", audit.isAuditedCollection("patients") === true);
check("users collection is audited", audit.isAuditedCollection("users") === true);

console.log(failures === 0 ? "\nAll audit smoke tests passed." : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
