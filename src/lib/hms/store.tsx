import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadState, loadSyncSnapshot, saveState, saveSyncSnapshot } from "./db";
import { hashPassword, newSaltHex } from "./crypto";
import { seedIndianDrugs } from "./medcatalog";
import { seedPayers } from "./claims";
import { seedOtProcedures } from "./ot";
import { mergeStates } from "./merge";
import { craftAuditEntry, isAuditedCollection } from "./audit";
import { DeviceSync, type ReviewItem, type Update } from "./sync-core";
import { compareWithRoom as compareShadow, type ShadowReport } from "./shadow";
import { RealtimeClient, type LoginResult, type RealtimeSnapshot } from "./realtime";
import {
  applyUpdates,
  ConnectReconcile,
  journalEntries,
  localEntries,
  reconcileEntries,
  roomKeyOf,
  setRecord,
  shadowOf,
  splitKey,
  unsyncedEntries,
  type Shadow,
} from "./realtime-state";
import {
  defaultSettings,
  emptyState,
  type Collection,
  type HmsState,
  type Settings,
} from "./types";

const SETTINGS_KEY = "kegh-hms-settings";

type Rec = { id: string; createdAt: number };

export type RealtimeInfo = RealtimeSnapshot & { configured: boolean };

interface StoreCtx {
  state: HmsState;
  settings: Settings;
  ready: boolean;
  online: boolean;
  realtime: RealtimeInfo;
  /** Conflicts the room reported to this device (reviewed and not). */
  conflicts: ReviewItem[];
  /** "older" applies the losing version as a new edit; "current" keeps what is there. Either way it is marked reviewed. */
  resolveConflict: (seq: number, choice: "older" | "current") => void;
  /** Sign this device in to the room as a staff member (needs a room address). */
  realtimeSignIn: (username: string, password: string) => Promise<LoginResult>;
  /** End this device's room session. Unsent changes stay on the device. */
  realtimeSignOut: () => void;
  upsert: <T extends Rec>(collection: Collection, record: Partial<T> & { id?: string }) => string;
  remove: (collection: Collection, id: string) => void;
  replaceState: (next: HmsState) => void;
  /** Merge a state in and reconcile it with the room. Returns how many records were sent (0 while offline or catching up). */
  mergeIn: (incoming: HmsState) => number;
  /** Shadow run: compare a Drive state with the room (read-only). Null unless connected. */
  compareWithRoom: (drive: HmsState) => { report: ShadowReport; pending: number } | null;
  updateSettings: (patch: Partial<Settings>) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

const IDLE_REALTIME: RealtimeSnapshot = {
  status: "offline",
  pending: 0,
  error: null,
  signedIn: false,
};

/** The room session token is kept per browser tab (sessionStorage), per room. */
const TOKEN_KEY_PREFIX = "kegh-hms-room-session:";
function readRoomToken(roomKey: string): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY_PREFIX + roomKey);
  } catch {
    return null;
  }
}
function writeRoomToken(roomKey: string, token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY_PREFIX + roomKey, token);
    else window.sessionStorage.removeItem(TOKEN_KEY_PREFIX + roomKey);
  } catch {
    // Storage is unavailable (private mode): the device signs in again after reload.
  }
}

interface Session {
  device: DeviceSync;
  client: RealtimeClient;
  reconcile: ConnectReconcile;
}

function readSettings(): Settings {
  const base = defaultSettings();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    const merged = { ...base, ...parsed };
    if (!merged.deviceId) merged.deviceId = crypto.randomUUID().slice(0, 8);
    return merged;
  } catch {
    return base;
  }
}

