/**
 * Device sign-in PINs for staff accounts (phase 4b, item 4).
 *
 * Each device keeps a salted PBKDF2 hash of a 4-digit PIN per staff member, in
 * device-local storage that is never synced or backed up. The PIN signs a staff
 * member in when the room cannot be reached (or when the device has no room).
 *
 * Rules:
 * - A PIN is set after a room sign-in on this device (the staff member enters it
 *   with their password), or by an Admin on a device with no room.
 * - Five wrong PINs in a row clear this device's record for that user. The user
 *   then needs a room sign-in.
 * - A PIN set after a room sign-in lasts 12 hours from the last room sign-in.
 *   A PIN set on a device with no room does not expire.
 *
 * Storage is injected (localStorage in the app, a Map in tests).
 */
import { hashPassword, newSaltHex, verifyPassword } from "./crypto";
import type { Role } from "./types";

export const OFFLINE_SESSION_MS = 12 * 60 * 60 * 1000;
export const PIN_MAX_FAILURES = 5;
export const PIN_STORAGE_KEY = "kegh-hms-offline-pins";

export interface PinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OfflinePinRecord {
  userId: string;
  /** Lower-cased username, the lookup key at the login screen. */
  username: string;
  role: Role;
  displayName: string;
  salt: string;
  pinHash: string;
  failures: number;
  /** Last room sign-in on this device. null = set on a device with no room (no expiry). */
  roomSignInAt: number | null;
}

export type PinCheck =
  | { ok: true; record: OfflinePinRecord }
  | { ok: false; error: "invalid" | "cleared" | "expired" | "no-pin" };

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

function normalise(username: string): string {
  return username.trim().toLowerCase();
}

export function readPinRecords(storage: PinStorage): Record<string, OfflinePinRecord> {
  try {
    const raw = storage.getItem(PIN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, OfflinePinRecord>) : {};
  } catch {
    return {};
  }
}

function writePinRecords(storage: PinStorage, records: Record<string, OfflinePinRecord>): void {
  storage.setItem(PIN_STORAGE_KEY, JSON.stringify(records));
}

export function findPinRecord(storage: PinStorage, username: string): OfflinePinRecord | undefined {
  const name = normalise(username);
  return Object.values(readPinRecords(storage)).find((r) => r.username === name);
}

/** Set (or replace) this device's PIN for a staff member. Throws if the PIN is not 4 digits. */
export async function setPinRecord(
  storage: PinStorage,
  user: { id: string; username: string; role: Role; displayName: string },
  pin: string,
  roomSignInAt: number | null,
): Promise<OfflinePinRecord> {
  if (!isValidPin(pin)) throw new Error("PIN must be 4 digits");
  const salt = newSaltHex();
  const record: OfflinePinRecord = {
    userId: user.id,
    username: normalise(user.username),
    role: user.role,
    displayName: user.displayName,
    salt,
    pinHash: await hashPassword(pin, salt),
    failures: 0,
    roomSignInAt,
  };
  const records = readPinRecords(storage);
  // One record per username: drop any older record for the same account.
  for (const [key, existing] of Object.entries(records)) {
    if (existing.username === record.username) delete records[key];
  }
  records[user.id] = record;
  writePinRecords(storage, records);
  return record;
}

/** Record a room sign-in on this device: restarts the 12-hour offline window. */
export function markRoomSignIn(storage: PinStorage, userId: string, now: number): void {
  const records = readPinRecords(storage);
  const record = records[userId];
  if (!record) return;
  records[userId] = { ...record, roomSignInAt: now, failures: 0 };
  writePinRecords(storage, records);
}

export function removePinRecord(storage: PinStorage, userId: string): void {
  const records = readPinRecords(storage);
  if (!(userId in records)) return;
  delete records[userId];
  writePinRecords(storage, records);
}

/** Check a PIN. Counts wrong PINs and clears the record after PIN_MAX_FAILURES. */
export async function checkPin(
  storage: PinStorage,
  username: string,
  pin: string,
  now: number,
): Promise<PinCheck> {
  const record = findPinRecord(storage, username);
  if (!record) return { ok: false, error: "no-pin" };
  if (record.roomSignInAt !== null && now - record.roomSignInAt > OFFLINE_SESSION_MS) {
    return { ok: false, error: "expired" };
  }
  const good = isValidPin(pin) && (await verifyPassword(pin, record.salt, record.pinHash));
  const records = readPinRecords(storage);
  if (good) {
    if (record.failures !== 0) {
      records[record.userId] = { ...record, failures: 0 };
      writePinRecords(storage, records);
    }
    return { ok: true, record };
  }
  const failures = record.failures + 1;
  if (failures >= PIN_MAX_FAILURES) {
    if (record.roomSignInAt === null) {
      // A device with no room has no way to get a PIN back. Clearing the record
      // could lock everyone out, so the count restarts and the device's own
      // 60-second lockout applies instead.
      records[record.userId] = { ...record, failures: 0 };
      writePinRecords(storage, records);
      return { ok: false, error: "invalid" };
    }
    delete records[record.userId];
    writePinRecords(storage, records);
    return { ok: false, error: "cleared" };
  }
  records[record.userId] = { ...record, failures };
  writePinRecords(storage, records);
  return { ok: false, error: "invalid" };
}
