import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadState, saveState } from "./db";
import { mergeStates } from "./merge";
import {
  defaultSettings,
  emptyState,
  type Collection,
  type HmsState,
  type Settings,
} from "./types";

const SETTINGS_KEY = "kegh-hms-settings";

type Rec = { id: string; createdAt: number };

interface StoreCtx {
  state: HmsState;
  settings: Settings;
  ready: boolean;
  online: boolean;
  upsert: <T extends Rec>(collection: Collection, record: Partial<T> & { id?: string }) => string;
  remove: (collection: Collection, id: string) => void;
  replaceState: (next: HmsState) => void;
  mergeIn: (incoming: HmsState) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

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
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    const s = readSettings();
    setSettings(s);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    loadState().then((loaded) => {
      if (cancelled) return;
      setState(loaded);
      setReady(true);
    });
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      cancelled = true;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const persist = useCallback((next: HmsState) => {
    stateRef.current = next;
    setState(next);
    void saveState(next);
  }, []);

  const upsert = useCallback<StoreCtx["upsert"]>(
    (collection, record) => {
      const now = Date.now();
      const id = record.id ?? crypto.randomUUID();
      const prev = stateRef.current;
      const existing = (prev[collection] as Record<string, Rec>)[id];
      const next: HmsState = {
        ...prev,
        [collection]: {
          ...prev[collection],
          [id]: { ...existing, ...record, id, createdAt: existing?.createdAt ?? now },
        },
        ops: { ...prev.ops, [`${collection}:${id}`]: now },
      };
      persist(next);
      return id;
    },
    [persist],
  );

  const remove = useCallback<StoreCtx["remove"]>(
    (collection, id) => {
      const prev = stateRef.current;
      const copy = { ...(prev[collection] as Record<string, unknown>) };
      delete copy[id];
      persist({
        ...prev,
        [collection]: copy,
        deleted: { ...prev.deleted, [`${collection}:${id}`]: Date.now() },
      });
    },
    [persist],
  );

  const replaceState = useCallback((next: HmsState) => persist(next), [persist]);
  const mergeIn = useCallback(
    (incoming: HmsState) => persist(mergeStates(stateRef.current, incoming)),
    [persist],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      state,
      settings,
      ready,
      online,
      upsert,
      remove,
      replaceState,
      mergeIn,
      updateSettings,
    }),
    [state, settings, ready, online, upsert, remove, replaceState, mergeIn, updateSettings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHms(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHms must be used inside HmsProvider");
  return ctx;
}
