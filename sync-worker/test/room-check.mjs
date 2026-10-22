/* End-to-end check for the sync room, run against a live `wrangler dev` (or deployed) room.

   Usage:
     SYNC_URL=http://localhost:8787 ROOM_TOKEN=<token> node sync-worker/test/room-check.mjs

   It is NOT part of the smoke suite (it needs a running room). It checks:
   auth, two devices exchanging changes, a conflict, rejection of a bad frame,
   and that a room restart keeps the same sequence numbers and conflicts. */
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
    ["tsc", "src/lib/hms/sync-core.ts", "--outDir", dir, "--rootDir", "src", "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
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

const wsUrl = (room) => `${BASE.replace(/^http/, "ws")}/rooms/${room}/ws?token=${encodeURIComponent(TOKEN)}`;

/** Open a device connection; collects every server frame. */
function connect(deviceId, cursor) {
  const ws = new WebSocket(wsUrl(ROOM));
  const frames = [];
  const waiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    frames.push(msg);
    for (const w of [...waiters]) if (w.test(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  };
  const next = (test, ms = 5000) =>
    new Promise((resolve, reject) => {
      const found = frames.find(test);
      if (found) return resolve(found);
      const t = setTimeout(() => reject(new Error(`timeout waiting for frame on ${deviceId}`)), ms);
      waiters.push({ test, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`connection failed for ${deviceId}`));
  });
  return {
    ws,
    frames,
    next,
    opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    hello: async () => {
      await opened;
      ws.send(JSON.stringify({ type: "hello", deviceId, cursor }));
      return next((m) => m.type === "catchup");
    },
    close: () => ws.close(),
  };
}

// Plain HTTP probe (fetch cannot send an Upgrade header, so these checks stop before the upgrade).
const httpStatus = async (path, token) => {
  const url = `${BASE}${path}${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`;
  const res = await fetch(url);
  return res.status;
};

/** Restart verification only: compare the room's history with a saved snapshot. */
async function verifyRestart() {
  const saved = JSON.parse(readFileSync(VERIFY_FILE, "utf8"));
  const after = connect("devAfterRestart", 0);
  const catchAfter = await after.hello();
  const afterRows = catchAfter.updates.map((u) => [u.seq, u.key, JSON.stringify(u.current.value)]);
  after.close();
  check(`room ${saved.room} keeps sequence numbers and values after restart`, JSON.stringify(saved.rows) === JSON.stringify(afterRows));
  console.log(failures === 0 ? "\nRestart check passed." : `\n${failures} check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  if (VERIFY_FILE) return verifyRestart();

  // ---- auth and routing -------------------------------------------------
  const health = await fetch(`${BASE}/health`);
  check("health endpoint answers", health.status === 200);
  check("missing token is refused", (await httpStatus(`/rooms/${ROOM}/ws`)) === 401);
  check("wrong token is refused", (await httpStatus(`/rooms/${ROOM}/ws`, "nope")) === 401);
  check("bad room id is refused", (await httpStatus(`/rooms/BAD_ID/ws`, TOKEN)) === 400);
  check("valid token without an upgrade is refused", (await httpStatus(`/rooms/${ROOM}/ws`, TOKEN)) === 426);

  // ---- two devices, one room ------------------------------------------
  const { DeviceSync } = core;
  const a = connect("devA", 0);
  const b = connect("devB", 0);
  const catchA = await a.hello();
  const catchB = await b.hello();
  check("empty room gives empty catch-up", catchA.updates.length === 0 && catchB.lastSeq === 0);

  const devA = new DeviceSync("devA");
  const devB = new DeviceSync("devB");
  const cA = devA.write("patients:p1", { name: "Ramesh" }, 1000);
  a.send({ type: "submit", change: cA });
  const ackA = await a.next((m) => m.type === "ack" && m.devSeq === cA.devSeq);
  check("first change is accepted and sequenced", ackA.result.outcome === "accepted" && ackA.result.seq === 1);
  const seenByB = await b.next((m) => m.type === "update" && m.update.seq === 1);
  check("other device gets the update live", seenByB.update.current.value.name === "Ramesh");

  // Retry of the same change is idempotent.
  a.send({ type: "submit", change: cA });
  const again = await a.next((m) => m.type === "ack" && m.result.outcome === "duplicate");
  check("retry is a duplicate, not a second write", again.result.seq === 1);

  // Conflict: B edits from the original version, A edits first.
  devB.receive({ seq: 1, key: "patients:p1", current: { key: "patients:p1", ts: 1000, deviceId: "devA", value: { name: "Ramesh" }, seq: 1 } });
  const cA2 = devA.write("patients:p1", { name: "Ramesh K" }, 2000);
  const cB2 = devB.write("patients:p1", { name: "R. Kumar" }, 1500);
  a.send({ type: "submit", change: cA2 });
  await a.next((m) => m.type === "ack" && m.devSeq === cA2.devSeq);
  b.send({ type: "submit", change: cB2 });
  const ackB = await b.next((m) => m.type === "ack" && m.devSeq === cB2.devSeq);
  check("stale edit is flagged as a conflict", ackB.result.outcome === "conflict");
  check("newer edit wins the conflict", ackB.result.update.current.value.name === "Ramesh K");

  // A frame that breaks the rules is rejected, and the room keeps running.
  a.send({ type: "submit", change: { ...cA2, key: "nope:1", devSeq: 99 } });
  const bad = await a.next((m) => m.type === "error");
  check("unknown collection is rejected", /collection|key/.test(bad.message));
  a.ws.send("{not json");
  const badJson = await a.next((m) => m.type === "error" && /JSON/.test(m.message));
  check("malformed JSON is rejected", !!badJson);

  // Catch-up from the start sees the full history.
  const late = connect("devLate", 0);
  const catchLate = await late.hello();
  check("late device catches up with 3 updates", catchLate.updates.length === 3 && catchLate.lastSeq === 3);
  late.close();

  const rows = catchLate.updates.map((u) => [u.seq, u.key, JSON.stringify(u.current.value)]);
  a.close();
  b.close();

  // ---- restart: same sequence numbers and state ------------------------
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
