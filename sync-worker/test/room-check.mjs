/* End-to-end check for the sync room, run against a live `wrangler dev` (or deployed) room.

   Usage:
     SYNC_URL=http://localhost:8787 ROOM_TOKEN=<token> node sync-worker/test/room-check.mjs

   The room needs SESSION_SECRET set as well (sync-worker/.dev.vars).

   It is NOT part of the smoke suite (it needs a running room). It checks:
   device access (the room token and staff sign-in), the staff roles, two devices
   exchanging changes, a conflict, refused changes, deactivation and force
   sign-out, rejection of a bad frame, and that a room restart keeps the same
   sequence numbers, conflicts and sign-in accounts. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const BASE = process.env.SYNC_URL ?? "http://localhost:8787";
const TOKEN = process.env.ROOM_TOKEN ?? "";
const ROOM = process.env.SYNC_ROOM ?? `check-${Date.now().toString(36)}`;
// Restart check, in two runs:
//   1. SYNC_SAVE=/tmp/room.json        → run the checks, save the room's history to that file
//   2. restart the room, then SYNC_VERIFY=/tmp/room.json (same SYNC_ROOM) → compare with the file
const SAVE_FILE = process.env.SYNC_SAVE ?? "";
const VERIFY_FILE = process.env.SYNC_VERIFY ?? "";

/** Staff accounts the check creates (first run) or signs in with (restart run). */
const ADMIN = { username: "check-admin", password: "check-admin-pass" };
const ADMIN2 = { username: "check-admin-2", password: "check-admin-2-pass" };
const RECEPTION = { username: "check-reception", password: "check-reception-pass" };
/** Account created only for the sign-in throttle check. */
const THROTTLE = { username: "check-throttle", password: "check-throttle-pass" };

if (!TOKEN) {
  console.error("ROOM_TOKEN is required");
  process.exit(2);
}

// Compile the shared sync core exactly as the app uses it.
const dir = mkdtempSync(join(tmpdir(), "sync-check-"));
let core;
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/hms/sync-core.ts",
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
    { cwd: process.cwd(), stdio: "pipe" },
  );
  writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
  core = require(join(dir, "lib/hms/sync-core.js"));
} finally {
  // Cleaned up at the end of the run.
}

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

const wsUrl = (room) =>
  `${BASE.replace(/^http/, "ws")}/rooms/${room}/ws?token=${encodeURIComponent(TOKEN)}`;

/** Same PBKDF2-SHA-256 (100,000 iterations, 16-byte salt) as the app's crypto.ts. */
async function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return Buffer.from(bits).toString("hex");
}

/** A user record in the shape the app stores. */
async function makeUser(account, role) {
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  return {
    id: crypto.randomUUID(),
    username: account.username,
    displayName: `${role} (check)`,
    role,
    passwordHash: await hashPassword(account.password, salt),
    salt,
    active: true,
    createdAt: Date.now(),
  };
}

/** Open a device connection; collects every server frame. */
function connect(deviceId) {
  const ws = new WebSocket(wsUrl(ROOM));
  const frames = [];
  const waiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    frames.push(msg);
    for (const w of [...waiters])
      if (w.test(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
  };
  /** Wait for a frame that arrives after `start` (or was already received since then). */
  const waitFrom = (start, test, ms = 5000) =>
    new Promise((resolve, reject) => {
      const found = frames.slice(start).find(test);
      if (found) return resolve(found);
      const t = setTimeout(() => reject(new Error(`timeout waiting for frame on ${deviceId}`)), ms);
      waiters.push({
        test,
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
    });
  const next = (test, ms) => waitFrom(0, test, ms);
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`connection failed for ${deviceId}`));
  });
  const closed = new Promise((resolve) => ws.addEventListener("close", (ev) => resolve(ev.code)));
  const sendAndWait = async (msg, test) => {
    await opened;
    const start = frames.length;
    ws.send(JSON.stringify(msg));
    return waitFrom(start, test);
  };
  return {
    ws,
    frames,
    next,
    opened,
    closed,
    send: (obj) => ws.send(JSON.stringify(obj)),
    sendAndWait,
    login: (account, setup) =>
      sendAndWait(
        {
          type: "login",
          username: account.username,
          password: account.password,
          ...(setup ? { setup } : {}),
        },
        (m) => m.type === "session" || m.type === "error",
      ),
    auth: (token) =>
      sendAndWait({ type: "auth", token }, (m) => m.type === "session" || m.type === "error"),
    hello: (cursor = 0) =>
      sendAndWait({ type: "hello", deviceId, cursor }, (m) => m.type === "catchup"),
    submit: (change) =>
      sendAndWait(
        { type: "submit", change },
        (m) => m.type === "ack" && m.devSeq === change.devSeq,
      ),
    close: () => ws.close(),
  };
}

