/**
 * Wire protocol between a device and its hospital room (pure, no I/O).
 *
 * Transport is a WebSocket carrying JSON text frames. The room never trusts
 * client input: every incoming frame goes through `parseClientMessage`, which
 * checks shapes, collection names, sizes and numbers before anything reaches
 * the room log. See docs/realtime-sync-design.md.
 */
import { COLLECTIONS } from "./types";
import type { Change, SubmitResult, Update } from "./sync-core";

/** Largest frame accepted from a device (bytes of UTF-8 JSON). */
export const MAX_FRAME_BYTES = 256 * 1024;
const MAX_DEVICE_ID = 64;
const MAX_ID = 128;

export type ClientMessage =
  | { type: "hello"; deviceId: string; cursor: number }
  | { type: "submit"; change: Change }
  | { type: "ping" };

export type ServerMessage =
  | { type: "catchup"; updates: Update[]; lastSeq: number }
  | { type: "ack"; deviceId: string; devSeq: number; result: SubmitResult }
  | { type: "update"; update: Update }
  | { type: "error"; message: string }
  | { type: "pong" };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNonNegInt = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v) && v >= 0;

/** A record key must be "<known collection>:<non-empty id>". */
export function isValidKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const i = key.indexOf(":");
  if (i <= 0) return false;
  const collection = key.slice(0, i);
  const id = key.slice(i + 1);
  return (
    (COLLECTIONS as readonly string[]).includes(collection) && id.length > 0 && id.length <= MAX_ID
  );
}

function parseChange(raw: unknown): { ok: true; change: Change } | { ok: false; error: string } {
  if (!isObject(raw)) return { ok: false, error: "change must be an object" };
  const { deviceId, devSeq, key, ts, baseTs, value } = raw;
  if (typeof deviceId !== "string" || deviceId.length === 0 || deviceId.length > MAX_DEVICE_ID) {
    return { ok: false, error: "deviceId must be a non-empty string" };
  }
  if (!isNonNegInt(devSeq) || devSeq === 0)
    return { ok: false, error: "devSeq must be a positive integer" };
  if (!isValidKey(key)) return { ok: false, error: "key must be <known collection>:<id>" };
  if (!isFiniteNumber(ts) || ts < 0)
    return { ok: false, error: "ts must be a non-negative number" };
  if (baseTs !== null && !isFiniteNumber(baseTs))
    return { ok: false, error: "baseTs must be a number or null" };
  if (
    value !== null &&
    value !== undefined &&
    typeof value !== "object" &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return { ok: false, error: "value must be JSON" };
  }
  return {
    ok: true,
    change: {
      deviceId,
      devSeq,
      key,
      ts,
      baseTs: baseTs as number | null,
      value: value === undefined ? null : (value as unknown),
    },
  };
}

/** Parse and validate one client frame. Never throws. */
export function parseClientMessage(text: string): ParseResult {
  if (new TextEncoder().encode(text).length > MAX_FRAME_BYTES) {
    return { ok: false, error: "frame too large" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "frame is not valid JSON" };
  }
  if (!isObject(raw) || typeof raw["type"] !== "string")
    return { ok: false, error: "frame needs a type" };

  switch (raw["type"]) {
    case "hello": {
      if (
        typeof raw["deviceId"] !== "string" ||
        raw["deviceId"].length === 0 ||
        raw["deviceId"].length > MAX_DEVICE_ID
      ) {
        return { ok: false, error: "hello needs a deviceId" };
      }
      if (!isNonNegInt(raw["cursor"]))
        return { ok: false, error: "hello cursor must be a non-negative integer" };
      return {
        ok: true,
        message: { type: "hello", deviceId: raw["deviceId"], cursor: raw["cursor"] },
      };
    }
    case "submit": {
      const parsed = parseChange(raw["change"]);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      return { ok: true, message: { type: "submit", change: parsed.change } };
    }
    case "ping":
      return { ok: true, message: { type: "ping" } };
    default:
      return { ok: false, error: `unknown frame type "${raw["type"]}"` };
  }
}
