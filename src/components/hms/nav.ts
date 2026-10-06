import {
  BarChart3,
  Banknote,
  BedDouble,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Cloud,
  FlaskConical,
  History,
  IndianRupee,
  NotebookPen,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  Pill,
  Receipt,
  Scan,
  ScrollText,
  Settings as SettingsIcon,
  Stethoscope,
  TestTube2,
  Users,
  UsersRound,
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
  { to: "/workspace", label: "My workspace", icon: LayoutGrid, key: "workspace" },
  { to: "/handover", label: "Shift Handover", icon: NotebookPen, key: "handover" },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "dash" },
  { to: "/patients", label: "Patients", icon: Users, key: "patients" },
  { to: "/appointments", label: "Appointments", icon: CalendarDays, key: "appointments" },
  { to: "/queue", label: "OPD Token Queue", icon: ListOrdered, key: "queue" },
  { to: "/visits", label: "Visits (OPD/IPD)", icon: Stethoscope, key: "visits" },
  { to: "/ipd", label: "IPD & Beds", icon: BedDouble, key: "ipd" },
  { to: "/prescriptions", label: "Prescriptions", icon: ScrollText, key: "prescriptions" },
  { to: "/laboratory", label: "Laboratory", icon: FlaskConical, key: "labs" },
  { to: "/lab-orders", label: "Lab Orders", icon: TestTube2, key: "labOrders" },
  { to: "/radiology", label: "Radiology", icon: Scan, key: "rads" },
  { to: "/imaging-orders", label: "Imaging Orders", icon: ClipboardCheck, key: "imagingOrders" },
  { to: "/pharmacy", label: "Pharmacy", icon: Pill, key: "pharms" },
  { to: "/medicines", label: "Medicine Library", icon: BookOpen, key: "medicines" },
  { to: "/billing", label: "Billing", icon: IndianRupee, key: "billing" },
  { to: "/staff", label: "Staff Records", icon: UsersRound, key: "staff" },
  { to: "/payroll", label: "Payroll", icon: Banknote, key: "payroll" },
  { to: "/expenses", label: "Expenses", icon: Receipt, key: "expenses" },
  { to: "/reports", label: "Reports", icon: BarChart3, key: "reports" },
  // Admin-only: every other role's key list below simply omits "audit".
  { to: "/audit", label: "Audit Trail", icon: History, key: "audit" },
  { to: "/sync", label: "Google Drive Sync", icon: Cloud, key: "sync" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, key: "settings" },
];

const ROLE_KEYS: Record<Role, string[] | "all"> = {
  // Admin sees everything, including staff salaries, payroll and expenses.
  // "My workspace" redirects to the usual dashboard for Admin.
  Admin: "all",
  // Reception runs the front desk: appointments and the OPD token queue.
  Reception: [
    "workspace",
    "handover",
    "dash",
    "patients",
    "appointments",
    "queue",
    "visits",
    "ipd",
    "billing",
    "reports",
    "settings",
  ],
  Doctor: [
    "workspace",
    "handover",
    "dash",
    "patients",
    "appointments",
    "queue",
    "visits",
    "ipd",
    "prescriptions",
    "labs",
    "labOrders",
    "rads",
    "imagingOrders",
    "pharms",
    "medicines",
    "settings",
  ],
  Lab: [
    "workspace",
    "handover",
    "dash",
    "patients",
    "labs",
    "labOrders",
    "rads",
    "imagingOrders",
    "reports",
    "settings",
  ],
  Pharmacy: [
    "workspace",
    "handover",
    "dash",
    "patients",
    "pharms",
    "medicines",
    "reports",
    "settings",
  ],
  Billing: ["workspace", "handover", "dash", "patients", "billing", "reports", "settings"],
};

export function navForRole(role: Role): NavItem[] {
  const allowed = ROLE_KEYS[role] ?? "all";
  if (allowed === "all") return NAV_ITEMS;
  return NAV_ITEMS.filter((i) => allowed.includes(i.key));
}
