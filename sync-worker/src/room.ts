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

const LOG_PREFIX = "log:";
const logKey = (seq: number) => `${LOG_PREFIX}${String(seq).padStart(12, "0")}`;
const USERS_PREFIX = "users:";

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

export class HospitalRoom {
  private room: RoomLog = new RoomLog();
  private ready: Promise<void>;
  /** Writes started while handling the current message; awaited before any reply. */
  private pendingWrites: Promise<void>[] = [];

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
        const updates = this.room.since(msg.cursor);
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
      const now = Date.now();
      const current = this.room.get(`${USERS_PREFIX}${setup.id}`);
      const change: Change = {
        deviceId: "room-setup",
        devSeq: now,
        key: `${USERS_PREFIX}${setup.id}`,
        ts: now,
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
    const now = Date.now();
    const token = await issueSession(secret, verified.id, now);
    this.attach(ws, { userId: verified.id, iat: now, exp: now + SESSION_MS });
    return this.send(ws, { type: "session", token, user: sessionUserOf(verified) });
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
        result: dup,
      });
    }

    const current = this.room.get(change.key);
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
        result,
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
    this.send(ws, { type: "ack", deviceId: change.deviceId, devSeq: change.devSeq, result });
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
    this.broadcast({ type: "update", update: result.update });
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