export function HmsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HmsState>(emptyState);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [realtime, setRealtime] = useState<RealtimeSnapshot>(IDLE_REALTIME);
  const [conflicts, setConflicts] = useState<ReviewItem[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Last state the sync layer has accounted for (see realtime-state.ts). */
  const shadowRef = useRef<Shadow>(new Map());
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    const s = readSettings();
    setSettings(s);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    loadState().then((loaded) => {
      if (cancelled) return;
      const seeded = seedOtProcedures(seedPayers(seedIndianDrugs(loaded)));
      shadowRef.current = shadowOf(seeded);
      setState(seeded);
      setReady(true);
    });
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      sessionRef.current?.client.reconnectNow();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      cancelled = true;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  /* Stamp one audit row into the same state object as the write it logs —
     a single persist, mergeable like any record, and no extra render pass. */
  const audit = useCallback(
    (
      prev: HmsState,
      action: "create" | "update" | "delete",
      collection: string,
      recordId: string,
      now: number,
    ) => {
      if (!isAuditedCollection(collection)) return { auditLogs: prev.auditLogs, entries: {} };
      const entry = craftAuditEntry({
        state: prev,
        settings: settingsRef.current,
        action,
        collection,
        recordId,
        now,
      });
      return {
        auditLogs: { ...prev.auditLogs, [entry.id]: entry },
        entries: { [`auditLogs:${entry.id}`]: now },
      };
    },
    [],
  );

  /** Store a new state without sending it to the room (remote updates, bulk imports). */
  const persistQuiet = useCallback((next: HmsState) => {
    stateRef.current = next;
    setState(next);
    void saveState(next);
  }, []);

  /** Local edit: journal the changed records for the room, then store. */
  const persist = useCallback(
    (next: HmsState) => {
      const entries = journalEntries(shadowRef.current, next, Date.now());
      const session = sessionRef.current;
      if (session && entries.length > 0) {
        for (const e of entries) session.device.write(e.key, e.value, e.ts);
        session.client.notifyLocal();
      }
      persistQuiet(next);
    },
    [persistQuiet],
  );

  /** Send records the room does not have (or has differently) when connected. While catching up, keep them for the reconcile that follows. */
  const reconcileLive = useCallback((next: HmsState): number => {
    const session = sessionRef.current;
    if (!session) return 0;
    if (!session.client.connected) {
      // Catching up: keep the merged state for the reconcile that follows catch-up.
      session.reconcile.queue(localEntries(next, Date.now()));
      return 0;
    }
    const changes = reconcileEntries(
      localEntries(next, Date.now()),
      (key) => session.device.version(key),
      session.device.pendingKeys(),
    );
    if (changes.length === 0) return 0;
    for (const e of changes) session.device.importLocal(e.key, e.value, e.ts);
    session.client.notifyLocal();
    return changes.length;
  }, []);

  /** Room updates: apply to local state without echoing them back. */
  const applyRemote = useCallback(
    (updates: Update[]) => {
      persistQuiet(applyUpdates(stateRef.current, shadowRef.current, updates));
      const session = sessionRef.current;
      if (session) setConflicts(session.device.conflictList());
    },
    [persistQuiet],
  );

  const resolveConflict = useCallback<StoreCtx["resolveConflict"]>(
    (seq, choice) => {
      const session = sessionRef.current;
      if (!session) return;
      const item = session.device.conflictList().find((c) => c.seq === seq);
      if (!item) return;
      if (choice === "older") {
        const now = Date.now();
        const prev = stateRef.current;
        let next = setRecord(prev, item.key, item.other.value, now);
        const parts = splitKey(item.key);
        if (parts) {
          const { auditLogs, entries } = audit(prev, "update", parts.collection, parts.id, now);
          next = { ...next, auditLogs, ops: { ...next.ops, ...entries } };
        }
        persist(next);
      }
      session.device.markReviewed(seq);
      session.client.notifyLocal();
      setConflicts(session.device.conflictList());
    },
    [persist, audit],
  );

  /* Room session: follows the configured room address. Runs after the local
     state is loaded, so the first writes are never missed. */
  useEffect(() => {
    if (!ready) return;
    const url = settings.realtimeUrl.trim();
    const roomKey = roomKeyOf(url);
    if (!roomKey) {
      sessionRef.current?.client.stop();
      sessionRef.current = null;
      setRealtime(IDLE_REALTIME);
      setConflicts([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const snap = await loadSyncSnapshot(roomKey);
      if (cancelled) return;
      const device = snap
        ? DeviceSync.fromSnapshot(snap)
        : // Start the counter at the current time, so a lost snapshot cannot reuse old (deviceId, devSeq) pairs.
          new DeviceSync(settingsRef.current.deviceId, Date.now());
      const reconcile = new ConnectReconcile();
      const client = new RealtimeClient({
        url,
        device,
        token: readRoomToken(roomKey),
        hooks: {
          onSession: (token) => writeRoomToken(roomKey, token),
          // Keep only local changes the room has not seen. Taken before catch-up
          // replaces this device's view. Records this device merely holds are not
          // changes, so catch-up must not turn them into conflicts.
          onConnecting: () => {
            reconcile.begin(
              unsyncedEntries(
                stateRef.current,
                (key) => device.version(key),
                device.pendingKeys(),
                Date.now(),
              ),
            );
          },
          onUpdates: applyRemote,
          onCaughtUp: () => {
            const changes = reconcile.finish((key) => device.version(key), device.pendingKeys());
            for (const e of changes) device.importLocal(e.key, e.value, e.ts);
          },
          onStatus: (s) => {
            if (!cancelled) setRealtime(s);
          },
          onJournal: (snapshot) => {
            void saveSyncSnapshot(roomKey, snapshot);
            if (!cancelled) setConflicts(device.conflictList());
          },
        },
      });
      sessionRef.current?.client.stop();
      sessionRef.current = { device, client, reconcile };
      setConflicts(device.conflictList());
      client.start();
    })();

    return () => {
      cancelled = true;
      sessionRef.current?.client.stop();
      sessionRef.current = null;
    };
  }, [ready, settings.realtimeUrl, applyRemote]);

  const realtimeSignIn = useCallback<StoreCtx["realtimeSignIn"]>(async (username, password) => {
    const session = sessionRef.current;
    if (!session)
      return { ok: false, error: "Real-time sync is off. Set a room address in Settings." };
    const name = username.trim().toLowerCase();
    const local = Object.values(stateRef.current.users).find(
      (u) => u.username.trim().toLowerCase() === name,
    );
    let result = await session.client.signIn(username, password);
    // The room has no account for this login yet: if this device holds the
    // hospital's Admin record, offer it (the room takes it only while it has no
    // active Admin). Sent on this retry only, so ordinary sign-ins never send it.
    if (!result.ok && local && local.role === "Admin" && local.active) {
      // The device keeps no password material, so the record it offers carries a
      // hash of the password just typed.
      const salt = newSaltHex();
      const setup = { ...local, salt, passwordHash: await hashPassword(password, salt) };
      result = await session.client.signIn(username, password, setup);
    }
    return result;
  }, []);

  const realtimeSignOut = useCallback<StoreCtx["realtimeSignOut"]>(() => {
    sessionRef.current?.client.signOut();
  }, []);

  const upsert = useCallback<StoreCtx["upsert"]>(
    (collection, record) => {
      const now = Date.now();
      const id = record.id ?? crypto.randomUUID();
      const prev = stateRef.current;
      const existing = (prev[collection] as Record<string, Rec>)[id];
      const { auditLogs, entries } = audit(
        prev,
        existing ? "update" : "create",
        collection,
        id,
        now,
      );
      const next: HmsState = {
        ...prev,
        [collection]: {
          ...prev[collection],
          [id]: { ...existing, ...record, id, createdAt: existing?.createdAt ?? now },
        },
        auditLogs,
        ops: { ...prev.ops, ...entries, [`${collection}:${id}`]: now },
      };
      persist(next);
      return id;
    },
    [persist, audit],
  );

  const remove = useCallback<StoreCtx["remove"]>(
    (collection, id) => {
      const prev = stateRef.current;
      const copy = { ...(prev[collection] as Record<string, unknown>) };
      delete copy[id];
      const now = Date.now();
      const { auditLogs, entries } = audit(prev, "delete", collection, id, now);
      persist({
        ...prev,
        [collection]: copy,
        auditLogs,
        ops: { ...prev.ops, ...entries },
        deleted: { ...prev.deleted, [`${collection}:${id}`]: now },
      });
    },
    [persist, audit],
  );

  // Bulk replacements (backup restore, Drive merge) are reconciled with the room
  // rather than journaled one record at a time. A restore never deletes room data.
  const replaceState = useCallback(
    (next: HmsState) => {
      shadowRef.current = shadowOf(next);
      persistQuiet(next);
      reconcileLive(next);
    },
    [persistQuiet, reconcileLive],
  );
  const compareWithRoom = useCallback<StoreCtx["compareWithRoom"]>((drive) => {
    const session = sessionRef.current;
    if (!session || !session.client.connected) return null;
    return {
      report: compareShadow(
        drive,
        (key) => session.device.version(key),
        session.device.versionKeys(),
      ),
      pending: session.device.pending().length,
    };
  }, []);
  const mergeIn = useCallback(
    (incoming: HmsState): number => {
      const next = mergeStates(stateRef.current, incoming);
      shadowRef.current = shadowOf(next);
      persistQuiet(next);
      return reconcileLive(next);
    },
    [persistQuiet, reconcileLive],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const realtimeInfo = useMemo<RealtimeInfo>(
    () => ({ ...realtime, configured: roomKeyOf(settings.realtimeUrl) !== null }),
    [realtime, settings.realtimeUrl],
  );

  const value = useMemo(
    () => ({
      state,
      settings,
      ready,
      online,
      realtime: realtimeInfo,
      conflicts,
      resolveConflict,
      realtimeSignIn,
      realtimeSignOut,
      upsert,
      remove,
      replaceState,
      mergeIn,
      compareWithRoom,
      updateSettings,
    }),
    [
      state,
      settings,
      ready,
      online,
      realtimeInfo,
      conflicts,
      resolveConflict,
      realtimeSignIn,
      realtimeSignOut,
      upsert,
      remove,
      replaceState,
      mergeIn,
      compareWithRoom,
      updateSettings,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHms(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHms must be used inside HmsProvider");
  return ctx;
}
