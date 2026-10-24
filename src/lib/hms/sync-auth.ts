/**
 * Staff sign-in and change policy for the hospital room (design phase 4).
 * Pure logic shared by the room Worker and the device tests. No I/O besides
 * Web Crypto, which Workers, browsers and Node all provide.
 *
 *  - Session tokens: HMAC-SHA-256 over the user id and times, keyed by the
 *    room's SESSION_SECRET. A token only identifies a user; whether that user
 *    is still allowed to act is checked live against the room's `users` records.
 *  - Policy: what each role may change. Checked by the room for every change.
 */
import { verifyPassword } from "./crypto";
import { splitKey } from "./realtime-state";
import type { Change, Version } from "./sync-core";
import type { Role, User } from "./types";

/** How long a sign-in lasts before the device must sign in again. */
export const SESSION_MS = 12 * 60 * 60 * 1000;

/** Collections only an Admin may change. Matches the Admin-only pages in nav.ts. */
export const ADMIN_ONLY_COLLECTIONS: readonly string[] = ["users", "staff", "payrolls", "expenses"];
/** Collections where records are only ever added, never changed or removed. */
export const APPEND_ONLY_COLLECTIONS: readonly string[] = ["auditLogs"];

export interface SessionClaims {
  userId: string;
  /** Issued at (ms). */
  iat: number;
  /** Expires at (ms). */
  exp: number;
}

/** What the device learns about the account it signed in as. */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** Issue a signed token for `userId`, valid for SESSION_MS from `now`. */
export async function issueSession(secret: string, userId: string, now: number): Promise<string> {
  const claims: SessionClaims = { userId, iat: now, exp: now + SESSION_MS };
  const body = toBase64Url(enc.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret, "sign");
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body) as BufferSource),
  );
  return `${body}.${toBase64Url(sig)}`;
}

/** Claims of a valid, unexpired token; null for anything else. Never throws. */
export async function readSession(
  secret: string,
  token: string,
  now: number,
): Promise<SessionClaims | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = fromBase64Url(token.slice(dot + 1));
  if (!sig) return null;
  const key = await hmacKey(secret, "verify");
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sig as BufferSource,
    enc.encode(body) as BufferSource,
  );
  if (!ok) return null;
  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  if (
    typeof c["userId"] !== "string" ||
    typeof c["iat"] !== "number" ||
    typeof c["exp"] !== "number"
  ) {
    return null;
  }
  if (now >= c["exp"]) return null;
  return { userId: c["userId"], iat: c["iat"], exp: c["exp"] };
}

/**
 * A session is still good when its account is active and the account has not
 * been force-signed-out after the session began. Returns the live user or null.
 */
export function liveSessionUser(user: User | undefined, claims: SessionClaims): User | null {
  if (!user || !user.active) return null;
  if (user.sessionsKickedAt !== undefined && claims.iat < user.sessionsKickedAt) return null;
  return user;
}

/** Every role, for validating records that arrive from a device. */
export const ROLES: readonly Role[] = [
  "Admin",
  "Reception",
  "Doctor",
  "Nursing",
  "Lab",
  "Pharmacy",
  "Billing",
];

/** Shape check for a user record that arrives from a device (never trust it). */
export function isUserRecord(v: unknown): v is User {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const u = v as Record<string, unknown>;
  return (
    typeof u["id"] === "string" &&
    u["id"].length > 0 &&
    u["id"].length <= 128 &&
    typeof u["username"] === "string" &&
    u["username"].length > 0 &&
    u["username"].length <= 64 &&
    typeof u["displayName"] === "string" &&
    typeof u["role"] === "string" &&
    (ROLES as readonly string[]).includes(u["role"]) &&
    typeof u["passwordHash"] === "string" &&
    typeof u["salt"] === "string" &&
    typeof u["active"] === "boolean" &&
    typeof u["createdAt"] === "number" &&
    (u["sessionsKickedAt"] === undefined || typeof u["sessionsKickedAt"] === "number")
  );
}

/** The user as the device should see it (no password material). */
export function sessionUserOf(user: User): SessionUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

/** Password check for an account. Inactive accounts never sign in. */
export async function passwordMatches(user: User, password: string): Promise<boolean> {
  if (!user.active) return false;
  return verifyPassword(password, user.salt, user.passwordHash);
}

export type Decision = { ok: true } | { ok: false; reason: string };

/**
 * Whether `role` may apply `change`, given the room's current version of the
 * record. Called by the room for every submitted change before it is logged.
 */
export function authorizeChange(
  role: Role,
  change: Change,
  current: Version | undefined,
): Decision {
  const parts = splitKey(change.key);
  if (!parts) return { ok: false, reason: "unknown record" };
  const collection: string = parts.collection;

  if (ADMIN_ONLY_COLLECTIONS.includes(collection) && role !== "Admin") {
    return { ok: false, reason: `${collection} can only be changed by an Admin` };
  }
  if (APPEND_ONLY_COLLECTIONS.includes(collection)) {
    if (change.value === null)
      return { ok: false, reason: `${collection} entries cannot be deleted` };
    if (change.baseTs !== null || current !== undefined) {
      return { ok: false, reason: `${collection} entries cannot be changed once written` };
    }
  }
  return { ok: true };
}
