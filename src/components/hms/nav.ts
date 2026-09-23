import {
  BarChart3,
  Cloud,
  FlaskConical,
  IndianRupee,
  LayoutDashboard,
  Pill,
  Scan,
  Settings as SettingsIcon,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/hms/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  key: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "dash" },
  { to: "/patients", label: "Patients", icon: Users, key: "patients" },
  { to: "/visits", label: "Visits (OPD/IPD)", icon: Stethoscope, key: "visits" },
  { to: "/laboratory", label: "Laboratory", icon: FlaskConical, key: "labs" },
  { to: "/radiology", label: "Radiology", icon: Scan, key: "rads" },
  { to: "/pharmacy", label: "Pharmacy", icon: Pill, key: "pharms" },
  { to: "/billing", label: "Billing", icon: IndianRupee, key: "billing" },
  { to: "/reports", label: "Reports", icon: BarChart3, key: "reports" },
  { to: "/sync", label: "Google Drive Sync", icon: Cloud, key: "sync" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, key: "settings" },
];

const ROLE_KEYS: Record<Role, string[] | "all"> = {
  Admin: "all",
  Reception: ["dash", "patients", "visits", "billing", "reports", "settings"],
  Doctor: ["dash", "patients", "visits", "labs", "rads", "pharms", "settings"],
  Lab: ["dash", "patients", "labs", "reports", "settings"],
  Pharmacy: ["dash", "patients", "pharms", "reports", "settings"],
  Billing: ["dash", "patients", "billing", "reports", "settings"],
};

export function navForRole(role: Role): NavItem[] {
  const allowed = ROLE_KEYS[role] ?? "all";
  if (allowed === "all") return NAV_ITEMS;
  return NAV_ITEMS.filter((i) => allowed.includes(i.key));
}
