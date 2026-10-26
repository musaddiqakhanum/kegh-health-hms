/* Smoke tests for the real-time sync core: sequenced room log, idempotent
   submit, conflict flagging (warn-and-keep), device outbox and convergence
   under out-of-order and duplicate delivery. */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), ".smoke-realtime-tmp");
rmSync(dir, { recursive: true, force: true });
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/hms/sync-core.ts",
      "src/lib/hms/sync-protocol.ts",
      "src/lib/hms/types.ts",
      "src/lib/hms/realtime-state.ts",
      "src/lib/hms/realtime.ts",
      "src/lib/hms/sync-auth.ts",
      "src/lib/hms/field-rules.ts",
      "src/lib/hms/shadow.ts",
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
      "--noPropertyAccessFromIndexSignature",
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
  writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
  const { createRequire } = await import("node:module");
  const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
  const { RoomLog, DeviceSync } = require(join(dir, "lib/hms/sync-core.js"));
  const { parseClientMessage, MAX_FRAME_BYTES } = require(join(dir, "lib/hms/sync-protocol.js"));
  const rs = require(join(dir, "lib/hms/realtime-state.js"));
  const { RealtimeClient } = require(join(dir, "lib/hms/realtime.js"));
  const sa = require(join(dir, "lib/hms/sync-auth.js"));
  const { hashPassword, newSaltHex } = require(join(dir, "lib/hms/crypto.js"));

  let failures = 0;
  const check = (name, cond) => {
    if (cond) console.log(`  ok  ${name}`);
    else {
      failures++;
      console.error(`FAIL  ${name}`);
    }
  };

  // Deliver one room update to a device.
  const deliver = (dev, update) => dev.receive(update);
  // Submit a device's whole outbox to the room (FIFO) and broadcast every update to `devices`.
  const flush = (room, dev, devices) => {
    for (const c of dev.pending()) {
      const res = room.submit(c);
      dev.ack(c, res);
      if (res.update) for (const d of devices) deliver(d, res.update);
    }
  };

  // ---- basic path -------------------------------------------------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    const c1 = a.write("patients:p1", { name: "Ramesh" }, 1000);
    const r1 = room.submit(c1);
    check("first write is accepted", r1.outcome === "accepted" && r1.seq === 1);
    deliver(b, r1.update);
    check("other device sees the write", b.read("patients:p1")?.name === "Ramesh");
    check("sequence advances", room.lastSeq === 1 && b.cursor === 1);
    check("room current matches", room.get("patients:p1")?.value?.name === "Ramesh");
  }

  // ---- idempotent retries -----------------------------------------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const c = a.write("visits:v1", { type: "OPD" }, 1000);
    const first = room.submit(c);
    const again = room.submit({ ...c });
    check(
      "retry is reported as duplicate",
      again.outcome === "duplicate" && again.seq === first.seq,
    );
    check("retry emits no new update", again.update === undefined);
    check("log did not grow on retry", room.lastSeq === 1 && room.since(0).length === 1);
  }

  // ---- ordinary sequential edit (base matches current) ------------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    const c1 = a.write("bills:b1", { paid: 0 }, 1000);
    deliver(b, room.submit(c1).update);
    const c2 = b.write("bills:b1", { paid: 500 }, 2000);
    const r2 = room.submit(c2);
    check("edit on the current version is accepted", r2.outcome === "accepted");
    check("no conflict is recorded for a clean edit", room.conflicts.length === 0);
    deliver(a, r2.update);
    check("edit reaches the first device", a.read("bills:b1")?.paid === 500);
  }

  // ---- conflict: stale base, newer change wins, older kept for review ---
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    const seed = a.write("patients:p2", { phone: "1" }, 1000);
    const seedRes = room.submit(seed);
    deliver(b, seedRes.update);
    // Both edit from the same base. A is later in time and submits first.
    const ca = a.write("patients:p2", { phone: "A" }, 5000);
    const cb = b.write("patients:p2", { phone: "B" }, 3000);
    const ra = room.submit(ca);
    const rb = room.submit(cb);
    check("first edit accepted", ra.outcome === "accepted");
    check("stale edit is flagged as a conflict", rb.outcome === "conflict");
    check("newer edit stays the winner", room.get("patients:p2").value.phone === "A");
    check("conflict keeps both versions", room.conflicts.length === 1);
    check(
      "conflict records the older version as the other",
      room.conflicts[0].other.value.phone === "B" && room.conflicts[0].kept.value.phone === "A",
    );
    deliver(a, ra.update);
    deliver(a, rb.update);
    b.ack(cb, rb);
    deliver(b, ra.update);
    check("losing device converges to the winner", b.read("patients:p2")?.phone === "A");
    check("winning device converges to the winner", a.read("patients:p2")?.phone === "A");
  }

  // ---- conflict: stale base but the stale edit is actually newer --------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    const seed = a.write("patients:p3", { phone: "1" }, 1000);
    deliver(b, room.submit(seed).update);
    const ca = a.write("patients:p3", { phone: "A" }, 3000);
    const cb = b.write("patients:p3", { phone: "B" }, 6000);
    room.submit(ca);
    const rb = room.submit(cb); // newer timestamp, submitted second
    check("newer stale edit is flagged", rb.outcome === "conflict");
    check("newer stale edit wins", room.get("patients:p3").value.phone === "B");
  }

  // ---- tombstones: delete wins when newer, then the record can return ---
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    deliver(b, room.submit(a.write("patients:p4", { name: "X" }, 1000)).update);
    const del = b.write("patients:p4", null, 2000);
    deliver(a, room.submit(del).update);
    check("delete reaches the other device", a.read("patients:p4") === null);
    check("delete keeps a version (tombstone)", a.version("patients:p4")?.value === null);
    const recreate = room.submit(a.write("patients:p4", { name: "Y" }, 3000));
    deliver(a, recreate.update);
    deliver(b, recreate.update);
    check(
      "record can be recreated after delete",
      b.read("patients:p4")?.name === "Y" && a.read("patients:p4")?.name === "Y",
    );
  }

  // ---- catch-up after offline: a device that missed updates ------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    for (let i = 0; i < 5; i++) room.submit(a.write(`labs:l${i}`, { v: i }, 1000 + i));
    for (const u of room.since(b.cursor)) deliver(b, u);
    check("late device catches up from its cursor", b.cursor === 5 && b.read("labs:l4")?.v === 4);
    check("catch-up leaves nothing missing", room.since(b.cursor).length === 0);
  }

  // ---- out-of-order delivery converges ---------------------------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A");
    const c = new DeviceSync("C");
    const updates = [];
    updates.push(room.submit(a.write("k:1", { n: 1 }, 1000)).update);
    updates.push(room.submit(a.write("k:1", { n: 2 }, 2000)).update);
    updates.push(room.submit(a.write("k:2", { n: 9 }, 2500)).update);
    // Newest first, then the older update for the same record arrives late.
    deliver(c, updates[1]);
    deliver(c, updates[2]);
    deliver(c, updates[0]);
    check(
      "late older update does not overwrite the newest value",
      c.read("k:1")?.n === 2 && c.read("k:2")?.n === 9,
    );
    check("cursor catches up once the gap closes", c.cursor === 3);
  }

  // ---- randomised convergence: many devices, duplicates, reordering ----
  {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const room = new RoomLog();
    const devices = ["A", "B", "C", "D"].map((id) => new DeviceSync(id));
    const keys = ["patients:p1", "bills:b1", "visits:v1", "labs:l1", "beds:w1-1"];
    let clock = 1000;
    const inbox = new Map(devices.map((d) => [d.deviceId, []]));
    const broadcast = (u) => {
      for (const d of devices) inbox.get(d.deviceId).push(u);
    };

    for (let step = 0; step < 3000; step++) {
      const dev = pick(devices);
      const r = rnd();
      clock += Math.floor(rnd() * 3);
      if (r < 0.35) {
        dev.write(pick(keys), rnd() < 0.15 ? null : { v: step }, clock);
      } else if (r < 0.6) {
        // Submit one pending change (FIFO per device), sometimes twice (retry).
        const p = dev.pending()[0];
        if (p) {
          const res = room.submit(p);
          dev.ack(p, res);
          if (res.update) broadcast(res.update);
          if (rnd() < 0.2) room.submit(p); // duplicate retry
        }
      } else {
        // Deliver a random subset of queued updates to a device, in random order.
        const q = inbox.get(dev.deviceId);
        const n = Math.floor(rnd() * q.length);
        for (let i = 0; i < n; i++) {
          const idx = Math.floor(rnd() * q.length);
          deliver(dev, q.splice(idx, 1)[0]);
        }
      }
    }

    // Quiesce: submit everything, deliver everything, then catch up from cursors.
    for (const d of devices) {
      for (const p of d.pending()) {
        const res = room.submit(p);
        d.ack(p, res);
        if (res.update) broadcast(res.update);
      }
    }
    for (const d of devices) {
      for (const u of inbox.get(d.deviceId)) deliver(d, u);
      inbox.get(d.deviceId).length = 0;
      for (const u of room.since(d.cursor)) deliver(d, u);
    }

    let converged = true;
    for (const d of devices) {
      for (const k of keys) {
        const want = room.get(k);
        const have = d.version(k);
        const wantVal = want ? want.value : null;
        const haveVal = have ? have.value : null;
        if (
          JSON.stringify(wantVal) !== JSON.stringify(haveVal) ||
          (want?.ts ?? 0) !== (have?.ts ?? 0)
        ) {
          converged = false;
          console.error(`  diverged: device ${d.deviceId} ${k}`, have, want);
        }
      }
    }
    check("random run converges on every device", converged);
    check(
      `random run exercised conflicts (${room.conflicts.length} flagged)`,
      room.conflicts.length > 0,
    );
    check(`random run exercised the log (${room.lastSeq} updates)`, room.lastSeq > 500);
    check(
      "every device cursor reached the room log head",
      devices.every((d) => d.cursor === room.lastSeq),
    );
  }

  // ---- persistence: accept hook and deterministic restore ---------------
  {
    const persisted = [];
    const room = new RoomLog((seq, change) => persisted.push({ seq, change }));
    const a = new DeviceSync("A");
    const b = new DeviceSync("B");
    const seed = a.write("patients:q1", { v: 1 }, 1000);
    room.submit(seed);
    const dup = room.submit({ ...seed });
    check("retries are not persisted twice", persisted.length === 1 && dup.outcome === "duplicate");
    b.receive(room.since(0)[0]);
    room.submit(a.write("patients:q1", { v: 2 }, 2000));
    room.submit(b.write("patients:q1", { v: 3 }, 1500)); // stale base -> conflict, still persisted
    check("conflicts are persisted too", persisted.length === 3 && room.conflicts.length === 1);

    const restored = RoomLog.restore(persisted.map((p) => p.change));
    check("restore gives the same head sequence", restored.lastSeq === room.lastSeq);
    check(
      "restore gives the same current versions",
      JSON.stringify(restored.get("patients:q1")) === JSON.stringify(room.get("patients:q1")),
    );
    check(
      "restore gives the same conflicts",
      JSON.stringify(restored.conflicts) === JSON.stringify(room.conflicts),
    );
    check("restore does not re-persist", persisted.length === 3);
    const later = restored.submit(a.write("patients:q1", { v: 4 }, 3000));
    check("a restored room continues the sequence", later.seq === room.lastSeq + 1);
  }

  // ---- wire protocol: valid and invalid frames ---------------------------
  {
    const ok = (t) => parseClientMessage(t).ok === true;
    const bad = (t) => parseClientMessage(t).ok === false;
    const change = {
      deviceId: "A",
      devSeq: 1,
      key: "patients:p1",
      ts: 1000,
      baseTs: null,
      value: { name: "x" },
    };
    check(
      "hello frame is accepted",
      ok(JSON.stringify({ type: "hello", deviceId: "A", cursor: 0 })),
    );
    check("submit frame is accepted", ok(JSON.stringify({ type: "submit", change })));
    check(
      "delete (null value) is accepted",
      ok(JSON.stringify({ type: "submit", change: { ...change, value: null } })),
    );
    check("ping frame is accepted", ok(JSON.stringify({ type: "ping" })));
    check("non-JSON is rejected", bad("{nope"));
    check("missing type is rejected", bad(JSON.stringify({ deviceId: "A" })));
    check("unknown type is rejected", bad(JSON.stringify({ type: "drop-table" })));
    check(
      "unknown collection is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, key: "secrets:1" } })),
    );
    check(
      "key without an id is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, key: "patients:" } })),
    );
    check(
      "key without a colon is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, key: "patients" } })),
    );
    check(
      "devSeq 0 is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, devSeq: 0 } })),
    );
    check(
      "fractional devSeq is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, devSeq: 1.5 } })),
    );
    check(
      "string ts is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, ts: "1000" } })),
    );
    check(
      "string baseTs is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, baseTs: "1" } })),
    );
    check(
      "empty deviceId is rejected",
      bad(JSON.stringify({ type: "submit", change: { ...change, deviceId: "" } })),
    );
    check(
      "negative cursor is rejected",
      bad(JSON.stringify({ type: "hello", deviceId: "A", cursor: -1 })),
    );
    check(
      "oversized frame is rejected",
      bad(
        JSON.stringify({
          type: "submit",
          change: { ...change, value: "x".repeat(MAX_FRAME_BYTES) },
        }),
      ),
    );
  }

  // ---- device snapshot, import, discard, reset ---------------------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A", 100);
    room.submit(new DeviceSync("B").write("patients:s1", { v: 1 }, 1000));
    const first = room.submit(a.write("patients:s2", { v: 2 }, 1000));
    check("device receives its own accepted update", a.ack(a.pending()[0], first) === true);
    check("ack removes the change from the outbox", a.pending().length === 0);

    const dup = room.since(0)[0];
    check(
      "receive applies a new update once",
      a.receive(dup) === true && a.receive(dup) === false && a.cursor === 2,
    );
    a.write("patients:s3", { v: 3 }, 2000);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    const back = DeviceSync.fromSnapshot(snap);
    check(
      "snapshot round trip keeps the outbox",
      JSON.stringify(back.pending()) === JSON.stringify(a.pending()),
    );
    check("snapshot round trip keeps the cursor", back.cursor === a.cursor);
    check(
      "snapshot round trip keeps known versions",
      back.version("patients:s2")?.ts === a.version("patients:s2")?.ts,
    );
    const next = back.write("patients:s4", { v: 4 }, 3000);
    check(
      "restored counter continues after the last devSeq",
      next.devSeq > a.pending().at(-1).devSeq,
    );

    const imp = back.importLocal("patients:s5", { v: 5 }, 500);
    check("imported change carries no base version", imp.baseTs === null && imp.ts === 500);
    back.discard(imp);
    check("discard removes a change", !back.pending().some((c) => c.key === "patients:s5"));

    const fresh = new DeviceSync("C", 0);
    fresh.cursor = 40;
    fresh.write("patients:s6", { v: 6 }, 1000);
    fresh.resetForNewRoom();
    check(
      "reset for a new room clears the cursor and versions",
      fresh.cursor === 0 && fresh.version("patients:s6") === undefined,
    );
    check(
      "reset keeps unsent changes and drops their base",
      fresh.pending().length === 1 && fresh.pending()[0].baseTs === null,
    );
    const dropped = new DeviceSync("D", 0);
    check(
      "a snapshot after a counter restart does not reuse seqs",
      Number.isInteger(
        DeviceSync.fromSnapshot({ ...dropped.snapshot(), devSeq: 0 }).write("x:1", 1, 1).devSeq,
      ) &&
        DeviceSync.fromSnapshot({ ...dropped.snapshot(), devSeq: 0 }).write("x:1", 1, 1).devSeq >=
          1,
    );
  }

  // ---- record keys, room addresses, stable JSON --------------------------
  {
    check("split key keeps colons in the id", rs.splitKey("patients:a:b")?.id === "a:b");
    check("split key rejects an unknown collection", rs.splitKey("secrets:1") === null);
    check(
      "split key accepts users (synced, Admin-only on the room)",
      rs.splitKey("users:1")?.collection === "users",
    );
    check("split key rejects an empty id", rs.splitKey("patients:") === null);
    check(
      "room address: wss with room path is accepted",
      rs.roomKeyOf("wss://sync.example.org/rooms/kegh-1/ws?token=t") ===
        "wss://sync.example.org/rooms/kegh-1/ws",
    );
    check(
      "room address: http is refused",
      rs.roomKeyOf("https://sync.example.org/rooms/kegh-1/ws?token=t") === null,
    );
    check(
      "room address: bad room id is refused",
      rs.roomKeyOf("wss://h/rooms/BAD_ID/ws?token=t") === null,
    );
    check("room address: not a URL is refused", rs.roomKeyOf("not a url") === null);
    check(
      "stable JSON ignores key order",
      rs.stableJson({ a: 1, b: { c: 2, d: 3 } }) === rs.stableJson({ b: { d: 3, c: 2 }, a: 1 }),
    );
  }

  // ---- journal, apply, reconcile (pure state rules) ----------------------
  {
    const { emptyState } = require(join(dir, "lib/hms/types.js"));
    const base = emptyState();
    const p1 = { id: "p1", name: "Ramesh", createdAt: 1000 };
    const s1 = { ...base, patients: { p1 }, ops: { "patients:p1": 1000 } };
    const shadow = rs.shadowOf(base);
    const e1 = rs.journalEntries(shadow, s1, 5000);
    check(
      "journal: a new record is one entry at its op time",
      e1.length === 1 && e1[0].key === "patients:p1" && e1[0].ts === 1000,
    );
    check("journal: nothing new is no entries", rs.journalEntries(shadow, s1, 5000).length === 0);

    const p1b = { ...p1, name: "Ramesh K" };
    const s2 = { ...s1, patients: { p1: p1b }, ops: { "patients:p1": 2000 } };
    const e2 = rs.journalEntries(shadow, s2, 5000);
    check(
      "journal: an edit is one entry with the new value",
      e2.length === 1 && e2[0].value.name === "Ramesh K" && e2[0].ts === 2000,
    );

    const s3 = { ...s2, patients: {}, deleted: { "patients:p1": 3000 } };
    const e3 = rs.journalEntries(shadow, s3, 5000);
    check(
      "journal: a delete is a null entry at its delete time",
      e3.length === 1 && e3[0].value === null && e3[0].ts === 3000,
    );

    // Remote apply must not echo back to the room.
    const shadow2 = rs.shadowOf(base);
    const update = {
      seq: 7,
      key: "patients:p9",
      current: {
        key: "patients:p9",
        ts: 4000,
        deviceId: "X",
        value: { id: "p9", name: "Remote" },
        seq: 7,
      },
    };
    const applied = rs.applyUpdates(base, shadow2, [update]);
    check("apply: a remote record appears in state", applied.patients["p9"]?.name === "Remote");
    check("apply: sets the op time from the room", applied.ops["patients:p9"] === 4000);
    check(
      "apply: does not echo the change back",
      rs.journalEntries(shadow2, applied, 9000).length === 0,
    );

    const del = {
      seq: 8,
      key: "patients:p9",
      current: { key: "patients:p9", ts: 5000, deviceId: "X", value: null, seq: 8 },
    };
    const removed = rs.applyUpdates(applied, shadow2, [del]);
    check(
      "apply: a tombstone removes the record and records the delete",
      removed.patients["p9"] === undefined && removed.deleted["patients:p9"] === 5000,
    );
    check(
      "apply: a tombstone does not echo back",
      rs.journalEntries(shadow2, removed, 9000).length === 0,
    );
    const junk = {
      seq: 9,
      key: "patients:p8",
      current: { key: "patients:p8", ts: 1, deviceId: "X", value: "not a record", seq: 9 },
    };
    check(
      "apply: a non-record value is skipped",
      rs.applyUpdates(base, rs.shadowOf(base), [junk]).patients["p8"] === undefined,
    );

    // Reconcile on connect: send what the room lacks or has differently.
    const local = rs.localEntries(s1, 9000);
    const noServer = () => undefined;
    check(
      "reconcile: a record the room lacks is sent",
      rs.reconcileEntries(local, noServer, new Set()).length === 1,
    );
    const sameVersion = (key) =>
      key === "patients:p1" ? { key, ts: 1, deviceId: "Y", value: p1, seq: 1 } : undefined;
    check(
      "reconcile: an identical room version is not sent",
      rs.reconcileEntries(local, sameVersion, new Set()).length === 0,
    );
    const diffVersion = (key) =>
      key === "patients:p1" ? { key, ts: 1, deviceId: "Y", value: p1b, seq: 1 } : undefined;
    check(
      "reconcile: a differing room version is sent (conflict check)",
      rs.reconcileEntries(local, diffVersion, new Set()).length === 1,
    );
    check(
      "reconcile: keys already queued are not sent twice",
      rs.reconcileEntries(local, noServer, new Set(["patients:p1"])).length === 0,
    );
    const tomb = rs.localEntries({ ...base, deleted: { "patients:gone": 100 } }, 9000);
    check(
      "reconcile: a local delete the room lacks is not sent",
      rs.reconcileEntries(tomb, noServer, new Set()).length === 0,
    );
    // Connect snapshot: a record that only matches this device's old view is not a change.
    const oldView = (key) =>
      key === "patients:p1" ? { key, ts: 1, deviceId: "Y", value: p1, seq: 1 } : undefined;
    check(
      "connect snapshot: an unedited record is not re-sent when the room has moved on",
      rs.unsyncedEntries(s1, oldView, new Set(), 9000).length === 0,
    );
    check(
      "connect snapshot: a record edited since the last sync is sent",
      rs.unsyncedEntries(s2, oldView, new Set(), 9000).length === 1,
    );
    check(
      "connect snapshot: a record the room never had is sent",
      rs.unsyncedEntries(s1, noServer, new Set(), 9000).length === 1,
    );
    check(
      "connect snapshot: a queued record is not sent twice",
      rs.unsyncedEntries(s2, oldView, new Set(["patients:p1"]), 9000).length === 0,
    );
    // Phase 5: connect-time reconcile, as the store runs it. A device that never
    // connected holds an older copy of a record (for example from a Drive file).
    // The room has a newer edit from another device. Connecting must not turn the
    // old copy into a conflict.
    const connectRun = (room, device, snapshotState, bulk) => {
      const reconcile = new rs.ConnectReconcile();
      reconcile.begin(
        rs.unsyncedEntries(snapshotState, (k) => device.version(k), device.pendingKeys(), 9000),
      );
      if (bulk) reconcile.queue(rs.localEntries(bulk, 9000));
      for (const u of room.since(0)) device.receive(u);
      for (const e of reconcile.finish((k) => device.version(k), device.pendingKeys())) {
        device.importLocal(e.key, e.value, e.ts);
      }
      for (const c of device.pending()) {
        const r = room.submit(c);
        device.ack(c, r);
      }
    };
    {
      const room = new RoomLog();
      const y = new DeviceSync("Y", 0);
      const yc = y.write("patients:p1", { ...p1, name: "Newer name" }, 200);
      y.ack(yc, room.submit(yc));
      const old = { ...base, patients: { p1 }, ops: { "patients:p1": 100 } };
      connectRun(room, new DeviceSync("X", 1000), old, null);
      check(
        "connect: an older never-synced copy is not a conflict against a newer room edit",
        room.conflicts.length === 0 && room.get("patients:p1")?.value?.name === "Newer name",
      );

      // A copy newer than the room's version is a real change: it is flagged.
      const room2 = new RoomLog();
      const y2 = new DeviceSync("Y", 0);
      room2.submit(y2.write("patients:p1", { ...p1, name: "Room name" }, 200));
      const newer = {
        ...base,
        patients: { p1: { ...p1, name: "Drive name" } },
        ops: { "patients:p1": 300 },
      };
      connectRun(room2, new DeviceSync("X", 1000), newer, null);
      check(
        "connect: a newer never-synced copy is still flagged as a conflict",
        room2.conflicts.length === 1 && room2.get("patients:p1")?.value?.name === "Drive name",
      );

      // A bulk merge that lands while catching up is not lost: it is sent after catch-up.
      const room3 = new RoomLog();
      const y3 = new DeviceSync("Y", 0);
      room3.submit(y3.write("patients:p1", { ...p1, name: "Room name" }, 200));
      const merged = {
        ...base,
        patients: {
          p1: { ...p1, name: "Merged name" },
          p2: { id: "p2", name: "Only in Drive", createdAt: 150 },
        },
        ops: { "patients:p1": 300, "patients:p2": 150 },
      };
      const x3 = new DeviceSync("X", 1000);
      connectRun(room3, x3, base, merged);
      check(
        "connect: a bulk merge made during catch-up reaches the room",
        room3.get("patients:p2")?.value?.name === "Only in Drive" &&
          room3.get("patients:p1")?.value?.name === "Merged name",
      );

      // Reload: the snapshot is saved on a delay, so a reload soon after a change
      // restores an older counter. The next edit must not reuse a sequence number the
      // room has already seen, or the room drops it as a duplicate and the edit is lost.
      {
        const room = new RoomLog();
        const d = new DeviceSync("R", 1000);
        const early = d.snapshot();
        const c1 = d.write("patients:p1", { ...p1, name: "Before reload" }, 2000);
        d.ack(c1, room.submit(c1));
        const restored = DeviceSync.fromSnapshot(early);
        const c2 = restored.write("patients:p1", { ...p1, name: "After reload" }, 3000);
        const r2 = room.submit(c2);
        check(
          "reload: an edit made right after a reload is not dropped as a duplicate",
          r2.outcome !== "duplicate" && room.get("patients:p1")?.value?.name === "After reload",
        );
      }
      // Phase 6: shadow run. Compare a Drive state with the room's versions (read-only).
      {
        const sh = require(join(dir, "lib/hms/shadow.js"));
        const live = (id, ts, name) => ({ key: `patients:${id}`, value: { id, name }, ts });
        const drive = {
          ...base,
          patients: {
            same: { id: "same", name: "S" },
            onlyD: { id: "onlyD", name: "D" },
            dNew: { id: "dNew", name: "Drive" },
            rNew: { id: "rNew", name: "Drive" },
            tie: { id: "tie", name: "Drive" },
          },
          staff: { s1: { id: "s1", name: "Staff" } },
          ops: {
            "patients:same": 100,
            "patients:onlyD": 100,
            "patients:dNew": 300,
            "patients:rNew": 100,
            "patients:tie": 100,
            "staff:s1": 100,
          },
          deleted: { "patients:gone": 300, "patients:fresh": 300 },
        };
        const room = new Map(
          [
            { key: "patients:same", ts: 100, value: { id: "same", name: "S" } },
            { key: "patients:dNew", ts: 200, value: { id: "dNew", name: "Room" } },
            { key: "patients:rNew", ts: 200, value: { id: "rNew", name: "Room" } },
            { key: "patients:tie", ts: 100, value: { id: "tie", name: "Room" } },
            { key: "patients:gone", ts: 200, value: { id: "gone", name: "Room" } },
            { key: "patients:onlyR", ts: 100, value: { id: "onlyR", name: "Room" } },
            { key: "patients:roomDel", ts: 150, value: null },
          ].map((v) => [v.key, { ...v, deviceId: "Y", seq: 1 }]),
        );
        const before = JSON.stringify(drive);
        const rep = sh.compareWithRoom(drive, (k) => room.get(k), [...room.keys()]);
        check(
          "shadow: each record lands in the right category",
          JSON.stringify(rep.patients) ===
            JSON.stringify({
              same: 1,
              onlyDrive: 1,
              onlyRoom: 1,
              driveNewer: 2,
              roomNewer: 1,
              sameTime: 1,
            }),
        );
        check(
          "shadow: a Drive-only record in another collection is counted",
          JSON.stringify(rep.staff) ===
            JSON.stringify({
              same: 0,
              onlyDrive: 1,
              onlyRoom: 0,
              driveNewer: 0,
              roomNewer: 0,
              sameTime: 0,
            }),
        );
        check(
          "shadow: a record deleted on both sides is not counted",
          rep.patients.onlyRoom === 1 && sh.totalsOf(rep).onlyDrive === 2,
        );
        check("shadow: the comparison does not change its input", JSON.stringify(drive) === before);
        const empty = sh.compareWithRoom(drive, () => undefined, []);
        check(
          "shadow: an empty room shows every live Drive record as only in Drive",
          sh.totalsOf(empty).onlyDrive === 6 && sh.totalsOf(empty).onlyRoom === 0,
        );
      }

      // Outside a connect window, queueing does nothing.
      const idle = new rs.ConnectReconcile();
      idle.queue(rs.localEntries(merged, 9000));
      check(
        "connect: nothing queued outside a connect window",
        idle.finish(() => undefined, new Set()).length === 0,
      );
    }
    const liveGone = (key) =>
      key === "patients:gone"
        ? { key, ts: 1, deviceId: "Y", value: { id: "gone" }, seq: 1 }
        : undefined;
    check(
      "reconcile: a local delete the room still has is sent",
      rs.reconcileEntries(tomb, liveGone, new Set()).length === 1,
    );
  }

  // ---- conflicts for review (phase 3) ------------------------------------
  {
    const room = new RoomLog();
    const a = new DeviceSync("A", 0);
    const b = new DeviceSync("B", 0);
    const first = room.submit(a.write("patients:c1", { name: "Old" }, 1000));
    b.receive(first.update);
    // B edits from the version it has, A edits later from the same base: a conflict.
    const later = room.submit(a.write("patients:c1", { name: "A newer" }, 3000));
    const stale = room.submit(b.write("patients:c1", { name: "B older" }, 2000));
    check(
      "room: an accepted update carries no losing version",
      first.update.other === undefined && later.update.other === undefined,
    );
    check(
      "room: a conflict update carries the losing version",
      stale.outcome === "conflict" && stale.update.other?.value?.name === "B older",
    );
    check(
      "room: the kept version is the newer edit",
      stale.update.current.value.name === "A newer",
    );

    const observer = new DeviceSync("O", 0);
    for (const u of room.since(0)) observer.receive(u);
    const list = observer.conflictList();
    check(
      "device: a catch-up conflict is recorded for review",
      list.length === 1 && list[0].reviewed === false,
    );
    check(
      "device: the record keeps both versions",
      list[0].kept.value.name === "A newer" && list[0].other.value.name === "B older",
    );
    observer.markReviewed(list[0].seq);
    check(
      "device: marking reviewed is local and sticks",
      observer.conflictList()[0].reviewed === true,
    );
    observer.markReviewed(999);
    check("device: marking an unknown conflict does nothing", observer.conflictList().length === 1);

    const snap = JSON.parse(JSON.stringify(observer.snapshot()));
    const restored = DeviceSync.fromSnapshot(snap);
    check(
      "device: snapshot keeps conflicts and review state",
      restored.conflictList()[0]?.reviewed === true,
    );
    check(
      "device: an older snapshot without conflicts still loads",
      DeviceSync.fromSnapshot({ ...snap, conflicts: undefined, reviewed: undefined }).conflictList()
        .length === 0,
    );

    const dup = room.since(0).find((u) => u.other);
    check(
      "device: a repeated conflict update is not recorded twice",
      (observer.receive(dup), observer.conflictList().length === 1),
    );

    observer.resetForNewRoom();
    check("device: a reset room clears conflicts", observer.conflictList().length === 0);
  }

  // ---- resolving a conflict and showing the difference (phase 3) --------
  {
    const { emptyState } = require(join(dir, "lib/hms/types.js"));
    const base = {
      ...emptyState(),
      patients: { p1: { id: "p1", name: "Ramesh", createdAt: 1 } },
      ops: { "patients:p1": 500 },
    };
    const chosen = rs.setRecord(
      base,
      "patients:p1",
      { id: "p1", name: "Ramesh K", createdAt: 1 },
      9000,
    );
    check("resolve: choosing a version sets the record", chosen.patients.p1.name === "Ramesh K");
    check(
      "resolve: the choice is the newest edit (op time is now)",
      chosen.ops["patients:p1"] === 9000,
    );
    const shadow = rs.shadowOf(base);
    check(
      "resolve: the choice is journaled as one change",
      rs.journalEntries(shadow, chosen, 9000).length === 1,
    );
    const removed = rs.setRecord(base, "patients:p1", null, 9000);
    check(
      "resolve: a deleted version removes the record and records the delete",
      removed.patients.p1 === undefined && removed.deleted["patients:p1"] === 9000,
    );
    check(
      "resolve: a non-record value does not change state",
      rs.setRecord(base, "patients:p1", "text", 9000) === base,
    );
    check(
      "resolve: an unknown key does not change state",
      rs.setRecord(base, "secrets:1", { x: 1 }, 9000) === base,
    );
    const diff = rs.changedFields(
      { id: "p1", name: "Ramesh", phone: "1", createdAt: 1 },
      { id: "p1", name: "Ramesh K", phone: "1", createdAt: 2 },
    );
    check(
      "diff: only the field that differs is listed",
      diff.length === 1 &&
        diff[0].field === "name" &&
        diff[0].a === "Ramesh" &&
        diff[0].b === "Ramesh K",
    );
    check(
      "diff: a field missing on one side is listed",
      rs.changedFields({ a: 1 }, { a: 1, b: 2 }).some((d) => d.field === "b"),
    );
    check(
      "diff: equal records have no differences",
      rs.changedFields({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }).length === 0,
    );
  }

  // ---- staff sign-in, change policy and refused changes (design phase 4) --
  {
    const now = 1_700_000_000_000;
    const secret = "test-secret";
    const salt = newSaltHex();
    const admin = {
      id: "u-admin",
      username: "admin",
      displayName: "Admin",
      role: "Admin",
      passwordHash: await hashPassword("admin-pass", salt),
      salt,
      active: true,
      createdAt: 1,
    };
    const reception = {
      ...admin,
      id: "u-rec",
      username: "rec",
      displayName: "Rec",
      role: "Reception",
      active: true,
    };
    const ch = (key, value, extra = {}) => ({
      deviceId: "d1",
      devSeq: 1,
      key,
      ts: now,
      baseTs: null,
      value,
      ...extra,
    });

    const token = await sa.issueSession(secret, "u-admin", now);
    const claims = await sa.readSession(secret, token, now + 1000);
    check(
      "session: a fresh token reads back its user",
      claims?.userId === "u-admin" && claims.iat === now,
    );
    check(
      "session: a tampered token is refused",
      (await sa.readSession(secret, token.slice(0, -2) + "xx", now)) === null,
    );
    check(
      "session: a token from another secret is refused",
      (await sa.readSession("other", token, now)) === null,
    );
    check(
      "session: an expired token is refused",
      (await sa.readSession(secret, token, now + sa.SESSION_MS)) === null,
    );
    check(
      "session: garbage is refused, not thrown",
      (await sa.readSession(secret, "not-a-token", now)) === null,
    );

    check("live: an active account is signed in", sa.liveSessionUser(admin, claims) !== null);
    check(
      "live: a deactivated account is signed out",
      sa.liveSessionUser({ ...admin, active: false }, claims) === null,
    );
    check(
      "live: a session begun before a force sign-out is dropped",
      sa.liveSessionUser({ ...admin, sessionsKickedAt: now + 500 }, claims) === null,
    );
    check(
      "live: a session begun after the force sign-out stamp still works",
      sa.liveSessionUser({ ...admin, sessionsKickedAt: now - 500 }, claims) !== null,
    );
    check("live: an unknown account is signed out", sa.liveSessionUser(undefined, claims) === null);

    check("password: the right password matches", await sa.passwordMatches(admin, "admin-pass"));
    check("password: a wrong password does not match", !(await sa.passwordMatches(admin, "guess")));
    check(
      "password: an inactive account never matches",
      !(await sa.passwordMatches({ ...admin, active: false }, "admin-pass")),
    );

    check("record: a complete user record is accepted", sa.isUserRecord(admin));
    check("record: an unknown role is refused", !sa.isUserRecord({ ...admin, role: "Janitor" }));
    check(
      "record: a missing hash is refused",
      !sa.isUserRecord({ ...admin, passwordHash: undefined }),
    );

    const decide = (role, change, current) => sa.authorizeChange(role, change, current);
    check(
      "policy: Reception may add a patient",
      decide("Reception", ch("patients:p1", { name: "R" })).ok,
    );
    check("policy: Admin may write a user", decide("Admin", ch("users:u2", reception)).ok);
    check(
      "policy: Reception may not write a user",
      !decide("Reception", ch("users:u2", reception)).ok,
    );
    check(
      "policy: Doctor may not write staff records",
      !decide("Doctor", ch("staff:s1", { name: "x" })).ok,
    );
    check(
      "policy: Billing may not write payroll",
      !decide("Billing", ch("payrolls:p1", { amount: 1 })).ok,
    );
    check("policy: Admin may write payroll", decide("Admin", ch("payrolls:p1", { amount: 1 })).ok);
    check(
      "policy: an audit entry can be added",
      decide("Reception", ch("auditLogs:a1", { action: "login" })).ok,
    );
    check(
      "policy: an audit entry cannot be changed",
      !decide("Admin", ch("auditLogs:a1", { action: "x" }, { baseTs: now }), {
        key: "auditLogs:a1",
        ts: now,
        deviceId: "d1",
        value: {},
        seq: 1,
      }).ok,
    );
    check(
      "policy: an audit entry cannot be re-added over an existing one",
      !decide("Admin", ch("auditLogs:a1", { action: "x" }), {
        key: "auditLogs:a1",
        ts: now,
        deviceId: "d1",
        value: {},
        seq: 1,
      }).ok,
    );
    check(
      "policy: an audit entry cannot be deleted",
      !decide("Admin", ch("auditLogs:a1", null, { baseTs: now })).ok,
    );

    // ---- per-field role rules (phase 4b, item 3) ----
    const fr = require(join(dir, "lib/hms/field-rules.js"));
    const { readFileSync } = await import("node:fs");
    const base = now - 1000;
    const cur = (key, value) => ({ key, ts: base, deviceId: "d0", value, seq: 1 });
    const upd = (key, value) => ch(key, value, { baseTs: base });
    const patient = {
      id: "p1",
      name: "Ana",
      mrn: "M1",
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
    check(
      "fields: Reception may create a patient with blank clinical fields",
      decide(
        "Reception",
        ch("patients:p2", { ...patient, id: "p2", bloodGroup: "", allergies: "" }),
      ).ok,
    );
    check(
      "fields: Reception may not create a patient with allergies",
      !decide("Reception", ch("patients:p2", { ...patient, id: "p2" })).ok,
    );
    check(
      "fields: Reception may change a patient's phone",
      decide(
        "Reception",
        upd("patients:p1", { ...patient, phone: "2" }),
        cur("patients:p1", patient),
      ).ok,
    );
    check(
      "fields: Reception may not change a patient's allergies",
      !decide(
        "Reception",
        upd("patients:p1", { ...patient, allergies: "dust" }),
        cur("patients:p1", patient),
      ).ok,
    );
    check(
      "fields: Doctor may change a patient's allergies",
      decide(
        "Doctor",
        upd("patients:p1", { ...patient, allergies: "dust" }),
        cur("patients:p1", patient),
      ).ok,
    );
    check(
      "fields: one refused field refuses the whole change",
      !decide(
        "Reception",
        upd("patients:p1", { ...patient, phone: "2", allergies: "dust" }),
        cur("patients:p1", patient),
      ).ok,
    );
    check(
      "fields: Reception may not delete a patient",
      !decide("Reception", ch("patients:p1", null, { baseTs: base }), cur("patients:p1", patient))
        .ok,
    );
    check(
      "fields: Admin may delete a patient",
      decide("Admin", ch("patients:p1", null, { baseTs: base }), cur("patients:p1", patient)).ok,
    );
    const visit = {
      id: "v1",
      patientId: "p1",
      date: "2026-10-01",
      type: "OPD",
      doctor: "Dr A",
      department: "",
      diagnosis: "",
      notes: "",
      createdAt: 1,
    };
    check(
      "fields: Reception may open a visit with a blank diagnosis",
      decide("Reception", ch("visits:v2", { ...visit, id: "v2" })).ok,
    );
    check(
      "fields: Reception may not write a visit's diagnosis",
      !decide("Reception", ch("visits:v2", { ...visit, id: "v2", diagnosis: "fever" })).ok,
    );
    check(
      "fields: Nursing may not change a visit's diagnosis",
      !decide(
        "Nursing",
        upd("visits:v1", { ...visit, diagnosis: "fever" }),
        cur("visits:v1", visit),
      ).ok,
    );
    check(
      "fields: Doctor may change a visit's diagnosis",
      decide("Doctor", upd("visits:v1", { ...visit, diagnosis: "fever" }), cur("visits:v1", visit))
        .ok,
    );
    const rx = {
      id: "rx1",
      patientId: "p1",
      visitId: "v1",
      date: "2026-10-01",
      doctor: "Dr A",
      diagnosis: "fever",
      items: [{ name: "Paracetamol" }],
      notes: "",
      signOff: "Dr A",
      itemDispensed: [false],
      createdAt: 1,
    };
    check(
      "fields: Pharmacy may mark a prescription item dispensed",
      decide(
        "Pharmacy",
        upd("prescriptions:rx1", { ...rx, itemDispensed: [true] }),
        cur("prescriptions:rx1", rx),
      ).ok,
    );
    check(
      "fields: Pharmacy may not change a prescription's items",
      !decide(
        "Pharmacy",
        upd("prescriptions:rx1", { ...rx, items: [{ name: "X" }] }),
        cur("prescriptions:rx1", rx),
      ).ok,
    );
    check(
      "fields: Doctor may not mark a prescription item dispensed",
      !decide(
        "Doctor",
        upd("prescriptions:rx1", { ...rx, itemDispensed: [true] }),
        cur("prescriptions:rx1", rx),
      ).ok,
    );
    const order = {
      id: "lo1",
      patientId: "p1",
      visitId: "v1",
      date: "2026-10-01",
      tests: "CBC",
      priority: "Routine",
      status: "Ordered",
      orderedBy: "Dr A",
      notes: "",
      createdAt: 1,
    };
    check(
      "fields: Lab may move an order to collected",
      decide(
        "Lab",
        upd("labOrders:lo1", { ...order, status: "Collected" }),
        cur("labOrders:lo1", order),
      ).ok,
    );
    check(
      "fields: Lab may not change the tests ordered",
      !decide("Lab", upd("labOrders:lo1", { ...order, tests: "LFT" }), cur("labOrders:lo1", order))
        .ok,
    );
    const bill = {
      id: "b1",
      patientId: "p1",
      visitId: "v1",
      date: "2026-10-01",
      items: [{ n: 1 }],
      totalAmount: 100,
      paid: 0,
      due: 100,
      paymentMode: "",
      createdAt: 1,
    };
    check(
      "fields: Billing may change bill items",
      decide("Billing", upd("bills:b1", { ...bill, items: [{ n: 2 }] }), cur("bills:b1", bill)).ok,
    );
    check(
      "fields: Reception may change bill items (charge posting, approved)",
      decide("Reception", upd("bills:b1", { ...bill, items: [{ n: 2 }] }), cur("bills:b1", bill))
        .ok,
    );
    check(
      "fields: Reception may record a payment",
      decide("Reception", upd("bills:b1", { ...bill, paid: 100, due: 0 }), cur("bills:b1", bill))
        .ok,
    );
    const appt = {
      id: "a1",
      patientId: "p1",
      date: "2026-10-01",
      time: "09:00",
      doctor: "Dr A",
      department: "",
      type: "OPD",
      status: "Booked",
      notes: "",
      tokenNo: 1,
      tokenTime: "09:00",
      createdAt: 1,
    };
    check(
      "fields: Reception may delete an appointment",
      decide(
        "Reception",
        ch("appointments:a1", null, { baseTs: base }),
        cur("appointments:a1", appt),
      ).ok,
    );
    check(
      "fields: Doctor may not delete an appointment",
      !decide("Doctor", ch("appointments:a1", null, { baseTs: base }), cur("appointments:a1", appt))
        .ok,
    );
    const note = {
      id: "h1",
      date: "2026-10-01",
      time: "08:00",
      author: "Nurse A",
      role: "Nursing",
      category: "Handover",
      patientId: "p1",
      text: "check drain",
      resolved: false,
      createdAt: 1,
    };
    check(
      "fields: Nursing may write a handover note with its author",
      decide("Nursing", ch("handoverNotes:h2", { ...note, id: "h2" })).ok,
    );
    check(
      "fields: a handover note's author cannot change afterwards",
      !decide(
        "Nursing",
        upd("handoverNotes:h1", { ...note, author: "Nurse B" }),
        cur("handoverNotes:h1", note),
      ).ok,
    );
    check(
      "fields: Lab may resolve a handover note",
      decide(
        "Lab",
        upd("handoverNotes:h1", { ...note, resolved: true, resolvedBy: "Lab A" }),
        cur("handoverNotes:h1", note),
      ).ok,
    );
    check(
      "fields: Lab may not change a handover note's text",
      !decide("Lab", upd("handoverNotes:h1", { ...note, text: "x" }), cur("handoverNotes:h1", note))
        .ok,
    );
    check(
      "fields: Nursing may not delete a handover note",
      !decide(
        "Nursing",
        ch("handoverNotes:h1", null, { baseTs: base }),
        cur("handoverNotes:h1", note),
      ).ok,
    );
    check(
      "fields: Admin may delete a handover note",
      decide("Admin", ch("handoverNotes:h1", null, { baseTs: base }), cur("handoverNotes:h1", note))
        .ok,
    );
    check(
      "fields: Reception may not change a service rate",
      !decide("Reception", ch("serviceRates:r1", { section: "OT", item: "x", rate: 5 })).ok,
    );
    check(
      "fields: Admin may change a service rate",
      decide("Admin", ch("serviceRates:r1", { section: "OT", item: "x", rate: 5 })).ok,
    );
    const bed = {
      id: "bd1",
      ward: "W1",
      room: "101",
      label: "101-A",
      rate: 500,
      active: true,
      notes: "",
      createdAt: 1,
    };
    check(
      "fields: Reception may not change a bed's rate",
      !decide("Reception", upd("beds:bd1", { ...bed, rate: 600 }), cur("beds:bd1", bed)).ok,
    );
    check(
      "fields: Reception may change a bed's label",
      decide("Reception", upd("beds:bd1", { ...bed, label: "101-B" }), cur("beds:bd1", bed)).ok,
    );
    check(
      "fields: Pharmacy may change a medicine; Doctor may not",
      decide("Pharmacy", ch("meds:m1", { name: "Paracetamol", saleRate: 2 })).ok &&
        !decide("Doctor", ch("meds:m1", { name: "Paracetamol", saleRate: 2 })).ok,
    );
    check(
      "fields: a field with no rule is refused for everyone but Admin",
      !decide("Reception", ch("patients:p9", { name: "x", surprise: "y" })).ok &&
        decide("Admin", ch("patients:p9", { name: "x", surprise: "y" })).ok,
    );
    // Charge posting (approved in phase 4b, item 3): the lab, imaging and IPD flows
    // write bills with items, and link the charge back onto the order or admission.
    const chargeBill = {
      id: "bl1",
      patientId: "p1",
      visitId: "v1",
      date: "2026-10-01",
      items: [{ n: 1 }],
      totalAmount: 50,
      discount: 0,
      tax: 0,
      paid: 0,
      due: 50,
      paymentMode: "Cash",
      createdAt: 1,
    };
    check(
      "fields: Lab may post a lab charge as a new bill",
      decide("Lab", ch("bills:bl1", chargeBill)).ok,
    );
    check(
      "fields: Lab may link the lab charge to its order",
      decide(
        "Lab",
        upd("labOrders:lo1", { ...order, labChargeBillId: "bl1" }),
        cur("labOrders:lo1", order),
      ).ok,
    );
    check(
      "fields: Nursing may post a bed charge as a new bill",
      decide("Nursing", ch("bills:bl1", chargeBill)).ok,
    );
    check(
      "fields: Doctor may post a bed charge and link it to the admission",
      decide(
        "Doctor",
        upd("admissions:ad1", { id: "ad1", bedChargeBillId: "bl1" }),
        cur("admissions:ad1", { id: "ad1" }),
      ).ok,
    );
    check(
      "fields: Pharmacy may not post a charge to a bill",
      !decide("Pharmacy", ch("bills:bl1", chargeBill)).ok,
    );
    check(
      "fields: Reception may not write a bill's discount",
      !decide("Reception", ch("bills:bl1", { ...chargeBill, discount: 5 })).ok,
    );
    check(
      "fields: Billing may write a bill's discount",
      decide("Billing", ch("bills:bl1", { ...chargeBill, discount: 5 })).ok,
    );
    check(
      "fields: Reception may admit a patient with a reason and doctor",
      decide(
        "Reception",
        ch("admissions:ad2", {
          id: "ad2",
          patientId: "p1",
          bedId: "bd1",
          admitDate: "2026-10-01",
          admitTime: "08:00",
          reason: "fever",
          doctor: "Dr A",
          status: "Admitted",
        }),
      ).ok,
    );
    check(
      "fields: Nursing may not write an admission's reason",
      !decide(
        "Nursing",
        upd("admissions:ad1", { id: "ad1", reason: "fever" }),
        cur("admissions:ad1", { id: "ad1" }),
      ).ok,
    );
    // Known gap, not yet decided: the IPD discharge writes Doctor-only fields, and the
    // Discharge button is shown to every role on the IPD page. This records the current rule.
    check(
      "fields: Reception may not write a discharge summary (current rule, decision pending)",
      !decide(
        "Reception",
        upd("admissions:ad1", { id: "ad1", dischargeSummary: "ok" }),
        cur("admissions:ad1", { id: "ad1" }),
      ).ok,
    );
    // Coverage: every field of every synced record type (except auditLogs) has an entry in FIELD_RULES.
    {
      const src = readFileSync("src/lib/hms/types.ts", "utf8");
      const hms = src.slice(src.indexOf("export interface HmsState"));
      const body = hms.slice(0, hms.indexOf("\n}"));
      const missing = [];
      for (const [, collection, typeName] of body.matchAll(/^\s+(\w+): Record<ID, (\w+)>;/gm)) {
        if (collection === "auditLogs") continue;
        const m = src.match(
          new RegExp("^export interface " + typeName + " \\{\\n([\\s\\S]*?)^\\}", "m"),
        );
        if (!m) {
          missing.push(`${collection}: no interface ${typeName}`);
          continue;
        }
        for (const [, field] of m[1].matchAll(/^\s+(\w+)\??:/gm)) {
          if (field === "id" || field === "createdAt") continue;
          if (!fr.FIELD_RULES[collection] || !(field in fr.FIELD_RULES[collection])) {
            missing.push(`${collection}.${field}`);
          }
        }
      }
      check("fields: every field of every synced record type has a rule", missing.length === 0);
      if (missing.length) console.error("  no rule for:", missing.join(", "));
    }
    check("policy: an unknown record is refused", !decide("Admin", ch("secrets:x", { a: 1 })).ok);

    // A refused change: the device drops it and takes the room's version.
    const dev = new DeviceSync("refuser", 0);
    dev.write("patients:r1", { name: "Local edit" }, now);
    const sent = dev.pending()[0];
    const roomVersion = {
      key: "patients:r1",
      ts: now - 10,
      deviceId: "other",
      value: { name: "Room" },
      seq: 7,
    };
    const applied = dev.ack(sent, {
      outcome: "denied",
      seq: 0,
      reason: "test",
      update: { seq: 7, key: "patients:r1", current: roomVersion },
    });
    check("refusal: the outbox drops the refused change", dev.pending().length === 0);
    check(
      "refusal: the record takes the room's version",
      applied && dev.read("patients:r1")?.name === "Room",
    );
    dev.write("patients:r2", { name: "Never there" }, now);
    const sent2 = dev.pending()[0];
    dev.ack(sent2, {
      outcome: "denied",
      seq: 0,
      reason: "test",
      update: {
        seq: 0,
        key: "patients:r2",
        current: { key: "patients:r2", ts: 0, deviceId: "room", value: null, seq: 0 },
      },
    });
    check("refusal: a record the room never had is removed", dev.read("patients:r2") === null);
  }

  // ---- connection client against an in-process room ----------------------
  {
    const roomLog = new RoomLog();
    const sockets = new Set();
    const socketOf = new Map();
    class FakeSocket {
      constructor(deviceKey) {
        this.deviceKey = deviceKey;
        this.closed = false;
        this.sent = [];
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
      }
      send(text) {
        if (this.closed) throw new Error("socket closed");
        const msg = JSON.parse(text);
        this.sent.push(msg);
        queueMicrotask(() => handle(this, msg));
      }
      close() {
        if (this.closed) return;
        this.closed = true;
        sockets.delete(this);
      }
      emit(obj) {
        if (!this.closed) this.onmessage?.({ data: JSON.stringify(obj) });
      }
      drop() {
        this.close();
        this.onclose?.({});
      }
    }
    const fakeUser = { id: "u1", username: "ana", displayName: "Ana", role: "Admin" };
    const handle = (socket, msg) => {
      if (socket.closed) return;
      if (msg.type === "login") {
        if (msg.username === "ana" && msg.password === "pw") {
          socket.authed = true;
          socket.emit({ type: "session", token: "t-ana", user: fakeUser });
        } else {
          socket.emit({
            type: "error",
            code: "invalid-login",
            message: "Wrong username or password.",
          });
        }
        return;
      }
      if (msg.type === "auth") {
        if (String(msg.token).startsWith("t-")) {
          socket.authed = true;
          socket.emit({ type: "session", token: msg.token, user: fakeUser });
        } else {
          socket.emit({ type: "error", code: "sign-in-required", message: "Sign in to sync." });
        }
        return;
      }
      if ((msg.type === "hello" || msg.type === "submit") && !socket.authed) {
        socket.emit({ type: "error", code: "sign-in-required", message: "Sign in to sync." });
        return;
      }
      if (msg.type === "hello") {
        socketOf.set(msg.deviceId, socket);
        socket.emit({
          type: "catchup",
          updates: roomLog.since(msg.cursor),
          lastSeq: roomLog.lastSeq,
        });
      } else if (msg.type === "submit") {
        const result = roomLog.submit(msg.change);
        socket.emit({
          type: "ack",
          deviceId: msg.change.deviceId,
          devSeq: msg.change.devSeq,
          result,
        });
        if (result.update)
          for (const s of sockets) s.emit({ type: "update", update: result.update });
      } else if (msg.type === "ping") {
        socket.emit({ type: "pong" });
      }
    };
    let socketsMade = 0;
    const makeSocket = () => {
      socketsMade++;
      const s = new FakeSocket(null);
      sockets.add(s);
      setTimeout(() => s.onopen?.({}), 0);
      return s;
    };
    const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

    const clients = [];
    const make = (deviceId, startSeq = 0, token = `t-${deviceId}`) => {
      const info = {
        applied: [],
        caught: 0,
        connecting: 0,
        status: null,
        journals: 0,
        sessions: [],
      };
      const device = new DeviceSync(deviceId, startSeq);
      const client = new RealtimeClient({
        url: "wss://room.example/rooms/t/ws?token=x",
        device,
        token,
        makeSocket,
        random: () => 0.5,
        hooks: {
          onUpdates: (us) => info.applied.push(...us),
          onConnecting: () => info.connecting++,
          onCaughtUp: () => info.caught++,
          onStatus: (s) => (info.status = s),
          onJournal: () => info.journals++,
          onSession: (t) => info.sessions.push(t),
        },
      });
      clients.push(client);
      return { device, client, info };
    };

    const a = make("A", 0);
    const b = make("B", 0);
    a.client.start();
    b.client.start();
    await tick(30);
    check("client: both devices reach online", a.client.connected && b.client.connected);
    check("client: connecting hook ran once per connection", a.info.connecting === 1);

    a.device.write("patients:live", { name: "Live" }, 1000);
    a.client.notifyLocal();
    await tick();
    check(
      "client: the other device gets the change without waiting for a timer",
      b.info.applied.some((u) => u.key === "patients:live"),
    );
    check(
      "client: the sender's outbox empties on ack",
      a.device.pending().length === 0 && a.info.status.pending === 0,
    );

    // Offline: the change waits and is sent after reconnect.
    socketOf.get("A").drop();
    a.device.write("patients:offline", { name: "Offline" }, 2000);
    a.client.notifyLocal();
    await tick(5);
    check(
      "client: an offline change waits in the outbox",
      a.device.pending().length === 1 && roomLog.get("patients:offline") === undefined,
    );
    check(
      "client: status shows offline with the pending count",
      a.info.status.status === "offline" && a.info.status.pending === 1,
    );
    await tick(600);
    check(
      "client: reconnect sends the waiting change",
      roomLog.get("patients:offline")?.value?.name === "Offline" && a.device.pending().length === 0,
    );
    check(
      "client: the other device receives the reconnected change",
      b.info.applied.some((u) => u.key === "patients:offline"),
    );
    check(
      "client: status is online again after catch-up",
      a.client.connected && a.info.status.status === "online",
    );

    // A change the room can never accept is dropped, not retried forever.
    a.device.importLocal("secrets:x", { a: 1 }, 3000);
    a.client.notifyLocal();
    await tick(5);
    check(
      "client: an unsendable change is discarded",
      !a.device.pending().some((c) => c.key === "secrets:x"),
    );
    check("client: the discard is reported", /could not be sent/.test(a.info.status.error ?? ""));

    // Room restarted with less history than this device has seen.
    const c = make("C", 0);
    c.device.cursor = 50;
    c.client.start();
    await tick(30);
    check(
      "client: a reset room resets the device cursor",
      c.device.cursor === roomLog.lastSeq && c.client.connected,
    );
    check("client: a reset room sends the full history again", c.info.applied.length > 0);

    // Sign-in states.
    {
      const before = socketsMade;
      const sx = make("S", 0, null);
      sx.client.start();
      await tick(20);
      check(
        "sign-in: without a session the device does not connect",
        socketsMade === before && sx.info.status.status === "sign-in",
      );
      const wrong = await sx.client.signIn("ana", "nope");
      await tick(20);
      check(
        "sign-in: a wrong password is refused",
        wrong.ok === false &&
          sx.info.status.status === "sign-in" &&
          sx.info.status.signedIn === false,
      );
      const right = await sx.client.signIn("ana", "pw");
      await tick(30);
      check(
        "sign-in: the right password signs in and syncs",
        right.ok === true && sx.client.connected && sx.info.status.signedIn,
      );
      check("sign-in: the session token is handed to the app", sx.info.sessions.at(-1) === "t-ana");
      sx.client.signOut();
      await tick(20);
      check(
        "sign-out: the session is dropped and the socket closed",
        sx.info.sessions.at(-1) === null &&
          sx.info.status.status === "sign-in" &&
          !sx.client.signedIn,
      );

      const stale = make("T", 0, "stale-token");
      const before2 = socketsMade;
      stale.client.start();
      await tick(30);
      const madeWhileStale = socketsMade - before2;
      await tick(700);
      check(
        "sign-in: a rejected token stops reconnecting and asks for sign-in",
        stale.info.status.status === "sign-in" &&
          socketsMade - before2 === madeWhileStale &&
          stale.info.sessions.at(-1) === null,
      );
      stale.client.stop();
      sx.client.stop();
    }

    // Stop: no socket left open, no reconnect.
    a.client.stop();
    await tick(50);
    const countAfterStop = sockets.size;
    await tick(700);
    check(
      "client: stop closes the socket and does not reconnect",
      socketOf.get("A").closed === true &&
        a.info.status.status === "offline" &&
        sockets.size === countAfterStop,
    );
    for (const client of clients) client.stop();
    await tick(20);
  }

  console.log(
    failures === 0 ? "\nAll real-time sync smoke tests passed." : `\n${failures} test(s) FAILED`,
  );
  process.exitCode = failures ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
