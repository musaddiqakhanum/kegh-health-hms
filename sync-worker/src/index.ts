/**
 * Sync Worker entry point.
 *
 *   GET /health                         → 200 "ok"
 *   GET /rooms/<roomId>/ws?token=<t>    → WebSocket into that hospital's room
 *
 * The room token (ROOM_TOKEN) is the device gate. It keeps random clients out.
 * Staff sign in inside the room (design phase 4) with their own username and
 * password, and get a session token signed with SESSION_SECRET. Only a signed-in
 * staff member can catch up, submit or receive changes.
 */
export { HospitalRoom } from "./room";

interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface Env {
  ROOMS: RoomNamespace;
  ROOM_TOKEN: string;
  /** Signs staff session tokens. Required for sign-in. */
  SESSION_SECRET?: string;
}

const ROOM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Compares secrets without stopping at the first differing character. A length mismatch returns early; the token length is not secret. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");

    const match = /^\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    if (!match) return new Response("not found", { status: 404 });

    const roomId = match[1] ?? "";
    if (!ROOM_ID.test(roomId)) return new Response("bad room id", { status: 400 });
    if (!env.ROOM_TOKEN) return new Response("server not configured", { status: 500 });
    if (!sameSecret(url.searchParams.get("token") ?? "", env.ROOM_TOKEN)) {
      return new Response("unauthorized", { status: 401 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }

    const id = env.ROOMS.idFromName(roomId);
    return env.ROOMS.get(id).fetch(request);
  },
};
