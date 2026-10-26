/**
 * HospitalRoom — one Durable Object per hospital.
 *
 * Owns the authoritative RoomLog for that hospital, persists every accepted
 * change to durable storage before acknowledging it, and fans updates out to
 * every signed-in device over WebSocket hibernation.
 *
 * Access (design phase 4):
 *  - A socket must sign in before it can catch up, submit or receive updates.
 *    `login` checks the username and password against the room's own `users`
 *    records. `auth` re-opens a session from a token. Tokens are HMAC-signed
 *    with SESSION_SECRET and are checked against the live account on every message.
 *  - Every submitted change is checked against the signed-in role (see
 *    authorizeChange). A refused change is never logged; the device gets the
 *    room's version back.
 *  - First admin: while the room has no active Admin, `login` may carry the
 *    device's local Admin record. The room verifies the password against that
 *    record and writes it. This is the only way a room gets its first account.
 *
 * Storage layout: "log:<seq padded to 12 digits>" → Change, in accept order.
 * The room is rebuilt from that log on wake-up, so a restart cannot change
 * sequence numbers, conflicts or who may sign in.
 */
import {
  RoomLog,
  type Change,
  type SubmitResult,
  type Update,
  type Version,
} from "../../src/lib/hms/sync-core";
import { parseClientMessage, type ServerMessage } from "../../src/lib/hms/sync-protocol";
import {
  authorizeChange,
  issueSession,
  isUserRecord,
  liveSessionUser,
  passwordMatches,
  readSession,
  sessionUserOf,
  SESSION_MS,
} from "../../src/lib/hms/sync-auth";
import type { User } from "../../src/lib/hms/types";
import { keepStoredUserSecrets, stripUserSecrets } from "../../src/lib/hms/user-secrets";

const LOG_PREFIX = "log:";
const logKey = (seq: number) => `${LOG_PREFIX}${String(seq).padStart(12, "0")}`;
const USERS_PREFIX = "users:";
const LOGIN_PREFIX = "login:";

/** Staff password material never leaves the room (phase 4b, item 4). */
function deviceUpdate(update: Update): Update {
  if (!update.key.startsWith(USERS_PREFIX) || update.current.value === null) return update;
  return {
    ...update,
    current: { ...update.current, value: stripUserSecrets(update.current.value) },
  };
}

function deviceResult(result: SubmitResult): SubmitResult {
  return result.update ? { ...result, update: deviceUpdate(result.update) } : result;
}

/**
 * Sign-in throttle (per username, case and spacing ignored). Attempts are
 * counted before the password is checked, so a parallel burst cannot get
 * extra guesses. After LOGIN_MAX_ATTEMPTS in one window the name is locked
 * for LOGIN_LOCK_MS. A successful sign-in clears the count. Unknown names are
 * counted too, so the lock does not reveal which accounts exist.
 */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LOCK_MS = 15 * 60_000;

/** Stored per username (survives hibernation and restarts). */
interface LoginRecord {
  attempts: number;
  windowStart: number;
  lockedUntil: number;
}

/** Close code for a socket whose sign-in has ended. */
const CLOSE_SIGNED_OUT = 4001;

/** Stored on each socket (survives hibernation). Null for an unsigned socket. */
interface Attached {
  userId: string;
  iat: number;
  exp: number;
}

/** The subset of the Durable Object runtime this class uses. */
interface RoomStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean | void>;
  list<T = unknown>(options: { prefix: string }): Promise<Map<string, T>>;
}
interface RoomSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface RoomState {
  storage: RoomStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
}
interface RoomEnv {
  SESSION_SECRET?: string | undefined;
}

class PersistError extends Error {}

function isLoginRecord(value: unknown): value is LoginRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r["attempts"] === "number" &&
    typeof r["windowStart"] === "number" &&
    typeof r["lockedUntil"] === "number"
  );
}

export class HospitalRoom {
  private room: RoomLog = new RoomLog();
  private ready: Promise<void>;
  /** Writes started while handling the current message; awaited before any reply. */
  private pendingWrites: Promise<void>[] = [];
  /** Sign-in throttle, by normalised username. Changed synchronously; saved to storage. */
  private logins: Map<string, LoginRecord> = new Map();

