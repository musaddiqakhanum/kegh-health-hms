import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import type { Role } from "@/lib/hms/types";
import {
  BillingWorkspace,
  DoctorWorkspace,
  GenericWorkspace,
  LabWorkspace,
  PharmacyWorkspace,
  ReceptionWorkspace,
} from "@/components/hms/workspaces";

export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [
      { title: "My workspace — KEGH HMS" },
      { name: "description", content: "Your role's home screen in KEGH HMS." },
      { property: "og:title", content: "My workspace — KEGH HMS" },
      { property: "og:description", content: "Your role's home screen in KEGH HMS." },
    ],
  }),
  component: WorkspacePage,
});

/**
 * The shared "My workspace" entry point: renders the workspace for the
 * signed-in user's role (or `settings.role` when login is not required).
 * Admin keeps the current dashboard exactly as is — the workspace redirects
 * straight to it.
 */
function WorkspacePage() {
  const { settings } = useHms();
  const { user } = useSession();
  const role: Role = user ? user.role : settings.role;

  if (role === "Admin") return <Navigate to="/" />;
  if (role === "Reception") return <ReceptionWorkspace />;
  if (role === "Doctor") return <DoctorWorkspace />;
  if (role === "Lab") return <LabWorkspace />;
  if (role === "Pharmacy") return <PharmacyWorkspace />;
  if (role === "Billing") return <BillingWorkspace />;
  return <GenericWorkspace role={role} />;
}
