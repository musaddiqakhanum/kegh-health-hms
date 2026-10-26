import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/hms/useSession";
import { useHms } from "@/lib/hms/store";
import { findPinRecord } from "@/lib/hms/offline-signin";
import type { LoginOutcome } from "@/lib/hms/session-context";
import { Button, Field, Input } from "./ui";
import keghLogo from "@/assets/kegh-logo.png.asset.json";

/**
 * Whole-app login gate (shown by AppShell when login is required and at least
 * one active user exists).
 *
 * Two ways in (phase 4b, item 4):
 * - Staff password, checked by the hospital room. Only when this device has a room.
 * - Device PIN, checked on this device. Works without the room, for 12 hours after
 *   the last room sign-in on this device. A device with no room uses the PIN only.
 */
export function LoginScreen() {
  const { login, loginWithPin } = useSession();
  const { realtime } = useHms();
  const navigate = useNavigate();
  const roomReady = realtime.configured;
  const [mode, setMode] = useState<"password" | "pin">(roomReady ? "password" : "pin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

  // Whether this device already has a PIN for the typed account.
  const pinSet =
    username.trim() !== "" && findPinRecord(window.localStorage, username) !== undefined;

  // Ticks down the lockout countdown once it has started.
  const locked = lockSeconds > 0;
  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setLockSeconds((s) => (s > 1 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [locked]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || locked) return;
    setBusy(true);
    setError("");
    let res: LoginOutcome;
    if (mode === "password") {
      res = await login(username, password, pinSet ? undefined : newPin);
    } else {
      res = await loginWithPin(username, pin);
    }
    setBusy(false);
    if (res.ok) {
      // Land on the signed-in role's workspace, not the generic dashboard.
      navigate({ to: "/workspace" });
      return;
    }
    switch (res.error) {
      case "locked":
        setLockSeconds(res.lockSeconds);
        setError(`Too many failed attempts — try again in ${res.lockSeconds} s.`);
        break;
      case "no-room":
        setError("This device has no hospital room. Sign in with your device PIN.");
        break;
      case "pin-needed":
        setError(
          "Choose a 4-digit PIN for this device. You will use it when the room is unreachable.",
        );
        break;
      case "room":
        setError(res.message);
        break;
      case "expired":
        setError("PIN sign-in on this device has expired. Sign in with your password.");
        break;
      case "cleared":
        setError("Too many wrong PINs. The PIN for this account was cleared on this device.");
        break;
      default:
        // One generic message: never says which part was wrong.
        setError(mode === "pin" ? "Invalid username or PIN." : "Invalid username or password.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center sidebar-gradient px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <img
          src={keghLogo.url}
          alt="KEGH LLP"
          width={56}
          height={56}
          className="mx-auto mb-3 h-14 w-14 object-contain"
        />
        <h1 className="text-center text-lg font-semibold text-[#0b3a44]">KEGH HMS</h1>
        <p className="mb-4 text-center text-sm text-slate-500">Sign in with your staff account</p>

        {roomReady ? (
          <div className="mb-4 grid grid-cols-2 gap-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "password"}
              className={`rounded-md border px-2 py-1.5 text-sm ${mode === "password" ? "border-[#0b3a44] bg-[#0b3a44] text-white" : "border-slate-300 text-slate-700"}`}
              onClick={() => {
                setMode("password");
                setError("");
              }}
            >
              Staff password
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pin"}
              className={`rounded-md border px-2 py-1.5 text-sm ${mode === "pin" ? "border-[#0b3a44] bg-[#0b3a44] text-white" : "border-slate-300 text-slate-700"}`}
              onClick={() => {
                setMode("pin");
                setError("");
              }}
            >
              Device PIN
            </button>
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          <Field label="Username">
            <Input
              name="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>

          {mode === "password" ? (
            <>
              <Field label="Password">
                <Input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {!pinSet && username.trim() !== "" ? (
                <Field label="New device PIN (4 digits)">
                  <Input
                    name="newPin"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              ) : null}
            </>
          ) : (
            <Field label="Device PIN (4 digits)">
              <Input
                name="pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}

          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy || locked}>
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          {roomReady
            ? "Password sign-in checks the hospital room. The device PIN works when the room cannot be reached."
            : "This device has no hospital room. Sign in with the PIN an Admin set on this device."}
        </p>
      </div>
    </div>
  );
}
