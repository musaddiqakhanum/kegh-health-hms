import {
  connectDrive,
  downloadFile,
  DRIVE_FILE_SCOPE,
  DRIVE_SCOPE,
  ensureFolder,
  getStoredToken,
  listKegFiles,
  parseFolderId,
  uploadFile,
  type DriveScope,
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

/**
 * Team mode needs the wider `drive` scope because `drive.file` only exposes the
 * files created by the account that granted the token — a teammate's account
 * cannot list or download another account's `.keg` file even when both have
 * edit access to the same folder.
 */
export function driveScopeFor(settings: Pick<Settings, "driveTeamMode">): DriveScope {
  return settings.driveTeamMode ? DRIVE_SCOPE : DRIVE_FILE_SCOPE;
}

export interface SyncResult {
  merged: HmsState;
  fileCount: number;
  folderId: string;
}

export async function runSync(local: HmsState, settings: Settings): Promise<SyncResult> {
  const scope = driveScopeFor(settings);
  const token =
    getStoredToken(scope)?.accessToken ?? (await connectDrive(settings.driveClientId, scope));

  // A pinned folder id (Team mode) is used as-is so every staff member syncs
  // the very same folder; otherwise fall back to "find or create by name".
  const pinnedFolderId = parseFolderId(settings.driveFolderId);
  const folderId = pinnedFolderId || (await ensureFolder(token, settings.driveFolderName));
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

  return { merged, fileCount: mine ? files.length : files.length + 1, folderId };
}
