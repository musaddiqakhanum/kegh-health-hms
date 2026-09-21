import {
  connectDrive,
  downloadFile,
  ensureFolder,
  getStoredToken,
  listKegFiles,
  uploadFile,
} from "./drive";
import { mergeStates } from "./merge";
import { packState, unpackState } from "./pack";
import type { HmsState, Settings } from "./types";

const PASS_KEY = "kegh-hms-pass";

export function getPassphrase(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(PASS_KEY) ?? "";
}
export function setPassphrase(p: string) {
  if (p) sessionStorage.setItem(PASS_KEY, p);
  else sessionStorage.removeItem(PASS_KEY);
}

export interface SyncResult {
  merged: HmsState;
  fileCount: number;
}

export async function runSync(local: HmsState, settings: Settings): Promise<SyncResult> {
  const token = getStoredToken()?.accessToken ?? (await connectDrive(settings.driveClientId));
  const folderId = await ensureFolder(token, settings.driveFolderName);
  const files = await listKegFiles(token, folderId);

  const passphrase = settings.encryptionEnabled ? getPassphrase() : "";
  if (settings.encryptionEnabled && !passphrase) {
    throw new Error("Encryption is on but no passphrase is set for this session.");
  }

  let merged = local;
  for (const f of files) {
    try {
      const bytes = await downloadFile(token, f.id);
      const remote = await unpackState(bytes, passphrase || undefined);
      merged = mergeStates(merged, remote);
    } catch (err) {
      console.error(`Skipping ${f.name}:`, err);
    }
  }

  const myName = `kegh-${settings.deviceId || "device"}.keg`;
  const mine = files.find((f) => f.name === myName);
  const bytes = await packState(merged, passphrase || undefined);
  await uploadFile(token, folderId, myName, bytes, mine?.id);

  return { merged, fileCount: mine ? files.length : files.length + 1 };
}
