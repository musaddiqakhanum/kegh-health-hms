import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Download, Plus, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { packState, unpackState } from "@/lib/hms/pack";
import { getPassphrase, setPassphrase } from "@/lib/hms/sync";
import { hashPassword, newSaltHex } from "@/lib/hms/crypto";
import { activeUsers, findUserByUsername, staffNameFor, userList } from "@/lib/hms/selectors";
import { serviceRateList } from "@/lib/hms/charges";
import { downloadBlob } from "@/lib/hms/csv";
import { money } from "@/lib/hms/format";
import { abdmStatus } from "@/lib/abdm/abdm.functions";
import {
  COMMON_IMAGING_STUDIES,
  COMMON_LAB_TESTS,
  SERVICE_SECTIONS,
  type AuditLog,
  type Role,
  type ServiceRate,
  type ServiceSection,
  type User,
} from "@/lib/hms/types";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select } from "@/components/hms/ui";
import { AdminOnly } from "@/components/hms/gate";

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
  const { settings, updateSettings, state, mergeIn, upsert } = useHms();
  const { user } = useSession();
  const [pin, setPin] = useState(settings.pin);
  const [pass, setPass] = useState(getPassphrase());
  const [newDoctor, setNewDoctor] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [abdm, setAbdm] = useState<{
    configured: boolean;
    environment: string | null;
    demo: boolean;
  } | null>(null);

  /* --------------------------------------------------------- staff users */
  const users = userList(state);
  const staffRows = Object.values(state.staff ?? {}).sort((a, b) =>
    (a.name || "").localeCompare(b.name || ""),
  );
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newRole, setNewRole] = useState<Role>("Reception");
  const [staffPick, setStaffPick] = useState("");
  const [accountPass, setAccountPass] = useState("");
  const [accountPass2, setAccountPass2] = useState("");
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPass, setResetPass] = useState("");
  const [resetPass2, setResetPass2] = useState("");

  /** Actor role for audit entries: the signed-in user, else the device role. */
  const actorRole = user ? user.role : settings.role;

  const writeAudit = (action: "create" | "update", recordId: string) => {
    upsert<AuditLog>("auditLogs", {
      id: crypto.randomUUID(),
      action,
      collection: "users",
      recordId,
      timestamp: Date.now(),
      deviceName: settings.deviceName,
      role: actorRole,
    } as Partial<AuditLog>);
  };

  const createUser = async () => {
    const uname = username.trim();
    const disp = displayName.trim();
    if (!uname) {
      toast.error("Enter a username");
      return;
    }
    if (!disp) {
      toast.error("Enter a display name");
      return;
    }
    if (findUserByUsername(state, uname)) {
      toast.error("That username is already taken");
      return;
    }
    if (accountPass.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (accountPass !== accountPass2) {
      toast.error("Passwords do not match");
      return;
    }
    const salt = newSaltHex();
    const passwordHash = await hashPassword(accountPass, salt);
    const roleToSave = users.length === 0 ? "Admin" : newRole;
    const id = upsert<User>("users", {
      username: uname,
      displayName: disp,
      role: roleToSave,
      staffId: staffPick || undefined,
      passwordHash,
      salt,
      active: true,
    } as Partial<User>);
    writeAudit("create", id);
    toast.success(`Account created for ${disp} (${roleToSave})`);
    setUsername("");
    setDisplayName("");
    setNewRole("Reception");
    setStaffPick("");
    setAccountPass("");
    setAccountPass2("");
  };

  const toggleActive = (u: User) => {
    const next = !u.active;
    if (!next && activeUsers(state).length <= 1) {
      toast.error("Keep at least one active account, otherwise nobody can sign in");
      return;
    }
    upsert<User>("users", { ...u, active: next } as Partial<User>);
    writeAudit("update", u.id);
    toast.success(next ? `${u.displayName} can sign in again` : `${u.displayName} disabled`);
  };

  const saveReset = async () => {
    if (!resetUser) return;
    if (resetPass.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (resetPass !== resetPass2) {
      toast.error("Passwords do not match");
      return;
    }
    const salt = newSaltHex();
    const passwordHash = await hashPassword(resetPass, salt);
    upsert<User>("users", { ...resetUser, salt, passwordHash } as Partial<User>);
    writeAudit("update", resetUser.id);
    setResetUser(null);
    setResetPass("");
    setResetPass2("");
    toast.success(`Password reset for ${resetUser.displayName}`);
  };

  useEffect(() => {
    void abdmStatus()
      .then(setAbdm)
      .catch(() => setAbdm({ configured: false, environment: null, demo: true }));
  }, []);

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
              value={user ? user.role : settings.role}
              disabled={Boolean(user)}
              onChange={(e) => updateSettings({ role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            {user ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Locked to {user.role} while signed in as {user.displayName}. Sign out — or turn off
                the login gate — to change the device role.
              </p>
            ) : null}
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Doctors</h2>
        <p className="text-xs text-muted-foreground">
          These names appear in the doctor list on patient and visit forms.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Doctor name">
            <Input
              placeholder="Dr. Full Name"
              value={newDoctor}
              onChange={(e) => setNewDoctor(e.target.value)}
            />
          </Field>
          <Button
            onClick={() => {
              const clean = newDoctor.trim();
              if (!clean) {
                toast.error("Enter the doctor's name");
                return;
              }
              const list = settings.doctors ?? [];
              if (list.some((d) => d.toLowerCase() === clean.toLowerCase())) {
                toast.error("That doctor is already on the list");
                return;
              }
              updateSettings({ doctors: [...list, clean].sort((a, b) => a.localeCompare(b)) });
              setNewDoctor("");
              toast.success(`${clean} added`);
            }}
          >
            Add doctor
          </Button>
        </div>
        {(settings.doctors ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No doctors added yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md ring-1 ring-border/60">
            {(settings.doctors ?? []).map((d) => (
              <li key={d} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{d}</span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    updateSettings({ doctors: (settings.doctors ?? []).filter((x) => x !== d) });
                    toast.success(`${d} removed`);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
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

      <AdminOnly
        page="Users"
        subtitle="Staff accounts for the device login screen"
        hint="Accounts sync with the hospital data, so every device with the login gate on can sign in with the same accounts."
      >
        <div className="space-y-5">
          <Card className="space-y-3">
            <h2 className="font-semibold">Require login on this device</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Login gate">
                <Select
                  value={settings.requireLogin ? "on" : "off"}
                  onChange={(e) => {
                    const want = e.target.value === "on";
                    if (want && activeUsers(state).length === 0) {
                      toast.error("Create the first Admin account below before requiring login");
                      return;
                    }
                    updateSettings({ requireLogin: want });
                    toast.success(
                      want ? "Login required on this device" : "Login no longer required",
                    );
                  }}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
              <Field label="Auto-lock when idle (this device)">
                <Select
                  value={String(settings.idleLockMinutes ?? 0)}
                  disabled={!settings.requireLogin}
                  onChange={(e) => {
                    const mins = Number(e.target.value);
                    updateSettings({ idleLockMinutes: mins });
                    toast.success(
                      mins === 0 ? "Idle auto-lock off" : `Auto-locks after ${mins} min idle`,
                    );
                  }}
                >
                  <option value="0">Off</option>
                  <option value="5">5 minutes</option>
                  <option value="10">10 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              When on and at least one active account exists, the app stays behind the sign-in
              screen until a staff member logs in. With zero accounts the app keeps today's
              behaviour: the role dropdown plus the optional 4-digit device PIN.
            </p>
          </Card>

          <Card className="space-y-4">
            <h2 className="font-semibold">Accounts</h2>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No staff accounts yet. Create the first one below — it must be an Admin.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md ring-1 ring-border/60">
                {users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{u.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{u.username}
                        {u.staffId ? ` · ${staffNameFor(state, u.staffId)}` : ""}
                      </p>
                    </div>
                    <Badge tone="neutral">{u.role}</Badge>
                    <Badge tone={u.active ? "green" : "red"}>
                      {u.active ? "Active" : "Disabled"}
                    </Badge>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setResetUser(u);
                        setResetPass("");
                        setResetPass2("");
                      }}
                    >
                      Reset password
                    </Button>
                    <Button
                      variant="outline"
                      title="Ends every signed-in session for this account on all devices at the next sync"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Sign ${u.displayName} out on ALL devices? Their sessions end as soon as each device next syncs.`,
                          )
                        ) {
                          upsert<User>("users", { id: u.id, sessionsKickedAt: Date.now() });
                          toast.success(`Sessions for ${u.displayName} end at the next sync`);
                        }
                      }}
                    >
                      Sign out devices
                    </Button>
                    <Button variant="outline" onClick={() => toggleActive(u)}>
                      {u.active ? "Disable" : "Enable"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border pt-4">
              <h3 className="mb-3 text-sm font-semibold">
                {users.length === 0 ? "Create the first Admin account" : "New account"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username" required>
                  <Input
                    placeholder="e.g. drasha"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </Field>
                <Field label="Display name" required>
                  <Input
                    placeholder="e.g. Dr. Aisha Khan"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </Field>
                <Field label="Role" required>
                  <Select
                    value={users.length === 0 ? "Admin" : newRole}
                    disabled={users.length === 0}
                    onChange={(e) => setNewRole(e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                  {users.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      The first account must be an Admin.
                    </p>
                  ) : null}
                </Field>
                <Field label="Staff record (optional)">
                  <Select value={staffPick} onChange={(e) => setStaffPick(e.target.value)}>
                    <option value="">None</option>
                    {staffRows.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.role || "—"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Password" required>
                  <Input
                    type="password"
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    value={accountPass}
                    onChange={(e) => setAccountPass(e.target.value)}
                  />
                </Field>
                <Field label="Confirm password" required>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={accountPass2}
                    onChange={(e) => setAccountPass2(e.target.value)}
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Button onClick={() => void createUser()}>
                  <Plus className="h-4 w-4" /> Create account
                </Button>
              </div>
            </div>
          </Card>

          <Modal
            open={Boolean(resetUser)}
            title={resetUser ? `Reset password — ${resetUser.displayName}` : "Reset password"}
            onClose={() => setResetUser(null)}
          >
            <div className="grid gap-4">
              <Field label="New password" required>
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  value={resetPass}
                  onChange={(e) => setResetPass(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={resetPass2}
                  onChange={(e) => setResetPass2(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResetUser(null)}>
                Cancel
              </Button>
              <Button onClick={() => void saveReset()}>Save new password</Button>
            </div>
          </Modal>
        </div>
      </AdminOnly>

      <AdminOnly
        page="Service rates"
        subtitle="Price list for lab tests and imaging studies"
        hint="The ₹ button on a completed lab / imaging order posts these rates to the patient's bill. Rates sync with the hospital data."
      >
        <ServiceRatesCard />
      </AdminOnly>

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
          Use the same passphrase on every device, otherwise their files cannot be merged. The{" "}
          Google Drive account / shared folder is configured on the{" "}
          <strong>Google Drive Sync</strong> page — including team mode, where every staff member
          signs in with their own Google account.
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

      <Card className="space-y-2">
        <h2 className="flex items-center gap-2 font-semibold">
          ABDM integration (ABHA)
          {abdm?.configured ? (
            <Badge tone="green">
              <ShieldCheck className="mr-1 inline h-3 w-3" />
              {abdm.environment === "production" ? "Production" : "Sandbox"}
            </Badge>
          ) : (
            <Badge tone="amber">
              <ShieldAlert className="mr-1 inline h-3 w-3" /> Demo mode
            </Badge>
          )}
        </h2>
        {abdm?.configured ? (
          <p className="text-sm text-muted-foreground">
            Live ABHA verification is enabled. Patients can be verified with an OTP sent to the
            mobile linked with their ABHA number or address.
          </p>
        ) : (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              ABDM credentials are not set on this server, so ABHA verification runs with
              clearly-labelled demo data and never marks a patient verified.
            </p>
            <p className="text-xs">
              To enable live verification set{" "}
              <code className="rounded bg-muted px-1">ABDM_CLIENT_ID</code>,{" "}
              <code className="rounded bg-muted px-1">ABDM_CLIENT_SECRET</code> and optionally{" "}
              <code className="rounded bg-muted px-1">ABDM_ENVIRONMENT=sandbox|production</code> on
              the server, then restart.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------- service rates */

function ServiceRatesCard() {
  const { state, upsert } = useHms();
  const [section, setSection] = useState<ServiceSection>("Lab");
  const [item, setItem] = useState("");
  const [rate, setRate] = useState("");

  const rows = serviceRateList(state);
  const suggestions = section === "Lab" ? COMMON_LAB_TESTS : COMMON_IMAGING_STUDIES;

  const add = () => {
    const name = item.trim();
    const r = Number(rate);
    if (!name) {
      toast.error("Enter a test / study name");
      return;
    }
    if (!Number.isFinite(r) || r <= 0) {
      toast.error("Enter a rate above zero");
      return;
    }
    const existing = rows.find(
      (x) => x.section === section && x.item.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      upsert<ServiceRate>("serviceRates", { id: existing.id, rate: r, active: true });
      toast.success(`Rate updated — ${name} ${money(r)}`);
    } else {
      upsert<ServiceRate>("serviceRates", { section, item: name, rate: r, active: true });
      toast.success(`Rate added — ${name} ${money(r)}`);
    }
    setItem("");
    setRate("");
  };

  const toggle = (x: ServiceRate) => {
    upsert<ServiceRate>("serviceRates", { id: x.id, active: !x.active });
    toast.success(x.active ? "Rate disabled" : "Rate enabled");
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Price list</h2>

      <div className="grid items-end gap-4 sm:grid-cols-4">
        <Field label="Section" required>
          <Select value={section} onChange={(e) => setSection(e.target.value as ServiceSection)}>
            {SERVICE_SECTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Test / study" required className="sm:col-span-2">
          <Input
            list="service-rate-items"
            placeholder={
              section === "Lab" ? "e.g. CBC, HbA1c…" : "e.g. USG Abdomen, X-Ray Chest PA…"
            }
            value={item}
            onChange={(e) => setItem(e.target.value)}
          />
          <datalist id="service-rate-items">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Rate (₹)" required>
          <Input
            type="number"
            min={0}
            placeholder="e.g. 450"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={add}>
          <Plus className="h-4 w-4" /> Add / update rate
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rates yet — the ₹ button on completed lab / imaging orders stays inactive until the
          price list has entries.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md ring-1 ring-border/60">
          {rows.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Badge tone={x.section === "Lab" ? "neutral" : "amber"}>{x.section}</Badge>
              <span className="min-w-0 flex-1 font-medium text-foreground">{x.item}</span>
              <span className="font-semibold">{money(x.rate)}</span>
              <Badge tone={x.active ? "green" : "red"}>{x.active ? "Active" : "Disabled"}</Badge>
              <Button variant="ghost" onClick={() => toggle(x)}>
                {x.active ? "Disable" : "Enable"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Names match order items case-insensitively. Re-adding the same name updates its price; new
        charges use the latest active rate, bills already posted are untouched.
      </p>
    </Card>
  );
}
