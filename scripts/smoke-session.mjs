/* Smoke test for the session helpers: force sign-out stamps, idle auto-lock
   and the JSON session-meta round trip (incl. legacy plain-id sessions). */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-session-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/session-context.ts",
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

/* Minimal window.localStorage stub before the module is required. */
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  },
};

const { createRequire } = await import("node:module");
const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
const sc = require(join(dir, "lib/hms/session-context.js"));
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const KEY = "kegh-hms-session";

/* force sign-out predicate */
check("kick: session older than stamp is dropped", sc.sessionKickedOut(1000, 2000) === true);
check("kick: session newer than stamp survives", sc.sessionKickedOut(3000, 2000) === false);
check("kick: no stamp → nobody kicked", sc.sessionKickedOut(0, undefined) === false);
check("kick: legacy session (since 0) is dropped by any stamp", sc.sessionKickedOut(0, 1) === true);
check(
  "kick: session started at the exact stamp time survives",
  sc.sessionKickedOut(2000, 2000) === false,
);

/* idle auto-lock predicate */
check("idle: disabled at 0 minutes", sc.idleTimedOut(0, 86_400_000, 0) === false);
check("idle: under the limit stays in", sc.idleTimedOut(1_000_000, 1_000_000 + 14 * 60_000, 15) === false);
check(
  "idle: exactly at the limit locks",
  sc.idleTimedOut(1_000_000, 1_000_000 + 15 * 60_000, 15) === true,
);
check("idle: well past the limit locks", sc.idleTimedOut(0, 61 * 60_000, 60) === true);

/* session-meta persistence */
sc.writeSessionId("user-1", 1234);
const meta = sc.readSessionMeta();
check(
  "meta round trip: JSON id + since",
  meta.id === "user-1" && meta.since === 1234 && sc.readSessionId() === "user-1",
);

store.set(KEY, "legacy-plain-id");
const legacy = sc.readSessionMeta();
check(
  "legacy plain id still reads, since = 0",
  legacy.id === "legacy-plain-id" && legacy.since === 0 && sc.readSessionId() === "legacy-plain-id",
);

sc.writeSessionId(null);
const cleared = sc.readSessionMeta();
check(
  "clear removes the session",
  cleared.id === null && cleared.since === 0 && sc.readSessionId() === null,
);

store.delete(KEY);
check("missing key → empty meta", sc.readSessionMeta().id === null);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll session smoke checks passed.");
