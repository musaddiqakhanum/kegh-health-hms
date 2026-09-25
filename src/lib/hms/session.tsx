import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findUserByUsername } from "./selectors";
import { useHms } from "./store";
import { verifyPassword } from "./crypto";
import {
  readFailures,
  readSessionId,
  SessionContext,
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
  const [sessionId, setSessionId] = useState<string | null>(readSessionId);
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const user = useMemo(() => {
    if (!sessionId) return null;
    const u = state.users[sessionId];
    return u && u.active ? u : null;
  }, [state.users, sessionId]);

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
      writeSessionId(u.id);
      setSessionId(u.id);
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
