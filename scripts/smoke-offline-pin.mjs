/* Smoke test for device sign-in PINs and password-material stripping (phase 4b, item 4).
   Compiles the real TS modules with the project's tsc and runs assertions. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), ".smoke-offline-pin-tmp");
rmSync(dir, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "src/lib/hms/offline-signin.ts",
    "src/lib/hms/user-secrets.ts",
    "src/lib/hms/crypto.ts",
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
    "--strict",
    "--noUncheckedIndexedAccess",
    "--exactOptionalPropertyTypes",
  ],
  { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
);
writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const pins = require(join(dir, "lib/hms/offline-signin.js"));
const secrets = require(join(dir, "lib/hms/user-secrets.js"));

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

/** A Map-backed stand-in for localStorage. */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    raw: () => m.get(pins.PIN_STORAGE_KEY) ?? "",
  };
}

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26, 9, 0, 0);
const ana = { id: "u-ana", username: "Ana", role: "Reception", displayName: "Ana R" };
const ravi = { id: "u-ravi", username: "ravi", role: "Doctor", displayName: "Dr Ravi" };

// ---- password material ----------------------------------------------------
{
  const user = {
    id: "u1",
    username: "a",
    passwordHash: "h",
    salt: "s",
    role: "Admin",
    active: true,
  };
  const stripped = secrets.stripUserSecrets(user);
  check(
    "strip: removes passwordHash and salt",
    !("passwordHash" in stripped) && !("salt" in stripped),
  );
  check("strip: keeps the other fields", stripped.username === "a" && stripped.role === "Admin");
  check("strip: does not change the input", user.passwordHash === "h" && user.salt === "s");

  const kept = secrets.keepStoredUserSecrets(
    { id: "u1", role: "Doctor" },
    { passwordHash: "h", salt: "s" },
  );
  check(
    "keep: an edit without the material keeps the stored material",
    kept.passwordHash === "h" && kept.salt === "s" && kept.role === "Doctor",
  );
  const reset = secrets.keepStoredUserSecrets(
    { id: "u1", passwordHash: "new", salt: "ns" },
    { passwordHash: "h", salt: "s" },
  );
  check(
    "keep: an edit with new material keeps the new material",
    reset.passwordHash === "new" && reset.salt === "ns",
  );

  const state = {
    users: { u1: user },
    patients: { p1: { id: "p1", name: "Ana", allergies: "none" } },
  };
  const safe = secrets.stripStateUserSecrets(state);
  check(
    "state: users have no password material",
    !("passwordHash" in safe.users.u1) && !("salt" in safe.users.u1),
  );
  check("state: other collections are untouched", safe.patients.p1.allergies === "none");
}

// ---- PIN validation and storage -------------------------------------------
{
  const store = memoryStorage();
  let rejected = 0;
  for (const bad of ["123", "12345", "12a4", "", "12 4"]) {
    try {
      await pins.setPinRecord(store, ana, bad, null);
    } catch {
      rejected++;
    }
  }
  check("pin: anything but 4 digits is refused", rejected === 5);

  await pins.setPinRecord(store, ana, "7391", NOW);
  const raw = store.raw();
  check("pin: the PIN itself is not stored", !raw.includes("7391") && !raw.includes('"pin"'));
  check(
    "pin: the record holds no password material",
    !raw.includes("passwordHash") && !raw.includes('"password"'),
  );
  check(
    "pin: lookup by username ignores case",
    pins.findPinRecord(store, "ANA")?.userId === "u-ana",
  );
}

