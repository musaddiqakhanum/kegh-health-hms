/**
 * Real-time sync core (pure logic, no I/O).
 *
 * Independent of where the server runs (the Durable Object wrapper, WebSocket
 * transport and auth come later; see docs/realtime-sync-design.md):
 *  - RoomLog (server side): one sequenced log per hospital. Every accepted or
 *    conflicting submit gets one sequence number and produces one Update that
 *    carries the *resulting current version* of the record.
 *  - Idempotent submit: a device can retry any change; duplicates return the
 *    original result and emit nothing new.
 *  - Conflicts (warn-and-keep): a change based on an out-of-date version never
 *    silently overwrites. The newer version wins (ties broken by device id) and
 *    the other is preserved in `conflicts` for review.
 *  - DeviceSync (device side): an outbox of unacknowledged changes plus a
 *    per-record view. Updates are applied per record with the highest sequence
 *    number kept, so out-of-order or repeated delivery still converges.
 */

export interface Change {
  /** Device that made the change. */
  deviceId: string;
  /** Per-device counter; (deviceId, devSeq) identifies a change. */
  devSeq: number;
  /** "<collection>:<id>" key of the record. */
  key: string;
  /** Timestamp (ms) of the change on the device. */
  ts: number;
  /** Timestamp of the version the device edited; null when it created the record. */
  baseTs: number | null;
  /** New value, or null for a delete (tombstone). */
  value: unknown | null;
}

export interface Version {
  key: string;
  ts: number;
  deviceId: string;
  value: unknown | null;
  /** Sequence number of the update that produced this version. */
  seq: number;
}

/** Room broadcast: the resulting current version of `key` after sequence `seq`. */
export interface Update {
  seq: number;
  key: string;
  current: Version;
}

export interface Conflict {
  key: string;
  seq: number;
  kept: Version;
  other: Version;
}

export type SubmitOutcome = "accepted" | "duplicate" | "conflict";

export interface SubmitResult {
  outcome: SubmitOutcome;
  /** Sequence number of this change (for duplicates, the original's). */
  seq: number;
  /** Update to broadcast. Undefined for duplicates. */
  update?: Update;
}

/** Tie-break on equal timestamps so every room picks the same winner. */
function beats(a: { ts: number; deviceId: string }, b: { ts: number; deviceId: string }): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  return a.deviceId > b.deviceId;
}

/** Server side: the sequenced, authoritative log for one hospital room. */
export class RoomLog {
  private seqCounter = 0;
  private updates: Update[] = [];
  private current = new Map<string, Version>();
  private seen = new Map<string, number>(); // "deviceId#devSeq" -> seq
  readonly conflicts: Conflict[] = [];

  /**
   * `onAccept` is called once for every change the room accepts (including
   * conflicts), before the result is returned. Use it to persist the change.
   */
  private onAccept: ((seq: number, change: Change) => void) | undefined;

  constructor(onAccept?: (seq: number, change: Change) => void) {
    this.onAccept = onAccept;
  }

  /**
   * Rebuild a room from its persisted accepted changes, in the order they were
   * accepted. Replay is deterministic, so sequence numbers, versions and
   * conflicts come back exactly as they were. The hook is attached only after
   * replay, so nothing is written twice.
   */
  static restore(
    acceptedInOrder: Change[],
    onAccept?: (seq: number, change: Change) => void,
  ): RoomLog {
    const room = new RoomLog();
    for (const change of acceptedInOrder) room.submit(change);
    room.onAccept = onAccept;
    return room;
  }

  submit(change: Change): SubmitResult {
    const dedupe = `${change.deviceId}#${change.devSeq}`;
    const prior = this.seen.get(dedupe);
    if (prior !== undefined) return { outcome: "duplicate", seq: prior };

    const seq = ++this.seqCounter;
    this.seen.set(dedupe, seq);
    this.onAccept?.(seq, change);
    const incoming: Version = {
      key: change.key,
      ts: change.ts,
      deviceId: change.deviceId,
      value: change.value,
      seq,
    };
    const cur = this.current.get(change.key);

    // Plain accept: no record yet, or the device edited the version still current.
    if (cur === undefined || change.baseTs === cur.ts) {
      return this.publish(seq, change.key, incoming, "accepted");
    }

    // Stale base: someone changed the record after this device last saw it.
    const kept = beats(incoming, cur) ? incoming : cur;
    const other = kept === incoming ? cur : incoming;
    this.conflicts.push({ key: change.key, seq, kept, other });
    return this.publish(seq, change.key, kept, "conflict");
  }

  private publish(
    seq: number,
    key: string,
    version: Version,
    outcome: SubmitOutcome,
  ): SubmitResult {
    const update: Update = { seq, key, current: { ...version, seq } };
    this.current.set(key, update.current);
    this.updates.push(update);
    return { outcome, seq, update };
  }

  /** Catch-up: every update after `seq`, in sequence order. */
  since(seq: number): Update[] {
    return this.updates.filter((u) => u.seq > seq);
  }

  /** Current version per record key (tombstones included). */
  get(key: string): Version | undefined {
    return this.current.get(key);
  }

  get lastSeq(): number {
    return this.seqCounter;
  }
}

