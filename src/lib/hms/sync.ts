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
  type DriveFile,
  type DriveScope,
} from "./drive";
import { mergeStates } from "./merge";
import { packState, unpackState } from "./pack";
import { emptyState, type HmsState, type Settings } from "./types";

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

export interface DriveRead {
  /** Each readable `.keg` file, unpacked. Unreadable files are skipped. */
  remotes: HmsState[];
  /** The listed `.keg` files. */
  files: DriveFile[];
  folderId: string;
  token: string;
  passphrase: string;
}

/**
 * Read every `.keg` file in the Drive folder. Reads only: nothing is uploaded.
 * Used by the sync itself and by the shadow-run comparison.
 */
export async function readDriveFiles(settings: Settings): Promise<DriveRead> {
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

  const remotes: HmsState[] = [];
  for (const f of files) {
    try {
      const bytes = await downloadFile(token, f.id);
      remotes.push(await unpackState(bytes, passphrase || undefined));
    } catch (err) {
      console.error(`Skipping ${f.name}:`, err);
    }
  }
  return { remotes, files, folderId, token, passphrase };
}

/** All Drive states merged into one (no local state involved). */
export function mergeDriveStates(remotes: readonly HmsState[]): HmsState {
  return remotes.reduce((acc, remote) => mergeStates(acc, remote), emptyState());
}

export async function runSync(local: HmsState, settings: Settings): Promise<SyncResult> {
  const { remotes, files, folderId, token, passphrase } = await readDriveFiles(settings);

  let merged = local;
  for (const remote of remotes) merged = mergeStates(merged, remote);

  const myName = `kegh-${settings.deviceId || "device"}.keg`;
  const mine = files.find((f) => f.name === myName);
  const bytes = await packState(merged, passphrase || undefined);
  await uploadFile(token, folderId, myName, bytes, mine?.id);

  return { merged, fileCount: mine ? files.length : files.length + 1, folderId };
}