  constructor(
    private readonly state: RoomState,
    private readonly env: RoomEnv,
  ) {
    this.ready = this.state.blockConcurrencyWhile(() => this.reload());
  }

  /** Rebuild the in-memory room from storage. Used on wake-up and after a failed write. */
  private async reload(): Promise<void> {
    const stored = await this.state.storage.list<Change>({ prefix: LOG_PREFIX });
    const changes = [...stored.values()];
    this.room = RoomLog.restore(changes, (seq, change) => {
      this.pendingWrites.push(this.state.storage.put(logKey(seq), change));
    });
    const throttled = await this.state.storage.list<LoginRecord>({ prefix: LOGIN_PREFIX });
    this.logins = new Map();
    for (const [key, record] of throttled) {
      if (isLoginRecord(record)) this.logins.set(key.slice(LOGIN_PREFIX.length), record);
    }
  }

  /** WebSocket upgrade. The Worker has already checked the room token. */
  async fetch(request: Request): Promise<Response> {
    await this.ready;
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    (server as RoomSocket).serializeAttachment(null);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = parseClientMessage(text);
    if (!parsed.ok) return this.send(ws, { type: "error", message: parsed.error });

    const msg = parsed.message;
    switch (msg.type) {
      case "login":
        return this.login(ws, msg.username, msg.password, msg.setup);
      case "auth":
        return this.authenticate(ws, msg.token);
      case "hello": {
        if (!this.signedInUser(ws)) return this.signInRequired(ws);
        const updates = this.room.since(msg.cursor).map(deviceUpdate);
        return this.send(ws, { type: "catchup", updates, lastSeq: this.room.lastSeq });
      }
      case "ping":
        return this.send(ws, { type: "pong" });
      case "submit":
        return this.submit(ws, msg.change);
    }
  }

  // ---- sign-in -----------------------------------------------------------

  private async login(
    ws: WebSocket,
    username: string,
    password: string,
    setup: unknown,
  ): Promise<void> {
    const secret = this.env.SESSION_SECRET;
    if (!secret)
      return this.send(ws, {
        type: "error",
        code: "not-configured",
        message: "Sign-in is not set up on this room.",
      });
    await this.ready;

    const name = username.trim().toLowerCase();
    const now = Date.now();
    const locked = this.claimLoginAttempt(name, now);
    await this.saveLogin(name);
    if (locked) {
      const minutes = Math.ceil((locked.retryAt - now) / 60_000);
      return this.send(ws, {
        type: "error",
        code: "too-many-attempts",
        message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      });
    }

    const existing = this.userByUsername(name);
    let verified: User | null = null;

    if (existing && (await passwordMatches(existing, password))) {
      verified = existing;
    } else if (
      setup !== undefined &&
      isUserRecord(setup) &&
      setup.role === "Admin" &&
      setup.active &&
      setup.username.trim().toLowerCase() === name &&
      (existing === undefined || existing.id === setup.id) &&
      !this.hasActiveAdmin() &&
      (await passwordMatches(setup, password))
    ) {
      // First admin (or recovery after every admin was deactivated). Write the
      // record through the normal log so every device receives it.
      const stamp = Date.now();
      const current = this.room.get(`${USERS_PREFIX}${setup.id}`);
      const change: Change = {
        deviceId: "room-setup",
        devSeq: stamp,
        key: `${USERS_PREFIX}${setup.id}`,
        ts: stamp,
        baseTs: current ? current.ts : null,
        value: setup,
      };
      try {
        const result = await this.commit(change);
        this.broadcastUpdate(result);
      } catch {
        return this.send(ws, { type: "error", message: "could not save the change; please retry" });
      }
      verified = setup;
    }

    if (!verified) {
      // Same answer for an unknown user, a wrong password and an inactive account.
      return this.send(ws, {
        type: "error",
        code: "invalid-login",
        message: "Wrong username or password.",
      });
    }
    await this.clearLoginAttempts(name);
    const signedAt = Date.now();
    const token = await issueSession(secret, verified.id, signedAt);
    this.attach(ws, { userId: verified.id, iat: signedAt, exp: signedAt + SESSION_MS });
    return this.send(ws, { type: "session", token, user: sessionUserOf(verified) });
  }

