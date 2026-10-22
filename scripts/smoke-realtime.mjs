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
  const { createRequire } = await import("node:module");
  const require = createRequire(pathToFileURL(join(dir, "index.js")).href);
  const { RoomLog, DeviceSync } = require(join(dir, "lib/hms/sync-core.js"));

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

  console.log(
    failures === 0 ? "\nAll real-time sync smoke tests passed." : `\n${failures} test(s) FAILED`,
  );
  process.exitCode = failures ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