// Plain HTTP probe (fetch cannot send an Upgrade header, so these checks stop before the upgrade).
const httpStatus = async (path, token) => {
  const url = `${BASE}${path}${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`;
  const res = await fetch(url);
  return res.status;
};

/** Restart verification only: sign in as the admin and compare the history with a saved snapshot. */
async function verifyRestart() {
  const saved = JSON.parse(readFileSync(VERIFY_FILE, "utf8"));
  const after = connect("devAfterRestart");
  const signed = await after.login(ADMIN);
  check("staff accounts survive a restart (admin signs in)", signed.type === "session");
  const stillLocked = await after.login(THROTTLE);
  check(
    "a sign-in lock survives a restart (the throttled account stays locked)",
    stillLocked.type === "error" && stillLocked.code === "too-many-attempts",
  );
  const catchAfter = await after.hello(0);
  const afterRows = catchAfter.updates.map((u) => [u.seq, u.key, JSON.stringify(u.current.value)]);
  after.close();
  check(
    `room ${saved.room} keeps sequence numbers, values and accounts after restart`,
    JSON.stringify(saved.rows) === JSON.stringify(afterRows),
  );
  console.log(failures === 0 ? "\nRestart check passed." : `\n${failures} check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  if (VERIFY_FILE) return verifyRestart();
  const { DeviceSync } = core;
  let manualSeq = 1_000_000_000; // devSeq for hand-built changes (unique, never reused)
  const manual = (deviceId, key, value, baseTs) => ({
    deviceId,
    devSeq: ++manualSeq,
    key,
    ts: Date.now(),
    baseTs: baseTs ?? null,
    value,
  });

  // ---- routing and the room token -----------------------------------------
  const health = await fetch(`${BASE}/health`);
  check("health endpoint answers", health.status === 200);
  check("missing token is refused", (await httpStatus(`/rooms/${ROOM}/ws`)) === 401);
  check("wrong token is refused", (await httpStatus(`/rooms/${ROOM}/ws`, "nope")) === 401);
  check("bad room id is refused", (await httpStatus(`/rooms/BAD_ID/ws`, TOKEN)) === 400);
  check(
    "valid token without an upgrade is refused",
    (await httpStatus(`/rooms/${ROOM}/ws`, TOKEN)) === 426,
  );

  // ---- sign-in is required before anything ----------------------------------
  const anon = connect("devAnon");
  const refusedHello = await anon.sendAndWait(
    { type: "hello", deviceId: "devAnon", cursor: 0 },
    (m) => m.type === "error",
  );
  check("hello without sign-in is refused", refusedHello.code === "sign-in-required");
  const refusedSubmit = await anon.sendAndWait(
    { type: "submit", change: manual("devAnon", "patients:anon", { name: "x" }, null) },
    (m) => m.type === "error",
  );
  check("submit without sign-in is refused", refusedSubmit.code === "sign-in-required");
  anon.close();

  const wrong = connect("devWrong");
  const wrongLogin = await wrong.login({ username: ADMIN.username, password: "not-the-password" });
  check(
    "a wrong password is refused",
    wrongLogin.type === "error" && wrongLogin.code === "invalid-login",
  );
  wrong.close();

  // ---- first admin (setup) --------------------------------------------------
  const adminRecord = await makeUser(ADMIN, "Admin");
  const a = connect("devA");
  const signedA = await a.login(ADMIN, adminRecord);
  check(
    "the first admin is set up from the device's own record",
    signedA.type === "session" && signedA.user.role === "Admin",
  );
  const adminToken = signedA.token;

  const adminTwoRecord = await makeUser(ADMIN2, "Admin");
  const setupAgain = connect("devSetupAgain");
  const setupRefused = await setupAgain.login(ADMIN2, adminTwoRecord);
  check(
    "setup is refused once an active Admin exists",
    setupRefused.type === "error" && setupRefused.code === "invalid-login",
  );
  setupAgain.close();

  // ---- the admin creates the Reception account -------------------------------
  const receptionRecord = await makeUser(RECEPTION, "Reception");
  const devA = new DeviceSync("devA");
  const createRec = devA.write(`users:${receptionRecord.id}`, receptionRecord, Date.now());
  const ackRec = await a.submit(createRec);
  check("an Admin can create a staff account", ackRec.result.outcome === "accepted");
  const recTs = ackRec.result.update.current.ts;

  const b = connect("devB");
  const signedB = await b.login(RECEPTION);
  check(
    "a Reception account signs in with its room password",
    signedB.type === "session" && signedB.user.role === "Reception",
  );
  const catchA = await a.hello(0);
  check(
    "a signed-in device catches up on the staff records",
    catchA.updates.length === 2 && catchA.lastSeq === 2,
  );
  const catchB = await b.hello(0);
  check("a Reception device gets the same history", catchB.lastSeq === 2);

  // ---- two devices, one room -------------------------------------------------
  const devB = new DeviceSync("devB");
  const cA = devA.write("patients:p1", { name: "Ramesh" }, 1000);
  a.send({ type: "submit", change: cA });
  const ackA = await a.next((m) => m.type === "ack" && m.devSeq === cA.devSeq);
  check(
    "first change is accepted and sequenced",
    ackA.result.outcome === "accepted" && ackA.result.seq === 3,
  );
  const seenByB = await b.next((m) => m.type === "update" && m.update.seq === 3);
  check("other device gets the update live", seenByB.update.current.value.name === "Ramesh");

  // Retry of the same change is idempotent.
  a.send({ type: "submit", change: cA });
  const again = await a.next((m) => m.type === "ack" && m.result.outcome === "duplicate");
  check("retry is a duplicate, not a second write", again.result.seq === 3);

  // Conflict: B edits from the original version, A edits first.
  devB.receive({
    seq: 3,
    key: "patients:p1",
    current: { key: "patients:p1", ts: 1000, deviceId: "devA", value: { name: "Ramesh" }, seq: 3 },
  });
  const cA2 = devA.write("patients:p1", { name: "Ramesh K" }, 2000);
  const cB2 = devB.write("patients:p1", { name: "R. Kumar" }, 1500);
  a.send({ type: "submit", change: cA2 });
  await a.next((m) => m.type === "ack" && m.devSeq === cA2.devSeq);
  b.send({ type: "submit", change: cB2 });
  const ackB = await b.next((m) => m.type === "ack" && m.devSeq === cB2.devSeq);
  check("stale edit is flagged as a conflict", ackB.result.outcome === "conflict");
  check("newer edit wins the conflict", ackB.result.update.current.value.name === "Ramesh K");
  check(
    "the losing version is sent with the conflict",
    ackB.result.update.other?.value?.name === "R. Kumar",
  );

  // A frame that breaks the rules is rejected, and the room keeps running.
  a.send({ type: "submit", change: { ...cA2, key: "nope:1", devSeq: 99 } });
  const bad = await a.next((m) => m.type === "error");
  check("unknown collection is rejected", /collection|key/.test(bad.message));
  a.ws.send("{not json");
  const badJson = await a.next((m) => m.type === "error" && /JSON/.test(m.message));
  check("malformed JSON is rejected", !!badJson);

  // ---- roles: refused changes are not logged ---------------------------------
  const roleUser = devB.write(
    `users:${receptionRecord.id}`,
    { ...receptionRecord, displayName: "Hacked" },
    Date.now(),
  );
  const refusedUser = await b.submit(roleUser);
  check(
    "a Reception account cannot change a user",
    refusedUser.result.outcome === "denied" && /Admin/.test(refusedUser.result.reason ?? ""),
  );
  check(
    "the refused user change returns the room's version",
    refusedUser.result.update.current.value.displayName === receptionRecord.displayName,
  );

  const payroll = devB.write("payrolls:pr1", { amount: 1 }, Date.now());
  const refusedPay = await b.submit(payroll);
  check("a Reception account cannot write payroll", refusedPay.result.outcome === "denied");

  const auditAdd = devB.write("auditLogs:au1", { action: "login", recordId: "x" }, Date.now());
  const auditOk = await b.submit(auditAdd);
  check("any signed-in staff can add an audit entry", auditOk.result.outcome === "accepted");
  b.send({ type: "submit", change: auditAdd });
  const auditRetry = await b.next(
    (m) => m.type === "ack" && m.result.outcome === "duplicate" && m.devSeq === auditAdd.devSeq,
  );
  check("a retried audit entry is a duplicate, not a refusal", !!auditRetry);

  const auditEdit = manual(
    "devB",
    "auditLogs:au1",
    { action: "tampered" },
    auditOk.result.update.current.ts,
  );
  const refusedAudit = await b.submit(auditEdit);
  check(
    "an audit entry cannot be changed",
    refusedAudit.result.outcome === "denied" && /changed/.test(refusedAudit.result.reason ?? ""),
  );

  const afterRefusals = devA.write("patients:p2", { name: "After refusals" }, Date.now());
  const ackAfter = await a.submit(afterRefusals);
  check(
    "refused changes do not use up sequence numbers",
    ackAfter.result.seq === auditOk.result.seq + 1,
  );

  // ---- tokens --------------------------------------------------------------
  const tampered = connect("devTampered");
  const tamperedAuth = await tampered.auth(adminToken.slice(0, -3) + "abc");
  check(
    "a tampered session token is refused",
    tamperedAuth.type === "error" && tamperedAuth.code === "sign-in-required",
  );
  tampered.close();

  const again2 = connect("devAgain");
  const resumed = await again2.auth(adminToken);
  check(
    "a saved session token signs in again",
    resumed.type === "session" && resumed.user.role === "Admin",
  );
  await again2.hello(0);
  again2.close();

  // ---- deactivation ends the session -----------------------------------------
  const deactivate = manual(
    "devA",
    `users:${receptionRecord.id}`,
    { ...receptionRecord, active: false },
    recTs,
  );
  const ackDeactivate = await a.submit(deactivate);
  check("an Admin can deactivate an account", ackDeactivate.result.outcome === "accepted");
  const bSignedOut = await b.next((m) => m.type === "error" && m.code === "sign-in-required");
  check("the deactivated device is signed out", !!bSignedOut);
  check("the deactivated device's socket is closed", (await b.closed) === 4001);
  const reSignIn = connect("devReturns");
  const reSigned = await reSignIn.login(RECEPTION);
  check(
    "a deactivated account cannot sign in",
    reSigned.type === "error" && reSigned.code === "invalid-login",
  );
  reSignIn.close();

  // ---- force sign-out --------------------------------------------------------
  const adminTwoCreate = manual("devA", `users:${adminTwoRecord.id}`, adminTwoRecord, null);
  const ackAdminTwo = await a.submit(adminTwoCreate);
  check("a second Admin can be added", ackAdminTwo.result.outcome === "accepted");
  const c = connect("devAdminTwo");
  const signedC = await c.login(ADMIN2);
  check("the second Admin signs in", signedC.type === "session");
  const kick = manual(
    "devA",
    `users:${adminTwoRecord.id}`,
    { ...adminTwoRecord, sessionsKickedAt: Date.now() + 1_000 },
    ackAdminTwo.result.update.current.ts,
  );
  const ackKick = await a.submit(kick);
  check("an Admin can force a sign-out", ackKick.result.outcome === "accepted");
  const cSignedOut = await c.next((m) => m.type === "error" && m.code === "sign-in-required");
  check("the force-signed-out session ends", !!cSignedOut);
  check("the force-signed-out socket is closed", (await c.closed) === 4001);

  // ---- late device and restart ----------------------------------------------
  const late = connect("devLate");
  const signedLate = await late.login(ADMIN);
  check("the admin signs in on a new device", signedLate.type === "session");
  const catchLate = await late.hello(0);
  const maxSeq = Math.max(
    ...[ackRec, ackA, ackB, auditOk, ackAfter, ackDeactivate, ackAdminTwo, ackKick].map(
      (x) => x.result.seq,
    ),
  );
  check(
    "late device catches up with every update, in order",
    catchLate.updates.length === catchLate.lastSeq &&
      catchLate.lastSeq === maxSeq &&
      catchLate.updates.every((u, i) => u.seq === i + 1),
  );
  late.close();

  // ---- sign-in throttle -------------------------------------------------------
  // Five wrong passwords are normal refusals; the sixth attempt locks the name.
  // The lock also refuses the right password and does not touch other accounts.
  const throttleRecord = await makeUser(THROTTLE, "Reception");
  const ackThrottle = await a.submit(
    devA.write(`users:${throttleRecord.id}`, throttleRecord, Date.now()),
  );
  check("an Admin can create the throttle test account", ackThrottle.result.outcome === "accepted");

  const guess = connect("devGuess");
  const guesses = [];
  for (let i = 0; i < 5; i++) {
    guesses.push(await guess.login({ username: " Check-Throttle ", password: `wrong-${i}` }));
  }
  check(
    "five wrong passwords get the normal refusal",
    guesses.every((m) => m.type === "error" && m.code === "invalid-login"),
  );
  const sixth = await guess.login(THROTTLE);
  check(
    "the right password is refused once the name is locked",
    sixth.type === "error" && sixth.code === "too-many-attempts",
  );
  check(
    "the lock message tells the user how long to wait",
    sixth.type === "error" && /Try again in \d+ minutes?\./.test(sixth.message),
  );

  const unlockedOther = connect("devOtherAccount");
  const otherSigned = await unlockedOther.login(ADMIN);
  check("other accounts are not affected by a lock", otherSigned.type === "session");
  unlockedOther.close();

  // Unknown names are throttled the same way (the lock must not reveal which accounts exist).
  const probe = connect("devProbe");
  const probeResults = [];
  for (let i = 0; i < 6; i++) {
    probeResults.push(await probe.login({ username: "check-nobody", password: `guess-${i}` }));
  }
  check(
    "an unknown name is locked on the sixth attempt too",
    probeResults.slice(0, 5).every((m) => m.code === "invalid-login") &&
      probeResults[5].code === "too-many-attempts",
  );
  probe.close();
  guess.close();

  // Parallel guesses on one socket are counted one by one, so a burst cannot get extra tries.
  const burst = connect("devBurst");
  await burst.opened;
  const burstStart = burst.frames.length;
  for (let i = 0; i < 8; i++) {
    burst.send({ type: "login", username: "check-burst", password: `burst-${i}` });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const burstReplies = burst.frames.slice(burstStart).filter((m) => m.type === "error");
  const burstWrong = burstReplies.filter((m) => m.code === "invalid-login").length;
  const burstLocked = burstReplies.filter((m) => m.code === "too-many-attempts").length;
  check(
    "8 parallel guesses: 5 are checked, 3 are refused as locked",
    burstReplies.length === 8 && burstWrong === 5 && burstLocked === 3,
  );
  burst.close();

  // ---- per-field rules at the room -------------------------------------------
  // An Admin creates a patient with clinical fields. A Reception change to allergies
  // is refused (nothing logged); a Reception change to the phone number is accepted.
  const rbacRecord = {
    id: "rbac1",
    name: "Ana",
    mrn: "R1",
    dob: "1990-01-01",
    gender: "F",
    phone: "1",
    address: "",
    fatherName: "",
    bloodGroup: "O+",
    allergies: "none",
    doctor: "",
    createdAt: 1,
  };
  const madeRbac = await a.submit(manual("devA", "patients:rbac1", rbacRecord, null));
  check("an Admin creates a patient with clinical fields", madeRbac.result.outcome === "accepted");
  const rbacTs = madeRbac.result.update.current.ts;
  // A fresh Reception account: check-reception was deactivated above.
  const CLERK = { username: "check-clerk", password: "check-clerk-pass" };
  const clerkRecord = await makeUser(CLERK, "Reception");
  const ackClerk = await a.submit(devA.write(`users:${clerkRecord.id}`, clerkRecord, Date.now()));
  check(
    "an Admin creates a Reception account for the field check",
    ackClerk.result.outcome === "accepted",
  );
  const recep = connect("devRecep");
  const recepSigned = await recep.login(CLERK);
  check("the Reception account signs in for the field check", recepSigned.type === "session");
  const refusedAllergy = await recep.submit(
    manual("devRecep", "patients:rbac1", { ...rbacRecord, allergies: "dust" }, rbacTs),
  );
  check(
    "the room refuses a Reception change to allergies",
    refusedAllergy.result.outcome === "denied",
  );
  const acceptedPhone = await recep.submit(
    manual("devRecep", "patients:rbac1", { ...rbacRecord, phone: "2" }, rbacTs),
  );
  check(
    "the room accepts a Reception change to the phone number",
    acceptedPhone.result.outcome === "accepted",
  );
  recep.close();

  // Save the history as it is now (after the throttle check added its account).
  const catchEnd = await a.hello(0);
  const rows = catchEnd.updates.map((u) => [u.seq, u.key, JSON.stringify(u.current.value)]);
  a.close();
  b.close();

  if (SAVE_FILE) {
    writeFileSync(SAVE_FILE, JSON.stringify({ room: ROOM, rows }));
    console.log(`  saved room history to ${SAVE_FILE} (restart the room, then verify)`);
  }

  console.log(failures === 0 ? "\nRoom check passed." : `\n${failures} check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error("room check crashed:", err);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
