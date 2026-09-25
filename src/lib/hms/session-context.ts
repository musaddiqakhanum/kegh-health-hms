import { createContext } from "react";
import type { User } from "./types";

/**
 * Per-device staff login session plumbing shared between the provider
 * (session.tsx) and the hook (useSession.ts).
 */

const SESSION_KEY = "kegh-hms-session";
const FAILURES_KEY = "kegh-hms-login-failures";

export type LoginOutcome =
  | { ok: true; user: User }
  | { ok: false; error: "invalid" }
  | { ok: false; error: "locked"; lockSeconds: number };

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

export function readSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeSessionId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export interface SessionCtx {
  /** The signed-in user, or null when logged out / no session. */
  user: User | null;
  login: (username: string, password: string) => Promise<LoginOutcome>;
  logout: () => void;
}

export const SessionContext = createContext<SessionCtx | null>(null);
