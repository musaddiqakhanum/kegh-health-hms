import { createContext } from "react";
import type { Role, User } from "./types";

/**
 * Per-device staff login session plumbing shared between the provider
 * (session.tsx) and the hook (useSession.ts).
 */

const SESSION_KEY = "kegh-hms-session";
const FAILURES_KEY = "kegh-hms-login-failures";

export type LoginOutcome =
  | { ok: true; userId: string; role: Role }
  | { ok: false; error: "invalid" }
  | { ok: false; error: "locked"; lockSeconds: number }
  /** Password sign-in needs a room; this device has none. Use the device PIN. */
  | { ok: false; error: "no-room" }
  /** First password sign-in on this device: enter a 4-digit PIN to set it. */
  | { ok: false; error: "pin-needed" }
  /** The room refused the sign-in; `message` is the room's text. */
  | { ok: false; error: "room"; message: string }
  /** The 12-hour offline window for this PIN has passed; sign in with the room. */
  | { ok: false; error: "expired" }
  /** Five wrong PINs: this device's PIN for the account was cleared. */
  | { ok: false; error: "cleared" };

interface Failures {
  count: number;
  until: number;
}

export function readFailures(): Failures {
  try {
    const raw = window.localStorage.getItem(FAILURES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Failures>) : {};
    return { count: Number(parsed.count) || 0, until: Number(parsed.until) || 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

export function writeFailures(f: Failures): void {
  window.localStorage.setItem(FAILURES_KEY, JSON.stringify(f));
}

export interface SessionMeta {
  id: string | null;
  /** When this session began (epoch ms) — 0 for legacy pre-meta sessions. */
  since: number;
}

/**
 * The session is stored as JSON so we know WHEN it began: an admin's
 * "sign out all devices" stamp drops every session older than the stamp.
 * Legacy plain-id values from before this change read back with since = 0,
 * which is exactly the "older than any future stamp" behaviour we want.
 */
export function readSessionMeta(): SessionMeta {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return { id: null, since: 0 };
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as Partial<SessionMeta>;
      return { id: parsed.id ?? null, since: Number(parsed.since) || 0 };
    }
    return { id: raw, since: 0 };
  } catch {
    return { id: null, since: 0 };
  }
}

export function readSessionId(): string | null {
  return readSessionMeta().id;
}

export function writeSessionId(id: string | null, since?: number): void {
  try {
    if (id === null) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify({ id, since: since ?? 0 }));
  } catch {
    /* storage unavailable */
  }
}

/** True when the session began before the admin's force-sign-out stamp. */
export function sessionKickedOut(signedInAt: number, kickedAt: number | undefined): boolean {
  return typeof kickedAt === "number" && signedInAt < kickedAt;
}

/** True when a signed-in device has been idle longer than `idleMinutes` (> 0). */
export function idleTimedOut(lastActivity: number, now: number, idleMinutes: number): boolean {
  return idleMinutes > 0 && now - lastActivity >= idleMinutes * 60_000;
}

export interface SessionCtx {
  /** The signed-in user, or null when logged out / no session. */
  user: User | null;
  /** Room sign-in with the staff password. `newPin` sets the device PIN on a first sign-in here. */
  login: (username: string, password: string, newPin?: string) => Promise<LoginOutcome>;
  /** Offline sign-in with the device PIN for this account. */
  loginWithPin: (username: string, pin: string) => Promise<LoginOutcome>;
  logout: () => void;
}

export const SessionContext = createContext<SessionCtx | null>(null);
