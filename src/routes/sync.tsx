import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Cloud, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { clearToken, connectDrive, getStoredToken } from "@/lib/hms/drive";
import { runSync } from "@/lib/hms/sync";
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
  const [connected, setConnected] = useState(() => Boolean(getStoredToken()));

  const connect = async () => {
    setBusy(true);
    try {
      await connectDrive(settings.driveClientId.trim());
      setConnected(true);
      toast.success("Google Drive connected");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
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
        <h2 className="mb-2 font-semibold">1. Create a Google Client ID</h2>
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
          <li>Copy the Client ID and paste it below.</li>
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
        <Field label="Drive folder name">
          <Input
            value={settings.driveFolderName}
            onChange={(e) => updateSettings({ driveFolderName: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !settings.driveClientId} onClick={connect}>
            <Cloud className="h-4 w-4" /> Connect Google Drive
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
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Each device writes its own compressed .keg file. Every sync merges all device files,
          newest change per record wins.
        </p>
      </Card>
    </div>
  );
}
