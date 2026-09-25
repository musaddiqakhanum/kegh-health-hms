import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import type { Role } from "@/lib/hms/types";
import { Card, PageHeader } from "./ui";

/**
 * Gate for Admin-only pages (staff, payroll, expenses). Allowed roles see the
 * page, everyone else gets the same header with a short "restricted" card so
 * the sidebar link never lands on a blank screen.
 *
 * The effective role is the signed-in user's role when a session exists,
 * otherwise the device's `settings.role` — exactly how the nav behaves.
 */
export function AdminOnly({
  page,
  subtitle,
  hint,
  allow = ["Admin"],
  children,
}: {
  page: string;
  subtitle?: string;
  hint?: string;
  allow?: Role[];
  children: ReactNode;
}) {
  const { settings } = useHms();
  const { user } = useSession();
  const role = user ? user.role : settings.role;
  if (allow.includes(role)) return <>{children}</>;

  return (
    <div>
      <PageHeader title={page} subtitle={subtitle ?? "Restricted — Admin only"} />
      <Card className="my-4 flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="text-sm text-muted-foreground">
          <p>
            {page} is available on the Admin portal. You are currently{" "}
            <strong className="text-foreground">{role}</strong>
            {user ? ` (signed in as ${user.displayName})` : " — change the role in Settings"} to
            open it.
          </p>
          {hint ? <p className="mt-1">{hint}</p> : null}
        </div>
      </Card>
    </div>
  );
}
