import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { packState, unpackState } from "@/lib/hms/pack";
import { getPassphrase, setPassphrase } from "@/lib/hms/sync";
import { downloadBlob } from "@/lib/hms/csv";
import { fmtDateTime } from "@/lib/hms/format";
import type { Role } from "@/lib/hms/types";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/hms/ui";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — KEGH HMS" },
      {
        name: "description",
        content: "Hospital profile, device role, PIN lock, backups and encryption.",
      },
      { property: "og:title", content: "Settings — KEGH HMS" },
      {
        property: "og:description",
        content: "Hospital profile, device role, PIN lock, backups and encryption.",
      },
    ],
  }),
  component: SettingsPage,
});

const ROLES: Role[] = ["Admin", "Reception", "Doctor", "Lab", "Pharmacy", "Billing"];

function SettingsPage() {
  const { settings, updateSettings, state, mergeIn } = useHms();
  const [pin, setPin] = useState(settings.pin);
  const [pass, setPass] = useState(getPassphrase());
  const fileRef = useRef<HTMLInputElement>(null);

  const auditEntries = useMemo(
    () =>
      Object.values(state.auditLogs ?? {})
        .sort((a, b) => b.timestamp - a.timestamp || b.createdAt - a.createdAt)
        .slice(0, 50),
    [state.auditLogs],
  );

  const exportKeg = async () => {
    try {
      const bytes = await packState(state, settings.encryptionEnabled ? pass : undefined);
      downloadBlob(
        `kegh-${new Date().toISOString().slice(0, 10)}.keg`,
        new Blob([bytes as BufferSource], { type: "application/octet-stream" }),
      );
      toast.success("Backup downloaded");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const importKeg = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const incoming = await unpackState(bytes, pass || undefined);
      mergeIn(incoming);
      toast.success("Backup merged into this device");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Settings" subtitle="Hospital profile, roles, security and backups" />

      <Card className="space-y-4">
        <h2 className="font-semibold">Hospital profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hospital name">
            <Input
              value={settings.hospitalName}
              onChange={(e) => updateSettings({ hospitalName: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={settings.hospitalPhone}
              onChange={(e) => updateSettings({ hospitalPhone: e.target.value })}
            />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input
              value={settings.hospitalAddress}
              onChange={(e) => updateSettings({ hospitalAddress: e.target.value })}
            />
          </Field>
          <Field label="Registration number">
            <Input
              value={settings.registrationNumber}
              onChange={(e) => updateSettings({ registrationNumber: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">This device</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Device name">
            <Input
              placeholder="Reception PC"
              value={settings.deviceName}
              onChange={(e) => updateSettings({ deviceName: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={settings.role}
              onChange={(e) => updateSettings({ role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">PIN lock</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="4-digit PIN">
            <Input
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button
            onClick={() => {
              if (pin && pin.length !== 4) {
                toast.error("PIN must be 4 digits");
                return;
              }
              updateSettings({ pin });
              toast.success(pin ? "PIN saved — required next time the app opens" : "PIN removed");
            }}
          >
            Save PIN
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setPin("");
              updateSettings({ pin: "" });
              toast.success("PIN cleared");
            }}
          >
            Clear PIN
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Sync &amp; encryption</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Auto-sync">
            <Select
              value={settings.autoSync ? "on" : "off"}
              onChange={(e) => updateSettings({ autoSync: e.target.value === "on" })}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </Select>
          </Field>
          <Field label="Sync interval (minutes)">
            <Input
              type="number"
              min={1}
              value={settings.syncIntervalMinutes}
              onChange={(e) =>
                updateSettings({ syncIntervalMinutes: Math.max(1, Number(e.target.value)) })
              }
            />
          </Field>
          <Field label="Encrypt backups (AES-256-GCM)">
            <Select
              value={settings.encryptionEnabled ? "on" : "off"}
              onChange={(e) => updateSettings({ encryptionEnabled: e.target.value === "on" })}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </Select>
          </Field>
          <Field label="Passphrase (kept only for this session)">
            <Input
              type="password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setPassphrase(e.target.value);
              }}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Use the same passphrase on every device, otherwise their files cannot be merged.
        </p>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Manual backup</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportKeg}>
            <Download className="h-4 w-4" /> Export .keg
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Import &amp; merge .keg
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".keg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importKeg(f);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      {settings.role === "Admin" ? (
        <Card className="space-y-4">
          <div>
            <h2 className="font-semibold">Audit log</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Last {auditEntries.length} write{auditEntries.length === 1 ? "" : "s"} across all
              synced devices — creations, updates and deletions.
            </p>
          </div>
          {auditEntries.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No audit entries yet. They appear here as records are created, updated or deleted.
            </p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md ring-1 ring-border/60">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-secondary">
                  <tr>
                    {["Time", "Action", "Collection", "Record", "Device", "Role"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
                  {auditEntries.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(a.timestamp)}</td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            a.action === "create"
                              ? "green"
                              : a.action === "delete"
                                ? "red"
                                : "amber"
                          }
                        >
                          {a.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{a.collection}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.recordId.slice(0, 8)}</td>
                      <td className="px-3 py-2">{a.deviceName}</td>
                      <td className="px-3 py-2">{a.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
