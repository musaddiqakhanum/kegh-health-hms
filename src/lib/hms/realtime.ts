/**
 * Device connection to a hospital room (design phases 2 and 4). DOM-free apart
 * from the WebSocket type, so it runs in the browser and in Node tests.
 *
 * Responsibilities:
 *  - Sign in to the room (a staff login, or an existing session token), then
 *    connect with the device cursor, apply catch-up.
 *  - Send the outbox in order, keep a bounded number in flight, and resend
 *    everything unacknowledged after any reconnect (the room dedupes by devSeq).
 *  - Reconnect with backoff. A heartbeat detects a silently dead socket.
 *  - A change the room refuses is dropped and the record takes the room's version.
 *  - Report status: connecting, online (caught up), offline, or sign-in needed.
 *  - Keep the outbox across reloads (the caller saves the snapshot via onJournal).
 */
import { DeviceSync, type DeviceSnapshot, type SubmitResult, type Update } from "./sync-core";
import { parseClientMessage } from "./sync-protocol";
import type { SessionUser } from "./sync-auth";
import type { User } from "./types";

export type RealtimeStatus = "connecting" | "online" | "offline" | "sign-in";

export interface RealtimeSnapshot {
  status: RealtimeStatus;
  /** Changes not yet acknowledged by the room. */
  pending: number;
  /** Last problem worth showing (a refused or unsendable change). Null when none. */
  error: string | null;
  /** True while this device holds a room session. */
  signedIn: boolean;
}

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string };

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
  /** The room issued a session token, or the device's session ended (null). */
  onSession(token: string | null, user: SessionUser | null): void;
}

export interface RealtimeOptions {
  /** Full room WebSocket URL, including the room token. */
  url: string;
  device: DeviceSync;
  hooks: RealtimeHooks;
  /** Session token from an earlier sign-in on this device, if any. */
  token?: string | null | undefined;
  /** Test seam. Defaults to the browser WebSocket. */
  makeSocket?: ((url: string) => WebSocket) | undefined;
  /** Test seam for jitter. Defaults to Math.random. */
  random?: (() => number) | undefined;
}

export const HEARTBEAT_MS = 20_000;
export const PONG_TIMEOUT_MS = 10_000;
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
export const MAX_IN_FLIGHT = 100;
const SAVE_DELAY_MS = 500;

type Timer = ReturnType<typeof setTimeout>;
type TimerName = "retryTimer" | "flushTimer" | "saveTimer" | "pongTimer" | "heartbeatTimer";

interface PendingLogin {
  username: string;
  password: string;
  setup?: User | undefined;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private connectionId = 0;
  private running = false;
  /** Signed in and caught up on this connection. */
  private caughtUp = false;
  /** This connection has a session and has sent hello. */
  private authed = false;
  private inFlight = new Set<string>();
  private attempt = 0;
  private status: RealtimeStatus = "offline";
  private error: string | null = null;
  private token: string | null;
  /** Set when the device must wait for a staff sign-in. Stops automatic reconnects. */
  private needsSignIn = false;
  private pendingLogin: PendingLogin | null = null;
  private loginWaiter: ((result: LoginResult) => void) | null = null;
  private retryTimer: Timer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: Timer | null = null;
  private flushTimer: Timer | null = null;
  private saveTimer: Timer | null = null;

  constructor(private readonly opts: RealtimeOptions) {
    this.token = opts.token ?? null;
  }

  get device(): DeviceSync {
    return this.opts.device;
  }

  /** True while connected and caught up. Local changes are sent right away. */
  get connected(): boolean {
    return this.running && this.caughtUp && this.socket !== null;
  }

  /** True when this device holds a room session (possibly not yet connected). */
  get signedIn(): boolean {
    return this.token !== null;
  }

