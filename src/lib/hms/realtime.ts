/**
 * Device connection to a hospital room (design phase 2). DOM-free apart from the
 * WebSocket type, so it runs in the browser and in Node tests.
 *
 * Responsibilities:
 *  - Connect, send hello with the device's cursor, apply catch-up.
 *  - Send the outbox in order, keep a bounded number in flight, and resend
 *    everything unacknowledged after any reconnect (the room dedupes by devSeq).
 *  - Reconnect with backoff. A heartbeat detects a silently dead socket.
 *  - Report status: connecting, online (caught up), or offline.
 *  - Keep the outbox across reloads (the caller saves the snapshot via onJournal).
 */
import { DeviceSync, type DeviceSnapshot, type SubmitResult, type Update } from "./sync-core";
import { parseClientMessage } from "./sync-protocol";

export type RealtimeStatus = "connecting" | "online" | "offline";

export interface RealtimeSnapshot {
  status: RealtimeStatus;
  /** Changes not yet acknowledged by the room. */
  pending: number;
  /** Last problem worth showing (a change that could not be sent). Null when none. */
  error: string | null;
}

export interface RealtimeHooks {
  /** Remote changes that are new for this device. Apply them to local state. */
  onUpdates(updates: Update[]): void;
  /** Once per connection, before the room's catch-up is applied. */
  onConnecting(): void;
  /** Once per connection, after catch-up has been applied. */
  onCaughtUp(): void;
  onStatus(snapshot: RealtimeSnapshot): void;
  /** The device state changed. Persist this snapshot (called after a short delay). */
  onJournal(snapshot: DeviceSnapshot): void;
}

export interface RealtimeOptions {
  /** Full room WebSocket URL, including the token. */
  url: string;
  device: DeviceSync;
  hooks: RealtimeHooks;
  /** Test seam. Defaults to the browser WebSocket. */
  makeSocket?: (url: string) => WebSocket;
  /** Test seam for jitter. Defaults to Math.random. */
  random?: () => number;
}

export const HEARTBEAT_MS = 20_000;
export const PONG_TIMEOUT_MS = 10_000;
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
export const MAX_IN_FLIGHT = 100;
const SAVE_DELAY_MS = 500;

