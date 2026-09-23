import {
  BarChart3,
  CalendarDays,
  Cloud,
  FileText,
  FlaskConical,
  IndianRupee,
  LayoutDashboard,
  ListOrdered,
  Pill,
  Scan,
  Settings as SettingsIcon,
  Stethoscope,
  Users,
  Wallet,
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
  { to: "/appointments", label: "Appointments", icon: CalendarDays, key: "appointments" },
  { to: "/queue", label: "OPD Token Queue", icon: ListOrdered, key: "queue" },
  { to: "/visits", label: "Visits (OPD/IPD)", icon: Stethoscope, key: "visits" },
  { to: "/prescriptions", label: "Prescriptions", icon: FileText, key: "prescriptions" },
  { to: "/laboratory", label: "Laboratory", icon: FlaskConical, key: "labs" },
  { to: "/radiology", label: "Radiology", icon: Scan, key: "rads" },
  { to: "/pharmacy", label: "Pharmacy", icon: Pill, key: "pharms" },
  { to: "/billing", label: "Billing", icon: IndianRupee, key: "billing" },
  { to: "/expenses", label: "Expenses", icon: Wallet, key: "expenses" },
  { to: "/reports", label: "Reports", icon: BarChart3, key: "reports" },
  { to: "/sync", label: "Google Drive Sync", icon: Cloud, key: "sync" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, key: "settings" },
];

const ROLE_KEYS: Record<Role, string[] | "all"> = {
  Admin: "all",
  Reception: [
    "dash",
    "patients",
    "appointments",
    "queue",
    "visits",
    "billing",
    "reports",
    "settings",
    "sync",
  ],
  Doctor: [
    "dash",
    "patients",
    "appointments",
    "queue",
    "visits",
    "prescriptions",
    "labs",
    "rads",
    "pharms",
    "reports",
    "settings",
  ],
  Lab: ["dash", "patients", "labs", "reports", "settings", "sync"],
  Pharmacy: ["dash", "patients", "pharms", "reports", "settings", "sync"],
  Billing: ["dash", "patients", "appointments", "billing", "reports", "settings", "sync"],
};

export function navForRole(role: Role): NavItem[] {
  const allowed = ROLE_KEYS[role] ?? "all";
  if (allowed === "all") return NAV_ITEMS;
  return NAV_ITEMS.filter((i) => allowed.includes(i.key));
}
