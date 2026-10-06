import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { findUserByUsername } from "./selectors";
import { useHms } from "./store";
import { verifyPassword } from "./crypto";
import {
  idleTimedOut,
  readFailures,
  readSessionMeta,
  SessionContext,
  sessionKickedOut,
  writeFailures,
  writeSessionId,
  type LoginOutcome,
} from "./session-context";
import type { AuditLog, User } from "./types";

/**
 * Per-device staff login session.
 *
 * The signed-in user id lives in localStorage (device-local, like the device
 * PIN — never synced with the hospital data). While signed in, the user's
 * role drives the nav and the AdminOnly gates exactly like `settings.role`
 * did; when nobody is signed in (or login is not required) the app falls
 * back to `settings.role` as before.
 */

/** Failed attempts on this device before a brief lockout kicks in. */
const MAX_FAILURES = 5;
/** How long the device stays locked after `MAX_FAILURES` failures. */
const LOCKOUT_MS = 60_000;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { state, settings, upsert } = useHms();
  const [initialMeta] = useState(readSessionMeta);
  const [sessionId, setSessionId] = useState<string | null>(initialMeta.id);
  const [signedInAt, setSignedInAt] = useState<number>(initialMeta.since);
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Last keyboard / pointer activity on this device — drives the auto-lock. */
  const lastActivityRef = useRef(Date.now());

  const user = useMemo(() => {
    if (!sessionId) return null;
    const u = state.users[sessionId];
    return u && u.active ? u : null;
  }, [state.users, sessionId]);
  const userRef = useRef(user);
  userRef.current = user;

  // A session pointing at a removed or disabled account is simply dropped.
  useEffect(() => {
    if (sessionId && !user) {
      setSessionId(null);
      writeSessionId(null);
    }
  }, [sessionId, user]);

  const writeAudit = useCallback(
    (action: "login" | "logout", userId: string, role: string) => {
      const s = settingsRef.current;
      upsert<AuditLog>("auditLogs", {
        id: crypto.randomUUID(),
        action,
        collection: "users",
        recordId: userId,
        timestamp: Date.now(),
        deviceName: s.deviceName,
        role,
      } as Partial<AuditLog>);
    },
    [upsert],
  );

  /** End the current device session with an audit row and a visible reason. */
  const dropSession = useCallback(
    (message: string | null) => {
      const u = userRef.current;
      if (u) writeAudit("logout", u.id, u.role);
      writeSessionId(null);
      setSessionId(null);
      setSignedInAt(0);
      if (message) toast.error(message);
    },
    [writeAudit],
  );

  // Force sign-out: an admin's stamp on the account (arriving with a sync)
  // drops every session for that account that began before the stamp.
  useEffect(() => {
    if (user && sessionKickedOut(signedInAt, user.sessionsKickedAt)) {
      dropSession("Signed out — an administrator ended this session");
    }
  }, [user, signedInAt, dropSession]);

  // Idle auto-lock per device (0 = off). Any keystroke or tap resets the clock.
  useEffect(() => {
    const mark = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    const timer = window.setInterval(() => {
      const limit = settingsRef.current.idleLockMinutes ?? 0;
      if (userRef.current && idleTimedOut(lastActivityRef.current, Date.now(), limit)) {
        dropSession(`Locked after ${limit} min idle — sign in again`);
      }
    }, 15_000);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      window.clearInterval(timer);
    };
  }, [dropSession]);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginOutcome> => {
      const now = Date.now();
      const f = readFailures();
      if (f.until > now) {
        return { ok: false, error: "locked", lockSeconds: Math.ceil((f.until - now) / 1000) };
      }

      const candidate = findUserByUsername(stateRef.current, username);
      const valid =
        candidate && candidate.active
          ? await verifyPassword(password, candidate.salt, candidate.passwordHash)
          : false;

      if (!valid) {
        const count = f.count + 1;
        // Same generic failure for unknown usernames, disabled accounts and
        // wrong passwords — no username enumeration.
        writeFailures(
          count >= MAX_FAILURES ? { count: 0, until: now + LOCKOUT_MS } : { count, until: 0 },
        );
        return { ok: false, error: "invalid" };
      }

      const u = candidate as User;
      writeFailures({ count: 0, until: 0 });
      writeSessionId(u.id, now);
      setSessionId(u.id);
      setSignedInAt(now);
      lastActivityRef.current = now;
      writeAudit("login", u.id, u.role);
      return { ok: true, user: u };
    },
    [writeAudit],
  );

  const logout = useCallback(() => {
    if (user) writeAudit("logout", user.id, user.role);
    writeSessionId(null);
    setSessionId(null);
  }, [user, writeAudit]);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