// ---- checking a PIN ---------------------------------------------------------
{
  const store = memoryStorage();
  await pins.setPinRecord(store, ana, "7391", NOW);
  const good = await pins.checkPin(store, "Ana", "7391", NOW + HOUR);
  check("check: the right PIN signs in", good.ok === true);

  const bad = await pins.checkPin(store, "Ana", "0000", NOW + HOUR);
  check("check: a wrong PIN is refused as invalid", !bad.ok && bad.error === "invalid");

  // Four wrong PINs in a row, then a right one: the right one resets the count.
  for (let i = 0; i < 3; i++) await pins.checkPin(store, "Ana", "0000", NOW + HOUR);
  check(
    "check: a right PIN after four wrong ones still works",
    (await pins.checkPin(store, "Ana", "7391", NOW)).ok === true,
  );

  // Five wrong PINs in a row clear the record.
  const s2 = memoryStorage();
  await pins.setPinRecord(s2, ana, "7391", NOW);
  let last = null;
  for (let i = 0; i < 5; i++) last = await pins.checkPin(s2, "Ana", "0000", NOW);
  check("check: the fifth wrong PIN clears the record", !last.ok && last.error === "cleared");
  check(
    "check: after clearing, the device has no PIN for the account",
    (await pins.checkPin(s2, "Ana", "7391", NOW)).error === "no-pin",
  );
  check(
    "check: the cleared record is gone from storage",
    pins.findPinRecord(s2, "Ana") === undefined,
  );
}

// ---- a PIN set on a device with no room is never cleared --------------------
{
  const store = memoryStorage();
  await pins.setPinRecord(store, ana, "7391", null);
  let last = null;
  for (let i = 0; i < 5; i++) last = await pins.checkPin(store, "Ana", "0000", NOW);
  check(
    "no room: the fifth wrong PIN does not clear the only PIN",
    !last.ok && last.error === "invalid",
  );
  check(
    "no room: the right PIN still works after five wrong ones",
    (await pins.checkPin(store, "Ana", "7391", NOW)).ok === true,
  );
}

// ---- the 12-hour window -----------------------------------------------------
{
  const store = memoryStorage();
  await pins.setPinRecord(store, ana, "7391", NOW - 13 * HOUR); // last room sign-in 13 h ago
  const late = await pins.checkPin(store, "Ana", "7391", NOW);
  check(
    "window: a PIN 13 hours after the last room sign-in is expired",
    !late.ok && late.error === "expired",
  );

  const wrongWhileExpired = await pins.checkPin(store, "Ana", "0000", NOW);
  check(
    "window: an expired PIN gives no yes/no answer about the PIN",
    !wrongWhileExpired.ok && wrongWhileExpired.error === "expired",
  );

  pins.markRoomSignIn(store, "u-ana", NOW);
  check(
    "window: a room sign-in restarts the 12 hours",
    (await pins.checkPin(store, "Ana", "7391", NOW + 11 * HOUR)).ok === true,
  );
  check(
    "window: 12 hours after that, the PIN expires again",
    (await pins.checkPin(store, "Ana", "7391", NOW + 12 * HOUR + 1)).error === "expired",
  );
}

// ---- a PIN set on a device with no room never expires ------------------------
{
  const store = memoryStorage();
  await pins.setPinRecord(store, ana, "7391", null);
  const later = await pins.checkPin(store, "Ana", "7391", NOW + 400 * 24 * HOUR);
  check("no room: a PIN set by an Admin does not expire", later.ok === true);
}

// ---- per-account separation and replacement ---------------------------------
{
  const store = memoryStorage();
  await pins.setPinRecord(store, ana, "1111", null);
  await pins.setPinRecord(store, ravi, "2222", null);
  check(
    "accounts: each PIN opens only its own account",
    (await pins.checkPin(store, "ravi", "1111", NOW)).ok === false &&
      (await pins.checkPin(store, "ravi", "2222", NOW)).ok === true,
  );
  await pins.setPinRecord(store, ana, "3333", null);
  check(
    "accounts: setting a new PIN replaces the old one",
    (await pins.checkPin(store, "Ana", "1111", NOW)).ok === false &&
      (await pins.checkPin(store, "Ana", "3333", NOW)).ok === true,
  );
  pins.removePinRecord(store, "u-ravi");
  check(
    "accounts: removing a PIN leaves the others",
    pins.findPinRecord(store, "ravi") === undefined &&
      pins.findPinRecord(store, "Ana") !== undefined,
  );
}

console.log(
  failures === 0 ? "\nAll offline PIN smoke tests passed." : `\n${failures} test(s) FAILED`,
);
rmSync(dir, { recursive: true, force: true });
if (failures > 0) process.exit(1);
