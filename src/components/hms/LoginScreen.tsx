import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/hms/useSession";
import { Button, Field, Input } from "./ui";
import keghLogo from "@/assets/kegh-logo.png.asset.json";

/**
 * Whole-app login gate (shown by AppShell when login is required and at least
 * one active user exists). Offline check against the users collection — the
 * same precedent as the 4-digit device PIN lock.
 */
export function LoginScreen() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

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
    const res = await login(username, password);
    setBusy(false);
    if (res.ok) {
      // Land on the signed-in role's workspace, not the generic dashboard.
      navigate({ to: "/workspace" });
      return;
    }
    if (res.error === "locked") {
      setLockSeconds(res.lockSeconds);
      setError(`Too many failed attempts — try again in ${res.lockSeconds} s.`);
    } else {
      // One generic message: never says which part was wrong.
      setError("Invalid username or password.");
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
          <Field label="Password">
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
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
          Checked offline against the accounts on this device.
        </p>
      </div>
    </div>
  );
}