  // ---- sign-in throttle --------------------------------------------------

  /**
   * Count this attempt. Returns null when it may proceed, or the time the lock
   * ends when the name is locked. Synchronous, so parallel attempts are counted
   * one by one. The caller then saves the record (saveLogin) before replying.
   */
  private claimLoginAttempt(name: string, now: number): { retryAt: number } | null {
    let record = this.logins.get(name);
    if (
      !record ||
      (record.lockedUntil !== 0 && now >= record.lockedUntil) ||
      (record.lockedUntil === 0 && now - record.windowStart >= LOGIN_WINDOW_MS)
    ) {
      record = { attempts: 0, windowStart: now, lockedUntil: 0 };
    }
    if (record.lockedUntil !== 0) {
      this.logins.set(name, record);
      return { retryAt: record.lockedUntil };
    }
    record.attempts += 1;
    if (record.attempts > LOGIN_MAX_ATTEMPTS) {
      record.lockedUntil = now + LOGIN_LOCK_MS;
      this.logins.set(name, record);
      return { retryAt: record.lockedUntil };
    }
    this.logins.set(name, record);
    return null;
  }

  /** Save this name's throttle state. A storage failure is logged; the in-memory count still applies. */
  private async saveLogin(name: string): Promise<void> {
    const record = this.logins.get(name);
    try {
      if (record) await this.state.storage.put(`${LOGIN_PREFIX}${name}`, record);
      else await this.state.storage.delete(`${LOGIN_PREFIX}${name}`);
    } catch (err) {
      console.error("could not save sign-in throttle", err);
    }
  }

  /** A successful sign-in clears the count for that name. */
  private async clearLoginAttempts(name: string): Promise<void> {
    if (!this.logins.has(name)) return;
    this.logins.delete(name);
    await this.saveLogin(name);
  }

  private async authenticate(ws: WebSocket, token: string): Promise<void> {
    const secret = this.env.SESSION_SECRET;
    if (!secret)
      return this.send(ws, {
        type: "error",
        code: "not-configured",
        message: "Sign-in is not set up on this room.",
      });
    await this.ready;
    const claims = await readSession(secret, token, Date.now());
    if (!claims) return this.signInRequired(ws);
    const user = liveSessionUser(this.userById(claims.userId), claims);
    if (!user) return this.signInRequired(ws);
    this.attach(ws, { userId: claims.userId, iat: claims.iat, exp: claims.exp });
    return this.send(ws, { type: "session", token, user: sessionUserOf(user) });
  }

  // ---- changes -----------------------------------------------------------

  private async submit(ws: WebSocket, change: Change): Promise<void> {
    const user = this.signedInUser(ws);
    if (!user) return this.signInRequired(ws);

    // A retry of an accepted change returns the original result. Check this
    // before policy, so a retried audit entry is not refused as a change.
    if (this.room.priorSeq(change.deviceId, change.devSeq) !== undefined) {
      const dup = this.room.submit(change);
      return this.send(ws, {
        type: "ack",
        deviceId: change.deviceId,
        devSeq: change.devSeq,
        result: deviceResult(dup),
      });
    }

    const current = this.room.get(change.key);
    // An edit that leaves out the password material keeps the stored material.
    if (change.key.startsWith(USERS_PREFIX) && change.value !== null) {
      change = {
        ...change,
        value: keepStoredUserSecrets(change.value, current?.value) as Change["value"],
      };
    }
    const decision = authorizeChange(user.role, change, current);
    if (!decision.ok) {
      // Refused: nothing is logged. The device gets the room's version back.
      const update: Update = {
        seq: current ? current.seq : 0,
        key: change.key,
        current: current ?? { key: change.key, ts: 0, deviceId: "room", value: null, seq: 0 },
      };
      const result: SubmitResult = { outcome: "denied", seq: 0, update, reason: decision.reason };
      return this.send(ws, {
        type: "ack",
        deviceId: change.deviceId,
        devSeq: change.devSeq,
        result: deviceResult(result),
      });
    }

    let result: SubmitResult;
    try {
      result = await this.commit(change);
    } catch {
      // The in-memory room is ahead of storage now (commit reloaded it). The
      // device's retry will be accepted again instead of reported as a duplicate.
      return this.send(ws, { type: "error", message: "could not save the change; please retry" });
    }
    this.send(ws, {
      type: "ack",
      deviceId: change.deviceId,
      devSeq: change.devSeq,
      result: deviceResult(result),
    });
    this.broadcastUpdate(result);
    if (change.key.startsWith(USERS_PREFIX)) this.endInvalidSessions();
  }