/** Device side: local view, an outbox of unacknowledged changes, and a catch-up cursor. */
export interface DeviceSnapshot {
  deviceId: string;
  devSeq: number;
  cursor: number;
  versions: Record<string, Version>;
  keySeq: Record<string, number>;
  seenSeqs: number[];
  outbox: Change[];
}

const sameChange = (a: Change, b: Change): boolean =>
  a.deviceId === b.deviceId && a.devSeq === b.devSeq;

export class DeviceSync {
  private versions = new Map<string, Version>();
  private keySeq = new Map<string, number>();
  /** Sequence numbers above `cursor` that were received out of order. */
  private seenSeqs = new Set<number>();
  private outbox: Change[] = [];
  private devSeqCounter: number;
  /** Highest sequence number such that every update up to it has been applied. */
  cursor = 0;

  /** `initialSeq` starts the per-device counter; pass a timestamp for a new device so a lost snapshot cannot reuse old (deviceId, devSeq) pairs. */
  constructor(
    readonly deviceId: string,
    initialSeq = 0,
  ) {
    this.devSeqCounter = initialSeq;
  }

  /** Persistable copy of everything this device needs to resume. */
  snapshot(): DeviceSnapshot {
    return {
      deviceId: this.deviceId,
      devSeq: this.devSeqCounter,
      cursor: this.cursor,
      versions: Object.fromEntries(this.versions),
      keySeq: Object.fromEntries(this.keySeq),
      seenSeqs: [...this.seenSeqs],
      outbox: [...this.outbox],
    };
  }

  static fromSnapshot(snap: DeviceSnapshot): DeviceSync {
    const device = new DeviceSync(snap.deviceId, snap.devSeq);
    device.cursor = snap.cursor;
    device.versions = new Map(Object.entries(snap.versions));
    device.keySeq = new Map(Object.entries(snap.keySeq));
    device.seenSeqs = new Set(snap.seenSeqs.filter((seq) => seq > snap.cursor));
    device.outbox = [...snap.outbox];
    return device;
  }

  /** Local write (value null = delete). Queued for the room. */
  write(key: string, value: unknown | null, now: number): Change {
    const prev = this.versions.get(key);
    const ts = Math.max(now, (prev?.ts ?? 0) + 1);
    const change: Change = {
      deviceId: this.deviceId,
      devSeq: ++this.devSeqCounter,
      key,
      ts,
      baseTs: prev ? prev.ts : null,
      value,
    };
    this.versions.set(key, { key, ts, deviceId: this.deviceId, value, seq: prev?.seq ?? 0 });
    this.outbox.push(change);
    return change;
  }

  /**
   * Queue a record the room may not have, or may have differently. The change
   * carries no base version, so the room flags any clash as a conflict instead
   * of overwriting. Used when reconciling a device with the room on connect.
   */
  importLocal(key: string, value: unknown | null, ts: number): Change {
    const change: Change = {
      deviceId: this.deviceId,
      devSeq: ++this.devSeqCounter,
      key,
      ts,
      baseTs: null,
      value,
    };
    this.outbox.push(change);
    return change;
  }

  /** Changes waiting to be sent, oldest first (send in this order; the socket is FIFO). */
  pending(): Change[] {
    return [...this.outbox];
  }

  /** Keys with an unacknowledged change. */
  pendingKeys(): Set<string> {
    return new Set(this.outbox.map((c) => c.key));
  }

  /** Drop a change that can never be accepted (for example, it fails validation). */
  discard(change: Change): void {
    this.outbox = this.outbox.filter((c) => !sameChange(c, change));
  }

  /**
   * Room acknowledged a submit. Returns true when its update was new and applied.
   * The same update also arrives by broadcast, which is harmless.
   */
  ack(change: Change, result: SubmitResult): boolean {
    this.outbox = this.outbox.filter((c) => !sameChange(c, change));
    return result.update ? this.receive(result.update) : false;
  }

  /**
   * A room update arrived (broadcast or catch-up). Idempotent and order-independent.
   * Returns true only when this update became the record's current version, so the
   * caller should apply it to local state.
   */
  receive(update: Update): boolean {
    if (update.seq <= this.cursor || this.seenSeqs.has(update.seq)) return false;
    this.seenSeqs.add(update.seq);
    while (this.seenSeqs.has(this.cursor + 1)) {
      this.cursor++;
      this.seenSeqs.delete(this.cursor);
    }

    if (update.seq <= (this.keySeq.get(update.key) ?? 0)) return false;
    this.keySeq.set(update.key, update.seq);
    this.versions.set(update.key, update.current);
    return true;
  }

  /**
   * Forget everything the room told us. Used when the room has restarted with a
   * shorter history than this device's cursor. Unsent changes are kept.
   */
  resetForNewRoom(): void {
    this.cursor = 0;
    this.seenSeqs.clear();
    this.keySeq.clear();
    this.versions.clear();
    this.outbox = this.outbox.map((c) => ({ ...c, baseTs: null }));
  }

  /** Current local view of a record (null when absent or deleted). */
  read(key: string): unknown | null {
    return this.versions.get(key)?.value ?? null;
  }

  /** Local version metadata: the room's version as last seen by this device. */
  version(key: string): Version | undefined {
    return this.versions.get(key);
  }
}
