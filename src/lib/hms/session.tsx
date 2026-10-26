import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useHms } from "./store";
import {
  checkPin,
  findPinRecord,
  isValidPin,
  markRoomSignIn,
  setPinRecord,
  type PinStorage,
} from "./offline-signin";
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
import type { AuditLog } from "./types";

/**
 * Per-device staff login session.
 *
 * The signed-in user id lives in localStorage (device-local, like the device
 * PIN — never synced with the hospital data). While signed in, the user's
 * role drives the nav and the AdminOnly gates exactly like `settings.role`
 * did; when nobody is signed in (or login is not required) the app falls
 * back to `settings.role` as before.
 *
 * Two ways in (phase 4b, item 4):
 * - Staff password, checked by the room. Needs a room connection.
 * - Device PIN, checked on this device. Works offline, for 12 hours after the
 *   last room sign-in on this device.
 * The device keeps no password material.
 */

/** Failed attempts on this device before a brief lockout kicks in. */
const MAX_FAILURES = 5;
/** How long the device stays locked after `MAX_FAILURES` failures. */
const LOCKOUT_MS = 60_000;

/** The device's PIN records, in localStorage (never synced or backed up). */
function localPinStorage(): PinStorage {
  return window.localStorage;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { state, settings, upsert, realtime, realtimeSignIn, realtimeSignOut } = useHms();
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

  // A session pointing at a removed or disabled account is dropped. Wait until
  // the device has any users: a first room sign-in can land before catch-up.
  useEffect(() => {
    if (sessionId && !user && Object.keys(state.users).length > 0) {
      setSessionId(null);
      writeSessionId(null);
    }
  }, [sessionId, user, state.users]);

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
      realtimeSignOut();
      if (message) toast.error(message);
    },
    [writeAudit, realtimeSignOut],
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

  const startSession = useCallback(
    (userId: string, role: string, now: number) => {
      writeFailures({ count: 0, until: 0 });
      writeSessionId(userId, now);
      setSessionId(userId);
      setSignedInAt(now);
      lastActivityRef.current = now;
      writeAudit("login", userId, role);
    },
    [writeAudit],
  );

  /** Staff password, checked by the room. A first sign-in here sets the device PIN from `newPin`. */
  const login = useCallback(
    async (username: string, password: string, newPin?: string): Promise<LoginOutcome> => {
      const now = Date.now();
      const f = readFailures();
      if (f.until > now) {
        return { ok: false, error: "locked", lockSeconds: Math.ceil((f.until - now) / 1000) };
      }
      if (!realtime.configured) return { ok: false, error: "no-room" };

      const pins = localPinStorage();
      const needsPin = findPinRecord(pins, username) === undefined;
      if (needsPin && (!newPin || !isValidPin(newPin))) return { ok: false, error: "pin-needed" };

      const r = await realtimeSignIn(username, password);
      if (!r.ok) {
        const count = f.count + 1;
        writeFailures(
          count >= MAX_FAILURES ? { count: 0, until: now + LOCKOUT_MS } : { count, until: 0 },
        );
        return { ok: false, error: "room", message: r.error };
      }

      const { id, role, displayName } = r.user;
      if (needsPin && newPin) {
        await setPinRecord(pins, { id, username: r.user.username, role, displayName }, newPin, now);
      } else {
        markRoomSignIn(pins, id, now);
      }
      startSession(id, role, now);
      return { ok: true, userId: id, role };
    },
    [realtime.configured, realtimeSignIn, startSession],
  );

  /** Device PIN, checked on this device. Works without a room, within the offline window. */
  const loginWithPin = useCallback(
    async (username: string, pin: string): Promise<LoginOutcome> => {
      const now = Date.now();
      const f = readFailures();
      if (f.until > now) {
        return { ok: false, error: "locked", lockSeconds: Math.ceil((f.until - now) / 1000) };
      }
      const check = await checkPin(localPinStorage(), username, pin, now);
      if (!check.ok) {
        if (check.error === "expired") return { ok: false, error: "expired" };
        const count = f.count + 1;
        writeFailures(
          count >= MAX_FAILURES ? { count: 0, until: now + LOCKOUT_MS } : { count, until: 0 },
        );
        return { ok: false, error: check.error === "cleared" ? "cleared" : "invalid" };
      }
      // The account must still exist and be active on this device.
      const current = stateRef.current.users[check.record.userId];
      if (!current || !current.active) return { ok: false, error: "invalid" };
      startSession(current.id, current.role, now);
      return { ok: true, userId: current.id, role: current.role };
    },
    [startSession],
  );

  const logout = useCallback(() => {
    if (user) writeAudit("logout", user.id, user.role);
    writeSessionId(null);
    setSessionId(null);
    realtimeSignOut();
  }, [user, writeAudit, realtimeSignOut]);

  const value = useMemo(
    () => ({ user, login, loginWithPin, logout }),
    [user, login, loginWithPin, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
