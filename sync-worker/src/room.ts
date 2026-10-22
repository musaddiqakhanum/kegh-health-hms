/**
 * HospitalRoom — one Durable Object per hospital.
 *
 * Owns the authoritative RoomLog for that hospital, persists every accepted
 * change to durable storage before acknowledging it, and fans updates out to
 * every connected device over WebSocket hibernation.
 *
 * Storage layout: "log:<seq padded to 12 digits>" → Change, in accept order.
 * The room is rebuilt from that log on wake-up, so a restart cannot change
 * sequence numbers or conflicts.
 */
import { RoomLog, type Change, type SubmitResult } from "../../src/lib/hms/sync-core";
import { parseClientMessage, type ServerMessage } from "../../src/lib/hms/sync-protocol";

const LOG_PREFIX = "log:";
const logKey = (seq: number) => `${LOG_PREFIX}${String(seq).padStart(12, "0")}`;

/** The subset of the Durable Object runtime this class uses. */
interface RoomStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  list<T = unknown>(options: { prefix: string }): Promise<Map<string, T>>;
}
interface RoomState {
  storage: RoomStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
}

export class HospitalRoom {
  private room: RoomLog = new RoomLog();
  private ready: Promise<void>;
  /** Writes started while handling the current message; awaited before any reply. */
  private pendingWrites: Promise<void>[] = [];

  constructor(
    private readonly state: RoomState,
    _env: unknown,
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
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = parseClientMessage(text);
    if (!parsed.ok) return this.send(ws, { type: "error", message: parsed.error });

    const msg = parsed.message;
    switch (msg.type) {
      case "hello": {
        const updates = this.room.since(msg.cursor);
        return this.send(ws, { type: "catchup", updates, lastSeq: this.room.lastSeq });
      }
      case "ping":
        return this.send(ws, { type: "pong" });
      case "submit":
        return this.submit(ws, msg.change);
    }
  }

  private async submit(ws: WebSocket, change: Change): Promise<void> {
    this.pendingWrites = [];
    const result: SubmitResult = this.room.submit(change);
    try {
      // Nothing is acknowledged or broadcast until the change is durable.
      await Promise.all(this.pendingWrites);
    } catch (err) {
      // The in-memory room is ahead of storage now. Rebuild from storage so the
      // device's retry is accepted again instead of being reported as a duplicate.
      console.error("persist failed; reloading room", err);
      await this.reload();
      return this.send(ws, { type: "error", message: "could not save the change; please retry" });
    }
    this.send(ws, { type: "ack", deviceId: change.deviceId, devSeq: change.devSeq, result });
    if (result.update) this.broadcast({ type: "update", update: result.update });
  }

  private broadcast(message: ServerMessage): void {
    const frame = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
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