type Timer = ReturnType<typeof setTimeout>;
type TimerName = "retryTimer" | "flushTimer" | "saveTimer" | "pongTimer" | "heartbeatTimer";

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private connectionId = 0;
  private running = false;
  private caughtUp = false;
  private inFlight = new Set<string>();
  private attempt = 0;
  private status: RealtimeStatus = "offline";
  private error: string | null = null;
  private retryTimer: Timer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: Timer | null = null;
  private flushTimer: Timer | null = null;
  private saveTimer: Timer | null = null;

  constructor(private readonly opts: RealtimeOptions) {}

  get device(): DeviceSync {
    return this.opts.device;
  }

  /** True while connected and caught up. Local changes are sent right away. */
  get connected(): boolean {
    return this.running && this.caughtUp && this.socket !== null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.teardownSocket();
    this.clearTimer("retryTimer");
    this.clearTimer("flushTimer");
    this.setStatus("offline");
    this.flushSave();
  }

  /** Reconnect now (for example, when the browser reports it is back online). */
  reconnectNow(): void {
    if (!this.running || this.socket) return;
    this.clearTimer("retryTimer");
    this.attempt = 0;
    this.connect();
  }

  /** Local change(s) were added to the outbox. Send them if connected, and schedule a save. */
  notifyLocal(): void {
    this.scheduleSave();
    this.flush();
    this.refresh();
  }

  /** Send queued changes that are not in flight yet. */
  flush(): void {
    const ws = this.socket;
    if (!ws || !this.running || !this.caughtUp) return;
    for (const change of this.opts.device.pending()) {
      if (this.inFlight.size >= MAX_IN_FLIGHT) break;
      const key = `${change.deviceId}#${change.devSeq}`;
      if (this.inFlight.has(key)) continue;
      const frame = JSON.stringify({ type: "submit", change });
      const check = parseClientMessage(frame);
      if (!check.ok) {
        // A change the room can never accept would block the outbox forever.
        this.opts.device.discard(change);
        this.error = `A change could not be sent (${check.error}). It stays on this device only.`;
        this.scheduleSave();
        continue;
      }
      try {
        ws.send(frame);
      } catch {
        break;
      }
      this.inFlight.add(key);
    }
    this.refresh();
  }

  private connect(): void {
    const id = ++this.connectionId;
    this.caughtUp = false;
    this.inFlight.clear();
    this.setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = (this.opts.makeSocket ?? ((url: string) => new WebSocket(url)))(this.opts.url);
    } catch {
      this.disconnected(id);
      return;
    }
    this.socket = ws;

    ws.onopen = () => {
      if (id !== this.connectionId) return;
      this.opts.hooks.onConnecting();
      this.send({
        type: "hello",
        deviceId: this.opts.device.deviceId,
        cursor: this.opts.device.cursor,
      });
      this.startHeartbeat(id);
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (id !== this.connectionId) return;
      if (typeof ev.data === "string") this.onFrame(id, ev.data);
    };
    ws.onclose = () => this.disconnected(id);
    ws.onerror = () => {
      // The browser follows an error with a close, which handles the reconnect.
    };
  }

  private onFrame(id: number, text: string): void {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") return;
      msg = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (msg["type"]) {
      case "catchup": {
        const lastSeq = typeof msg["lastSeq"] === "number" ? msg["lastSeq"] : 0;
        if (lastSeq < this.opts.device.cursor) {
          // The room has less history than this device has seen: it was reset. Start over.
          this.opts.device.resetForNewRoom();
          this.scheduleSave();
          this.send({ type: "hello", deviceId: this.opts.device.deviceId, cursor: 0 });
          return;
        }
        const updates = Array.isArray(msg["updates"]) ? (msg["updates"] as Update[]) : [];
        const fresh = updates.filter((u) => this.opts.device.receive(u));
        if (fresh.length > 0) this.opts.hooks.onUpdates(fresh);
        this.caughtUp = true;
        this.attempt = 0;
        this.error = null;
        this.opts.hooks.onCaughtUp();
        this.scheduleSave();
        this.flush();
        this.setStatus("online");
        return;
      }
      case "update": {
        const update = msg["update"] as Update | undefined;
        if (update && this.opts.device.receive(update)) this.opts.hooks.onUpdates([update]);
        this.scheduleSave();
        return;
      }
      case "ack": {
        const deviceId = msg["deviceId"];
        const devSeq = msg["devSeq"];
        const key = `${String(deviceId)}#${String(devSeq)}`;
        this.inFlight.delete(key);
        const change = this.opts.device
          .pending()
          .find((c) => c.deviceId === deviceId && c.devSeq === devSeq);
        if (!change) return;
        const result = msg["result"] as SubmitResult;
        const applied = this.opts.device.ack(change, result);
        if (applied && result.update) this.opts.hooks.onUpdates([result.update]);
        this.scheduleSave();
        this.flush();
        this.refresh();
        return;
      }
      case "pong":
        this.clearTimer("pongTimer");
        return;
      case "error": {
        // Rejected or not saved. Resend everything unacknowledged shortly (the room dedupes).
        this.error =
          typeof msg["message"] === "string" ? msg["message"] : "The room rejected a message.";
        this.inFlight.clear();
        this.scheduleFlush(id);
        this.refresh();
        return;
      }
      default:
        return;
    }
  }

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // The close handler will reconnect.
    }
  }

  private startHeartbeat(id: number): void {
    this.clearTimer("heartbeatTimer");
    this.heartbeatTimer = setInterval(() => {
      if (id !== this.connectionId || !this.socket) return;
      this.send({ type: "ping" });
      this.clearTimer("pongTimer");
      this.pongTimer = setTimeout(() => {
        if (id === this.connectionId) this.disconnected(id);
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_MS);
  }

  /** The socket went away (closed, failed to connect, or stopped answering). */
  private disconnected(id: number): void {
    if (id !== this.connectionId) return;
    this.teardownSocket();
    if (!this.running) return;
    this.setStatus("offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    const random = this.opts.random ?? Math.random;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt);
    const delay = base * (0.5 + random() / 2);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running && !this.socket) this.connect();
    }, delay);
  }

  private scheduleFlush(id: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (id === this.connectionId) this.flush();
    }, BACKOFF_MIN_MS);
  }

  /** Close the socket and ignore any further events from it. */
  private teardownSocket(): void {
    this.connectionId++;
    this.clearTimer("heartbeatTimer");
    this.clearTimer("pongTimer");
    const ws = this.socket;
    this.socket = null;
    this.caughtUp = false;
    this.inFlight.clear();
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private flushSave(): void {
    this.clearTimer("saveTimer");
    this.opts.hooks.onJournal(this.opts.device.snapshot());
  }

  private setStatus(status: RealtimeStatus): void {
    this.status = status;
    this.refresh();
  }

  private refresh(): void {
    this.opts.hooks.onStatus({
      status: this.status,
      pending: this.opts.device.pending().length,
      error: this.error,
    });
  }

  private clearTimer(name: TimerName): void {
    if (name === "heartbeatTimer") {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      return;
    }
    const timer = this[name];
    if (timer) clearTimeout(timer);
    this[name] = null;
  }
}