  /** Apply a change to the log and wait until it is durable. Throws PersistError if storage fails. */
  private async commit(change: Change): Promise<SubmitResult> {
    this.pendingWrites = [];
    const result = this.room.submit(change);
    try {
      // Nothing is acknowledged or broadcast until the change is durable.
      await Promise.all(this.pendingWrites);
    } catch (err) {
      console.error("persist failed; reloading room", err);
      await this.reload();
      throw new PersistError("persist failed");
    }
    return result;
  }

  // ---- sessions and users ------------------------------------------------

  private attach(ws: WebSocket, value: Attached | null): void {
    (ws as RoomSocket).serializeAttachment(value);
  }

  /** The live account behind this socket's session, or null when it is not signed in. */
  private signedInUser(ws: WebSocket): User | null {
    const attached = (ws as RoomSocket).deserializeAttachment() as Attached | null;
    if (!attached || typeof attached !== "object") return null;
    const claims = { userId: attached.userId, iat: attached.iat, exp: attached.exp };
    if (Date.now() >= claims.exp) return null;
    return liveSessionUser(this.userById(claims.userId), claims);
  }

  private signInRequired(ws: WebSocket): void {
    this.attach(ws, null);
    this.send(ws, { type: "error", code: "sign-in-required", message: "Sign in to sync." });
  }

  /** Close every socket whose account was deactivated or force-signed-out. */
  private endInvalidSessions(): void {
    for (const ws of this.state.getWebSockets()) {
      const attached = (ws as RoomSocket).deserializeAttachment();
      if (attached === null || attached === undefined) continue;
      if (this.signedInUser(ws)) continue;
      this.signInRequired(ws);
      try {
        ws.close(CLOSE_SIGNED_OUT, "signed out");
      } catch {
        // Already closed.
      }
    }
  }

  private userById(id: string): User | undefined {
    const version = this.room.get(`${USERS_PREFIX}${id}`);
    return version && isUserRecord(version.value) ? version.value : undefined;
  }

  private userByUsername(lowerName: string): User | undefined {
    for (const version of this.room.currentWithPrefix(USERS_PREFIX)) {
      if (version.value !== null && isUserRecord(version.value)) {
        if (version.value.username.trim().toLowerCase() === lowerName) return version.value;
      }
    }
    return undefined;
  }

  private hasActiveAdmin(): boolean {
    return this.room
      .currentWithPrefix(USERS_PREFIX)
      .some(
        (v: Version) =>
          v.value !== null && isUserRecord(v.value) && v.value.active && v.value.role === "Admin",
      );
  }

  // ---- transport ---------------------------------------------------------

  /** Send an accepted update to every signed-in socket. */
  private broadcastUpdate(result: SubmitResult): void {
    if (!result.update) return;
    this.broadcast({ type: "update", update: deviceUpdate(result.update) });
  }

  private broadcast(message: ServerMessage): void {
    const frame = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
      if (!this.signedInUser(ws)) continue;
      try {
        ws.send(frame);
      } catch {
        // A dead socket is cleaned up by the runtime; other devices still get the update.
      }
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code, "closed");
    } catch {
      // Already closed.
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "error");
    } catch {
      // Already closed.
    }
  }
}
