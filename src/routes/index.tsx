import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  Clock,
  IndianRupee,
  Users,
  Stethoscope,
  FlaskConical,
  Pill,
  Scan,
} from "lucide-react";
import { useHms } from "@/lib/hms/store";
import {
  availableDoctorsToday,
  billPaymentStatus,
  dashboardStats,
  lowStockMedications,
  sortByDateDesc,
} from "@/lib/hms/selectors";
import { fmtDate, isSameDay, money, todayISO } from "@/lib/hms/format";
import { getStoredToken } from "@/lib/hms/drive";
import { Button, Card, DataTable, PageHeader, Td, Badge } from "@/components/hms/ui";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import type { Role } from "@/lib/hms/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — KEGH HMS" },
      {
        name: "description",
        content:
          "Role-based hospital dashboard with appointments, collections and operational summaries.",
      },
      { property: "og:title", content: "Dashboard — KEGH HMS" },
      {
        property: "og:description",
        content: "Role-based operational dashboard — KEGH Health Records.",
      },
    ],
  }),
  component: Dashboard,
});

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: typeof Users;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold text-foreground">{value}</p>
          {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {Icon ? <Icon className="h-5 w-5 text-muted-foreground/60" /> : null}
      </div>
    </Card>
  );
}

function QuickAction({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="rounded-md border border-border bg-secondary/40 p-3 transition-colors hover:border-accent hover:bg-secondary"
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>
    </Link>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const tone: Record<Role, "green" | "amber" | "red" | "neutral"> = {
    Admin: "green",
    Reception: "amber",
    Doctor: "green",
    Lab: "neutral",
    Pharmacy: "neutral",
    Billing: "amber",
  };
  return <Badge tone={tone[role] ?? "neutral"}>{role} portal</Badge>;
}

function Dashboard() {
  const { state, settings } = useHms();
  const [dayEnd, setDayEnd] = useState(false);
  const stats = useMemo(() => dashboardStats(state), [state]);

  const recentVisits = useMemo(
    () => sortByDateDesc(Object.values(state.visits)).slice(0, 6),
    [state.visits],
  );
  const todayAppointments = useMemo(() => {
    const today = todayISO();
    const list = Object.values(state.appointments ?? {}).filter((a) => a.date === today);
    return [...list].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }, [state.appointments]);

  const upcomingAppointments = useMemo(() => {
    const list = Object.values(state.appointments ?? {}).filter((a) => {
      const d = new Date((a.date || "").slice(0, 10));
      if (Number.isNaN(d.getTime())) return false;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return d >= now;
    });
    return [...list]
      .sort((a, b) =>
        `${a.date}T${a.time || "00:00"}`.localeCompare(`${b.date}T${b.time || "00:00"}`),
      )
      .slice(0, 8);
  }, [state.appointments]);

  const checklist = [
    {
      label: "Hospital details filled in",
      done: Boolean(settings.hospitalName && settings.hospitalAddress && settings.hospitalPhone),
    },
    { label: `Role selected (${settings.role})`, done: true },
    { label: "Google Drive connected", done: Boolean(settings.driveClientId && getStoredToken()) },
    { label: "Encryption passphrase enabled", done: settings.encryptionEnabled },
  ];

  const lowStock = useMemo(() => lowStockMedications(Object.values(state.pharms)), [state.pharms]);
  const doctorsTodayList = useMemo(
    () => availableDoctorsToday(Object.values(state.doctorSchedules ?? {})),
    [state.doctorSchedules],
  );

  const todayBills = Object.values(state.bills).filter((b) => isSameDay(b.date));
  const paidToday = todayBills.filter((b) => billPaymentStatus(b) === "Paid").length;
  const partialToday = todayBills.filter((b) => billPaymentStatus(b) === "Partial").length;
  const dueToday = todayBills.filter((b) => billPaymentStatus(b) === "Due").length;

  const role = settings.role as Role;

  const quickActionsByRole: Record<Role, { to: string; title: string; desc: string }[]> = {
    Admin: [
      { to: "/patients", title: "Register patient", desc: "Create a KEGH MRN" },
      { to: "/queue", title: "OPD token queue", desc: "Today's confirmed patients" },
      { to: "/prescriptions", title: "Prescriptions", desc: "Print patient Rx" },
      { to: "/expenses", title: "Add expense", desc: "Track hospital costs" },
    ],
    Reception: [
      { to: "/patients", title: "Register patient", desc: "Create a KEGH MRN" },
      { to: "/appointments", title: "Schedule appointment", desc: "Book OPD / follow-up" },
      { to: "/queue", title: "OPD token queue", desc: "Call, skip, complete" },
      { to: "/billing", title: "Create bill", desc: "Collect payment or due" },
    ],
    Doctor: [
      {
        to: "/appointments",
        title: "Today's appointments",
        desc: `${todayAppointments.length} scheduled`,
      },
      { to: "/queue", title: "OPD token queue", desc: "Next patient in line" },
      { to: "/prescriptions", title: "New prescription", desc: "Printable Rx with sign-off" },
      { to: "/pharmacy", title: "Prescribe", desc: "Add pharmacy entry" },
    ],
    Lab: [
      { to: "/laboratory", title: "Add lab result", desc: "Record a test result" },
      { to: "/patients", title: "Search patient", desc: "Find by MRN / phone" },
      { to: "/reports", title: "Lab reports", desc: "Section-wise summaries" },
      { to: "/appointments", title: "Appointments", desc: "Upcoming tests" },
    ],
    Pharmacy: [
      { to: "/pharmacy", title: "Dispense medicine", desc: "Add pharmacy entry" },
      { to: "/patients", title: "Search patient", desc: "Find by MRN / phone" },
      { to: "/reports", title: "Pharmacy reports", desc: "Value & qty" },
      { to: "/appointments", title: "Appointments", desc: "Upcoming pickups" },
    ],
    Billing: [
      { to: "/billing", title: "Create bill", desc: "Collect payment or due" },
      { to: "/appointments", title: "Appointments", desc: `${todayAppointments.length} today` },
      { to: "/patients", title: "Search patient", desc: "Find by MRN / phone" },
      { to: "/reports", title: "Paid report", desc: "Collections & dues" },
    ],
  };

  const quickActions = quickActionsByRole[role] ?? quickActionsByRole.Admin;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={
          role === "Admin"
            ? "Today at a glance — operational overview"
            : role === "Reception"
              ? "Reception desk — registrations, appointments and billing"
              : role === "Doctor"
                ? "Doctor portal — today's appointments, visits and orders"
                : role === "Lab"
                  ? "Laboratory portal — tests and critical flags"
                  : role === "Pharmacy"
                    ? "Pharmacy portal — dispensing and stock value"
                    : "Billing portal — collections, paid and dues"
        }
        actions={
          <div className="flex items-center gap-2">
            <RoleBadge role={role} />
            <Button onClick={() => setDayEnd(true)}>
              <FileText className="h-4 w-4" /> Day-end report
            </Button>
          </div>
        }
      />

      <Card className="sidebar-gradient text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{settings.hospitalName || "KEGH LLP"}</h2>
            <p className="mt-1 text-sm text-white/80">
              {settings.hospitalAddress || "Add your hospital address in Settings"}
            </p>
            <p className="text-sm text-white/80">
              {settings.hospitalPhone
                ? `Phone: ${settings.hospitalPhone}`
                : "Add a phone number in Settings"}
            </p>
          </div>
          <div className="text-right text-xs text-white/70">
            <p>{settings.deviceName || "This Device"}</p>
            <p className="mt-1">
              {settings.role} · {todayAppointments.length} appointments today
            </p>
          </div>
        </div>
      </Card>

      {/* Role-based stat grids */}
      {role === "Reception" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Patients today"
            value={stats.patientsToday}
            sub={`${stats.patients} total`}
            icon={Users}
          />
          <Stat
            label="Appointments today"
            value={stats.appointmentsToday}
            sub={`${stats.appointmentsUpcoming} upcoming`}
            icon={CalendarDays}
          />
          <Stat
            label="Visits today"
            value={stats.visitsToday}
            sub={`${stats.admitted} admitted`}
            icon={Stethoscope}
          />
          <Stat
            label="Today's collection"
            value={money(stats.collectionToday)}
            sub={`${todayBills.length} bills`}
            icon={IndianRupee}
          />
          <Stat
            label="Doctors available today"
            value={stats.doctorsToday}
            sub="As per weekly roster"
            icon={Stethoscope}
          />
        </div>
      ) : role === "Doctor" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Appointments today"
            value={stats.appointmentsToday}
            sub={`${upcomingAppointments.length} upcoming`}
            icon={CalendarDays}
          />
          <Stat
            label="Visits today"
            value={stats.visitsToday}
            sub={`${stats.admitted} admitted`}
            icon={Stethoscope}
          />
          <Stat label="Laboratory today" value={stats.labsToday} icon={FlaskConical} />
          <Stat label="Pharmacy today" value={stats.pharmsToday} icon={Pill} />
          <Stat
            label="Doctors available today"
            value={stats.doctorsToday}
            sub="As per weekly roster"
            icon={Stethoscope}
          />
        </div>
      ) : role === "Lab" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Laboratory today" value={stats.labsToday} icon={FlaskConical} />
          <Stat label="Patients registered" value={stats.patients} icon={Users} />
          <Stat label="Visits today" value={stats.visitsToday} icon={Stethoscope} />
          <Stat
            label="Appointments upcoming"
            value={stats.appointmentsUpcoming}
            icon={CalendarDays}
          />
        </div>
      ) : role === "Pharmacy" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Pharmacy today" value={stats.pharmsToday} icon={Pill} />
          <Stat
            label="Low-stock items"
            value={stats.lowStockCount}
            sub={stats.lowStockCount ? "Needs restock" : "Stock healthy"}
            icon={AlertTriangle}
          />
          <Stat label="Patients registered" value={stats.patients} icon={Users} />
          <Stat label="Visits today" value={stats.visitsToday} icon={Stethoscope} />
          <Stat
            label="Appointments upcoming"
            value={stats.appointmentsUpcoming}
            icon={CalendarDays}
          />
        </div>
      ) : role === "Billing" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Today's collection"
            value={money(stats.collectionToday)}
            sub={`Billed ${money(stats.billedToday)}`}
            icon={IndianRupee}
          />
          <Stat
            label="Bills today"
            value={todayBills.length}
            sub={`${paidToday} paid · ${partialToday} partial · ${dueToday} due`}
          />
          <Stat
            label="Outstanding (today)"
            value={money(stats.dueToday)}
            sub={`All-time ${money(stats.dueAll)}`}
          />
          <Stat
            label="All-time collection"
            value={money(stats.collectionAll)}
            sub={`Billed ${money(stats.billedAll)}`}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Patients registered" value={stats.patients} icon={Users} />
          <Stat
            label="Appointments today"
            value={stats.appointmentsToday}
            sub={`${stats.appointmentsUpcoming} upcoming`}
            icon={CalendarDays}
          />
          <Stat label="Visits today" value={stats.visitsToday} icon={Stethoscope} />
          <Stat label="Laboratory today" value={stats.labsToday} icon={FlaskConical} />
          <Stat label="Radiology today" value={stats.radsToday} icon={Scan} />
          <Stat label="Pharmacy today" value={stats.pharmsToday} icon={Pill} />
          <Stat
            label="Today's collection"
            value={money(stats.collectionToday)}
            sub={`${todayBills.length} bills`}
            icon={IndianRupee}
          />
          <Stat label="Admitted (IPD)" value={stats.admitted} />
          <Stat
            label="Low-stock items"
            value={stats.lowStockCount}
            sub={stats.lowStockCount ? "Needs restock" : "Stock healthy"}
            icon={AlertTriangle}
          />
          <Stat
            label="Doctors available today"
            value={stats.doctorsToday}
            sub="As per weekly roster"
            icon={Stethoscope}
          />
        </div>
      )}

      {/* Operational summaries */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Quick actions
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Role-based workflows for {role}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickActions.map((a) => (
                <QuickAction key={a.to + a.title} {...a} />
              ))}
            </div>
          </Card>

          {/* Low-stock alerts — Pharmacy & Admin portals */}
          {(role === "Admin" || role === "Pharmacy") && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Low-stock alerts
                  <Badge tone={lowStock.length ? "red" : "green"}>{lowStock.length}</Badge>
                </h3>
                <Link to="/pharmacy" className="text-xs text-accent underline">
                  Manage stock
                </Link>
              </div>
              {lowStock.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No low-stock items. Set stock levels on pharmacy entries to track inventory.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {lowStock.slice(0, 6).map((m) => (
                    <li
                      key={m.medication}
                      className="flex items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.medication}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.supplier ? `Supplier: ${m.supplier}` : "No supplier on file"}
                        </p>
                      </div>
                      <Badge tone="red">
                        {m.stockQty} left / min {m.minStock}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {lowStock.length > 6 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  + {lowStock.length - 6} more — see Pharmacy for the full list.
                </p>
              ) : null}
            </Card>
          )}

          {/* Today's appointments shortcut */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Today's appointments
                <Badge tone="amber">{todayAppointments.length}</Badge>
              </h3>
              <Link to="/appointments" className="text-xs text-accent underline">
                View all
              </Link>
            </div>
            {todayAppointments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No appointments scheduled for today.{" "}
                <Link to="/appointments" className="text-accent underline">
                  Schedule one
                </Link>
                .
              </p>
            ) : (
              <div className="max-h-80 overflow-auto rounded-md ring-1 ring-border/60">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="sticky top-0 bg-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Time</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase">
                        Patient
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase">
                        Doctor
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
                    {todayAppointments.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {a.time || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            to="/patients/$patientId"
                            params={{ patientId: a.patientId }}
                            className="text-accent underline"
                          >
                            {state.patients[a.patientId]?.name ?? "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{a.doctor || "—"}</td>
                        <td className="px-3 py-2">{a.type}</td>
                        <td className="px-3 py-2">
                          <Badge
                            tone={
                              a.status === "Completed" || a.status === "Confirmed"
                                ? "green"
                                : a.status === "Cancelled" || a.status === "NoShow"
                                  ? "red"
                                  : "amber"
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent visits
            </h3>
            <DataTable
              columns={["Date", "Patient", "Type", "Doctor", "Diagnosis"]}
              rowCount={recentVisits.length}
            >
              {recentVisits.map((v) => (
                <tr key={v.id}>
                  <Td>{fmtDate(v.date)}</Td>
                  <Td>
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: v.patientId }}
                      className="text-accent underline"
                    >
                      {state.patients[v.patientId]?.name ?? "—"}
                    </Link>
                  </Td>
                  <Td>{v.type}</Td>
                  <Td>{v.doctor || "—"}</Td>
                  <Td>{v.diagnosis || "—"}</Td>
                </tr>
              ))}
            </DataTable>
          </div>
        </div>

        <div className="space-y-5">
          {/* Upcoming appointments */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Upcoming
            </h3>
            {upcomingAppointments.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No upcoming appointments.
              </p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {upcomingAppointments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-2 rounded-md bg-muted/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {state.patients[a.patientId]?.name ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(a.date)} {a.time ? `· ${a.time}` : ""}{" "}
                        {a.doctor ? `· ${a.doctor}` : ""}
                      </p>
                    </div>
                    <Badge
                      tone={
                        a.status === "Completed"
                          ? "green"
                          : a.status === "Cancelled"
                            ? "red"
                            : "amber"
                      }
                    >
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Today's roster — who is available to book */}
          {(role === "Admin" || role === "Reception" || role === "Doctor") && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Stethoscope className="h-4 w-4" /> Available today
                  <Badge tone={doctorsTodayList.length ? "green" : "neutral"}>
                    {doctorsTodayList.length}
                  </Badge>
                </h3>
                <Link to="/appointments" className="text-xs text-accent underline">
                  Roster
                </Link>
              </div>
              {doctorsTodayList.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No doctors on today's roster. Add weekly availability under Appointments.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {doctorsTodayList.slice(0, 6).map((d) => (
                    <li
                      key={d.id}
                      className="flex items-start justify-between gap-2 rounded-md bg-muted/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.doctor}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.department || "General"}
                          {d.slots ? ` · ${d.slots}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* Collections summary - visible to billing/admin/reception */}
          {(role === "Admin" || role === "Billing" || role === "Reception") && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Collections today
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bills</span>
                  <span className="font-medium">{todayBills.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Billed</span>
                  <span className="font-medium">
                    {money(todayBills.reduce((s, b) => s + Number(b.totalAmount || 0), 0))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collected</span>
                  <span className="font-medium text-emerald-700">
                    {money(stats.collectionToday)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span className="font-medium text-amber-700">{money(stats.dueToday)}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-emerald-50 px-2 py-1.5 text-center">
                    <p className="text-muted-foreground">Paid</p>
                    <p className="font-semibold text-emerald-700">{paidToday}</p>
                  </div>
                  <div className="rounded bg-amber-50 px-2 py-1.5 text-center">
                    <p className="text-muted-foreground">Partial</p>
                    <p className="font-semibold text-amber-700">{partialToday}</p>
                  </div>
                  <div className="rounded bg-red-50 px-2 py-1.5 text-center">
                    <p className="text-muted-foreground">Due</p>
                    <p className="font-semibold text-red-700">{dueToday}</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Get set up
            </h3>
            <ul className="space-y-2.5 text-sm">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-start gap-2">
                  {c.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={c.done ? "text-foreground" : "text-muted-foreground"}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <PrintOverlay open={dayEnd} title="Day-end Summary" onClose={() => setDayEnd(false)}>
        <table>
          <tbody>
            <tr>
              <th>Appointments today</th>
              <td>{stats.appointmentsToday}</td>
            </tr>
            <tr>
              <th>Visits today</th>
              <td>{stats.visitsToday}</td>
            </tr>
            <tr>
              <th>Laboratory tests</th>
              <td>{stats.labsToday}</td>
            </tr>
            <tr>
              <th>Radiology studies</th>
              <td>{stats.radsToday}</td>
            </tr>
            <tr>
              <th>Pharmacy entries</th>
              <td>{stats.pharmsToday}</td>
            </tr>
            <tr>
              <th>Bills raised</th>
              <td>{todayBills.length}</td>
            </tr>
            <tr>
              <th>Billed amount</th>
              <td>{money(todayBills.reduce((s, b) => s + Number(b.totalAmount || 0), 0))}</td>
            </tr>
            <tr>
              <th>Collected</th>
              <td>{money(stats.collectionToday)}</td>
            </tr>
            <tr>
              <th>Outstanding (today)</th>
              <td>{money(todayBills.reduce((s, b) => s + Number(b.due || 0), 0))}</td>
            </tr>
            <tr>
              <th>Currently admitted</th>
              <td>{stats.admitted}</td>
            </tr>
          </tbody>
        </table>
      </PrintOverlay>
    </div>
  );
}
