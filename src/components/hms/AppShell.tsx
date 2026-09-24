import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Menu, Search, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { getStoredToken } from "@/lib/hms/drive";
import { runSync } from "@/lib/hms/sync";
import { activeUsers } from "@/lib/hms/selectors";
import { navForRole } from "./nav";
import { registerAppServiceWorker } from "@/lib/hms/register-sw";
import { LoginScreen } from "./LoginScreen";
import { Badge, Button, Input } from "./ui";
import { cn } from "@/lib/utils";
import keghLogo from "@/assets/kegh-logo.png.asset.json";

function PinLock({ pin, onUnlock, onForgot }: { pin: string; onUnlock: () => void; onForgot: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center sidebar-gradient px-4">
      <div className="w-full max-w-xs rounded-lg bg-white p-6 text-center shadow-xl">
        <img src={keghLogo.url} alt="KEGH LLP" width={56} height={56} className="mx-auto mb-3 h-14 w-14 object-contain" />
        <h1 className="text-lg font-semibold text-[#0b3a44]">KEGH HMS</h1>
        <p className="mb-4 text-sm text-slate-500">Enter your 4-digit PIN</p>
        <Input
          autoFocus
          inputMode="numeric"
          maxLength={4}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (value === pin) onUnlock();
              else toast.error("Incorrect PIN");
            }
          }}
          className="text-center text-2xl tracking-[0.5em]"
        />
        <Button
          className="mt-4 w-full"
          onClick={() => (value === pin ? onUnlock() : toast.error("Incorrect PIN"))}
        >
          Unlock
        </Button>
        <button className="mt-3 text-xs text-slate-500 underline" onClick={onForgot}>
          Forgot PIN (clears it on this device)
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings, online, ready, state, mergeIn } = useHms();
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const syncing = useRef(false);

  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    registerAppServiceWorker();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-sync
  useEffect(() => {
    if (!ready || !settings.autoSync || !settings.driveClientId) return;
    const tick = async () => {
      if (syncing.current || !navigator.onLine || !getStoredToken()) return;
      syncing.current = true;
      try {
        const { merged, fileCount } = await runSync(state, settings);
        mergeIn(merged);
        updateSettings({ lastSyncAt: Date.now(), lastSyncFileCount: fileCount });
      } catch (err) {
        console.error(err);
      } finally {
        syncing.current = false;
      }
    };
    const id = setInterval(tick, Math.max(1, settings.syncIntervalMinutes) * 60_000);
    return () => clearInterval(id);
  }, [ready, settings, state, mergeIn, updateSettings]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center sidebar-gradient">
        <img src={keghLogo.url} alt="KEGH LLP" width={96} height={96} className="h-24 w-24 animate-pulse rounded-xl bg-white p-2" />
      </div>
    );
  }

  if (settings.pin && !unlocked) {
    return (
      <PinLock
        pin={settings.pin}
        onUnlock={() => setUnlocked(true)}
        onForgot={() => {
          updateSettings({ pin: "" });
          setUnlocked(true);
          toast.success("PIN cleared on this device");
        }}
      />
    );
  }

  // Staff login gate: required AND at least one active account exists. With
  // zero users the app keeps its first-run behaviour (role dropdown + PIN).
  if (settings.requireLogin && activeUsers(state).length > 0 && !user) {
    return <LoginScreen />;
  }

  // The signed-in user's role drives the nav; otherwise the device role, as
  // before. No per-route gates — nav hiding and AdminOnly do the gating.
  const role = user ? user.role : settings.role;
  const items = navForRole(role);

  const sidebar = (
    <aside className="sidebar-gradient flex h-full w-[236px] shrink-0 flex-col text-white">
      <div className="flex items-center gap-3 px-5 py-5">
        <img src={keghLogo.url} alt="KEGH LLP" width={40} height={40} className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" />
        <div>
          <p className="text-lg font-bold leading-tight">KEGH</p>
          <p className="text-xs text-white/70">Health Records</p>
        </div>
        <button className="ml-auto md:hidden" onClick={() => setDrawer(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {items.map((item) => {
          const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.key}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/15 px-4 py-3 text-xs text-white/75">
        <div className="flex items-center gap-2 px-1">
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {online ? "Online" : "Offline"} · {role}
        </div>
        <p className="mt-1 truncate px-1">{settings.deviceName}</p>
        {user ? (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-white/10 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-white">{user.displayName}</p>
              <p className="truncate text-white/70">{user.role}</p>
            </div>
            <button
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              onClick={() => {
                logout();
                toast.success(`Signed out as ${user.displayName}`);
              }}
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" /> Log out
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="hidden md:block">{sidebar}</div>
      {drawer ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="h-full">{sidebar}</div>
          <div className="flex-1 bg-black/40" onClick={() => setDrawer(false)} />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3">
          <button className="md:hidden" onClick={() => setDrawer(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <form
            className="relative max-w-md flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ to: "/patients", search: { q: query } });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient name, MRN or phone  (press /)"
              className="pl-9"
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm font-medium text-muted-foreground sm:block">
              {settings.hospitalName}
            </span>
            {user ? (
              <>
                <span className="hidden text-sm font-medium text-foreground md:block">
                  {user.displayName}
                </span>
                <Badge tone="neutral">{user.role}</Badge>
                <Button
                  variant="outline"
                  onClick={() => {
                    logout();
                    toast.success(`Signed out as ${user.displayName}`);
                  }}
                >
                  <LogOut className="h-4 w-4" /> Log out
                </Button>
              </>
            ) : null}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
