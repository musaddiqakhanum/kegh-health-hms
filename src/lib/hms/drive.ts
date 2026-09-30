/* Google Drive sync using Google Identity Services + Drive REST v3. */

/** See only the files this app created for the signed-in account (default). */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/**
 * Full Drive access. Needed for Team mode: `drive.file` is per-account, so a
 * file uploaded by one staff member's Google account is invisible to every
 * other account — even inside a folder everyone can open in Drive.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export type DriveScope = typeof DRIVE_FILE_SCOPE | typeof DRIVE_SCOPE;

const TOKEN_KEY = "kegh-hms-drive-token";

interface StoredToken {
  accessToken: string;
  expiresAt: number;
  /** Scope the token was minted with; absent on tokens stored by older builds. */
  scope?: DriveScope;
}

declare global {
  interface Window {
    google?: any;
  }
}

/** Token for `scope`, or null when it expired / was granted for another scope. */
export function getStoredToken(scope: DriveScope = DRIVE_FILE_SCOPE): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    if (t.expiresAt <= Date.now() + 30_000) return null;
    // Tokens saved before scopes were tracked are `drive.file`.
    return (t.scope ?? DRIVE_FILE_SCOPE) === scope ? t : null;
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Accepts a full Drive folder link, a `?id=` link or a bare folder id and
 * returns the id.
 */
export function parseFolderId(input: string): string {
  const value = (input || "").trim();
  if (!value) return "";
  const match = value.match(/(?:folders\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{10,})/);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : "";
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("#gis-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google script")));
      return;
    }
    const s = document.createElement("script");
    s.id = "gis-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google script"));
    document.head.appendChild(s);
  });
}

export async function connectDrive(
  clientId: string,
  scope: DriveScope = DRIVE_FILE_SCOPE,
): Promise<string> {
  if (!clientId) throw new Error("Enter your Google Client ID first.");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || "Google sign-in was cancelled."));
          return;
        }
        const token: StoredToken = {
          accessToken: resp.access_token,
          expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
          scope,
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve(token.accessToken);
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

async function api(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://www.googleapis.com/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) clearToken();
    throw new Error(`Google Drive error [${res.status}]: ${body}`);
  }
  return res;
}

export async function ensureFolder(token: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
  );
  const res = await api(token, `drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
  const data = (await res.json()) as { files: { id: string }[] };
  if (data.files?.length) return data.files[0]!.id;
  const created = await api(token, "drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  return ((await created.json()) as { id: string }).id;
}

/**
 * Resolves a folder id the user pasted (or that the app created) so the UI can
 * show which folder Team mode will read and write.
 */
export async function getFolder(
  token: string,
  folderId: string,
): Promise<{ id: string; name: string }> {
  const res = await api(
    token,
    `drive/v3/files/${folderId}?fields=id,name,mimeType&supportsAllDrives=true`,
  );
  const data = (await res.json()) as { id: string; name: string; mimeType?: string };
  if (data.mimeType && data.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error(`"${data.name}" is a file, not a folder.`);
  }
  return { id: data.id, name: data.name };
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export async function listKegFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await api(
    token,
    `drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=200&supportsAllDrives=true`,
  );
  const data = (await res.json()) as { files: DriveFile[] };
  return (data.files || []).filter((f) => f.name.endsWith(".keg"));
}

export async function downloadFile(token: string, fileId: string): Promise<Uint8Array> {
  const res = await api(token, `drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function uploadFile(
  token: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
  existingId?: string,
): Promise<string> {
  const metadata: Record<string, unknown> = existingId ? { name } : { name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([bytes as BufferSource], { type: "application/octet-stream" }));
  const res = await api(
    token,
    `upload/drive/v3/files${
      existingId ? `/${existingId}` : ""
    }?uploadType=multipart&fields=id&supportsAllDrives=true`,
    { method: existingId ? "PATCH" : "POST", body: form },
  );
  return ((await res.json()) as { id: string }).id;
}