  /** Start syncing. Without a session token this only reports that sign-in is needed. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.needsSignIn = false;
    if (!this.token && !this.pendingLogin) {
      this.running = false;
      this.setStatus("sign-in");
      return;
    }
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

  /**
   * Sign this device in to the room as a staff member. Resolves with the result
   * of the room's check. `setup` is the device's local Admin record, sent only
   * when the room has no active Admin yet (the first-admin path).
   */
  signIn(username: string, password: string, setup?: User): Promise<LoginResult> {
    return new Promise<LoginResult>((resolve) => {
      this.loginWaiter?.({ ok: false, error: "Sign-in was replaced by a newer attempt." });
      this.loginWaiter = resolve;
      this.pendingLogin = { username, password, setup };
      this.needsSignIn = false;
      this.error = null;
      this.clearTimer("retryTimer");
      this.attempt = 0;
      this.running = true;
      this.teardownSocket();
      this.connect();
    });
  }

  /** End this device's room session. Unsent changes stay in the outbox. */
  signOut(): void {
    this.endSession();
    this.stop();
    this.setStatus("sign-in");
  }

  /** Reconnect now (for example, when the browser reports it is back online). */
  reconnectNow(): void {
    if (!this.running || this.socket || this.needsSignIn) return;
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
    this.authed = false;
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
      this.startHeartbeat(id);
      // A pending sign-in wins over a stored token (the device may be switching staff).
      if (this.pendingLogin) {
        this.sendLogin();
      } else if (this.token) {
        this.send({ type: "auth", token: this.token });
      } else {
        this.needsSignIn = true;
        this.teardownSocket();
        this.setStatus("sign-in");
      }
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

  /** Sends the pending sign-in once, then forgets the password. */
  private sendLogin(): void {
    const login = this.pendingLogin;
    this.pendingLogin = null;
    if (!login) return;
    this.send({
      type: "login",
      username: login.username,
      password: login.password,
      ...(login.setup ? { setup: login.setup } : {}),
    });
  }

  /** Once the room accepts the session: catch up, then the outbox flows. */
  private beginSync(): void {
    if (this.authed) return;
    this.authed = true;
    this.opts.hooks.onConnecting();
    this.send({
      type: "hello",
      deviceId: this.opts.device.deviceId,
      cursor: this.opts.device.cursor,
    });
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
      case "session": {
        const token = typeof msg["token"] === "string" ? msg["token"] : null;
        const user = (msg["user"] ?? null) as SessionUser | null;
        if (!token || !user) return;
        this.token = token;
        this.pendingLogin = null;
        this.opts.hooks.onSession(token, user);
        this.loginWaiter?.({ ok: true, user });
        this.loginWaiter = null;
        this.error = null;
        this.beginSync();
        this.refresh();
        return;
      }
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
        if (result.outcome === "denied") {
          this.error = `The room refused a change (${result.reason ?? "not allowed"}). That record now shows the room's version.`;
        }
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
        const code = msg["code"];
        const message =
          typeof msg["message"] === "string" ? msg["message"] : "The room rejected a message.";
        if (code === "sign-in-required") {
          this.endSession();
          this.needsSignIn = true;
          this.settleLogin({ ok: false, error: message });
          this.teardownSocket();
          this.setStatus("sign-in");
          return;
        }
        if (code === "invalid-login") {
          this.needsSignIn = true;
          this.settleLogin({ ok: false, error: message });
          this.teardownSocket();
          this.setStatus("sign-in");
          return;
        }
        if (code === "not-configured") {
          this.needsSignIn = true;
          this.settleLogin({ ok: false, error: message });
          this.error = message;
          this.teardownSocket();
          this.setStatus("offline");
          return;
        }
        // Rejected or not saved. Resend everything unacknowledged shortly (the room dedupes).
        this.error = message;
        this.inFlight.clear();
        this.scheduleFlush(id);
        this.refresh();
        return;
      }
      default:
        return;
    }
  }

  private settleLogin(result: LoginResult): void {
    this.loginWaiter?.(result);
    this.loginWaiter = null;
    this.pendingLogin = null;
  }

  /** Forget the room session on this device. */
  private endSession(): void {
    this.token = null;
    this.pendingLogin = null;
    this.opts.hooks.onSession(null, null);
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
    if (this.needsSignIn) {
      this.setStatus("sign-in");
      return;
    }
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
      if (this.running && !this.socket && !this.needsSignIn) this.connect();
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
    this.authed = false;
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
      signedIn: this.token !== null,
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
