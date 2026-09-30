import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Cloud, FolderCheck, RefreshCw, Unlink, Users } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import {
  clearToken,
  connectDrive,
  getFolder,
  getStoredToken,
  parseFolderId,
} from "@/lib/hms/drive";
import { driveScopeFor, runSync } from "@/lib/hms/sync";
import { fmtDateTime } from "@/lib/hms/format";
import { Badge, Button, Card, Field, Input, PageHeader } from "@/components/hms/ui";

export const Route = createFileRoute("/sync")({
  head: () => ({
    meta: [
      { title: "Google Drive Sync — KEGH HMS" },
      {
        name: "description",
        content: "Sync hospital records across devices through your own Google Drive.",
      },
      { property: "og:title", content: "Google Drive Sync — KEGH HMS" },
      {
        property: "og:description",
        content: "Sync hospital records across devices through your own Google Drive.",
      },
    ],
  }),
  component: SyncPage,
});

function SyncPage() {
  const { settings, updateSettings, state, mergeIn } = useHms();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [folderName, setFolderName] = useState("");
  const teamMode = settings.driveTeamMode;
  const [connected, setConnected] = useState(() =>
    Boolean(getStoredToken(driveScopeFor({ driveTeamMode: teamMode }))),
  );

  // Switching between device mode and team mode changes the scope Google
  // granted, so the "connected" flag has to be re-checked against it.
  useEffect(() => {
    setConnected(Boolean(getStoredToken(driveScopeFor({ driveTeamMode: teamMode }))));
  }, [teamMode]);

  const connect = async () => {
    setBusy(true);
    try {
      const scope = driveScopeFor(settings);
      if (settings.driveTeamMode && !parseFolderId(settings.driveFolderId)) {
        throw new Error("Paste the shared folder link (or folder id) before connecting.");
      }
      await connectDrive(settings.driveClientId.trim(), scope);
      setConnected(true);
      toast.success(
        settings.driveTeamMode
          ? "Connected — syncing the shared team folder"
          : "Google Drive connected",
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checkFolder = async () => {
    const id = parseFolderId(settings.driveFolderId);
    if (!id) {
      toast.error("Paste a Drive folder link like https://drive.google.com/drive/folders/…");
      return;
    }
    setChecking(true);
    try {
      const token =
        getStoredToken(driveScopeFor(settings))?.accessToken ??
        (await connectDrive(settings.driveClientId.trim(), driveScopeFor(settings)));
      setConnected(true);
      const folder = await getFolder(token, id);
      setFolderName(folder.name);
      toast.success(`Folder found: ${folder.name}`);
    } catch (err) {
      setFolderName("");
      toast.error((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      const { merged, fileCount } = await runSync(state, settings);
      mergeIn(merged);
      updateSettings({ lastSyncAt: Date.now(), lastSyncFileCount: fileCount });
      setConnected(true);
      toast.success(`Synced with ${fileCount} device file${fileCount === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Google Drive Sync" subtitle="Your records stay in your own Google Drive" />

      <Card>
        <h2 className="mb-2 font-semibold">1. Create a Google Client ID (once, by the Admin)</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Open{" "}
            <a
              className="text-accent underline"
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noreferrer"
            >
              console.cloud.google.com
            </a>{" "}
            and create a project.
          </li>
          <li>Enable the "Google Drive API" for that project.</li>
          <li>Create an OAuth client ID of type "Web application".</li>
          <li>Add this site's address under "Authorised JavaScript origins".</li>
          <li>
            Copy the Client ID and paste it below — the same Client ID is used on every device.
          </li>
        </ol>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">2. Connect</h2>
        <Field label="Google Client ID">
          <Input
            placeholder="1234567890-abc.apps.googleusercontent.com"
            value={settings.driveClientId}
            onChange={(e) => updateSettings({ driveClientId: e.target.value })}
          />
        </Field>

        <div className="rounded-md bg-slate-50 p-4 ring-1 ring-border/60">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={settings.driveTeamMode}
              onChange={(e) => updateSettings({ driveTeamMode: e.target.checked })}
            />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                <Users className="h-4 w-4" /> Team mode — each staff member signs in with their own
                Google account
              </span>
              <span className="mt-1 block text-muted-foreground">
                Off: one shared Google account signs in on every device (uses the limited{" "}
                <code>drive.file</code> permission — the safest option). On: everybody keeps their
                own Google account and syncs one folder shared with them. Google's{" "}
                <code>drive.file</code> permission only shows files created by the account that
                granted it, so team mode requests full Drive access instead and is pinned to the
                folder below.
              </span>
            </span>
          </label>

          {settings.driveTeamMode ? (
            <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
              <Field label="Shared folder link or id">
                <Input
                  placeholder="https://drive.google.com/drive/folders/1AbC…"
                  value={settings.driveFolderId}
                  onChange={(e) => updateSettings({ driveFolderId: e.target.value })}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={checking || !settings.driveClientId}
                  onClick={checkFolder}
                >
                  <FolderCheck className="h-4 w-4" /> {checking ? "Checking…" : "Check folder"}
                </Button>
                {folderName ? <Badge tone="green">{folderName}</Badge> : null}
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  One person (the folder owner) creates a folder in Google Drive, right-clicks it →{" "}
                  <strong>Share</strong> → adds every staff member's Google address as{" "}
                  <strong>Editor</strong>. A Google Workspace Shared Drive works too.
                </li>
                <li>
                  Open that folder, copy the address from the browser and paste it above on every
                  device.
                </li>
                <li>
                  In the same Cloud project open{" "}
                  <strong>APIs &amp; Services → OAuth consent screen → Data access</strong> and add
                  the scope <code>https://www.googleapis.com/auth/drive</code> beside the existing{" "}
                  <code>drive.file</code> scope.
                </li>
                <li>
                  While the app is in <strong>Testing</strong>, add each staff member's Google
                  address under <strong>Audience → Test users</strong> (up to 100 people) —
                  otherwise Google blocks them with "access blocked".
                </li>
                <li>
                  Every device: paste the same Client ID, tick Team mode, paste the folder link,
                  press <strong>Connect</strong> and approve with that person's own Google account.
                </li>
              </ol>
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                Full Drive access is a <strong>restricted</strong> Google scope: outside "Testing"
                it needs Google's verification (a security review) to work for people who are not
                listed as test users. If the folder contains patient data, prefer the
                one-shared-account option plus encryption, or move to a proper server backend.
              </p>
            </div>
          ) : (
            <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              One Google account is shared by all devices (use a dedicated hospital account, not a
              personal one). Whoever signs in first should create the folder; every device then uses
              the same Client ID and folder — Google shows the patient-data warning screen until you
              click "Continue".
            </p>
          )}
        </div>

        <Field label="Drive folder name">
          <Input
            value={settings.driveFolderName}
            disabled={settings.driveTeamMode && Boolean(parseFolderId(settings.driveFolderId))}
            onChange={(e) => updateSettings({ driveFolderName: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !settings.driveClientId} onClick={connect}>
            <Cloud className="h-4 w-4" />{" "}
            {connected ? "Reconnect Google Drive" : "Connect Google Drive"}
          </Button>
          <Button variant="outline" disabled={busy || !settings.driveClientId} onClick={syncNow}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sync now
          </Button>
          {connected ? (
            <Button
              variant="ghost"
              onClick={() => {
                clearToken();
                setConnected(false);
                toast.success("Disconnected on this device");
              }}
            >
              <Unlink className="h-4 w-4" /> Disconnect
            </Button>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Status</h2>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            Connection:{" "}
            <Badge tone={connected ? "green" : "amber"}>
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </p>
          <p>
            Mode:{" "}
            <strong>
              {settings.driveTeamMode ? "Team (own Google account)" : "Shared account"}
            </strong>
          </p>
          <p>
            Auto-sync:{" "}
            <strong>
              {settings.autoSync ? `every ${settings.syncIntervalMinutes} min` : "off"}
            </strong>
          </p>
          <p>
            Last sync: <strong>{fmtDateTime(settings.lastSyncAt)}</strong>
          </p>
          <p>
            Device files in folder: <strong>{settings.lastSyncFileCount}</strong>
          </p>
          <p>
            Encryption: <strong>{settings.encryptionEnabled ? "on (AES-256-GCM)" : "off"}</strong>
          </p>
          <p>
            This device: <strong>{settings.deviceName}</strong>
          </p>
          <p className="break-all">
            Folder:{" "}
            <strong>
              {settings.driveTeamMode
                ? parseFolderId(settings.driveFolderId) || settings.driveFolderName
                : settings.driveFolderName}
            </strong>
          </p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Each device writes its own compressed .keg file. Every sync merges all device files,
          newest change per record wins.
        </p>
      </Card>
    </div>
  );
}
