import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ClipboardList,
  FlaskConical,
  IndianRupee,
  ListOrdered,
  Pill,
  Receipt,
  Scan,
  ScrollText,
  Stethoscope,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import {
  appointmentsOn,
  dueBills,
  doctorMatches,
  myRecentPatients,
  myTodayAppointments,
  myTodayQueue,
  nextTokenNo,
  patientName,
  prescriptionSummary,
  queueStats,
  sortByDateDesc,
  todayCollection,
  waitingQueue,
} from "@/lib/hms/selectors";
import { fmtDate, isSameDay, money, todayISO } from "@/lib/hms/format";
import { navForRole } from "./nav";
import { Badge, Button, Card, DataTable, PageHeader, Td } from "./ui";
import type { Appointment } from "@/lib/hms/types";
import { cn } from "@/lib/utils";

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- shared bits */

/** Stat tile that deep-links into the page where the number comes from. */
function WsStat({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: string | number;
  tone?: "green" | "amber" | "red" | undefined;
  to: string;
}) {
  return (
    <Link to={to} className="block rounded-lg transition-shadow hover:shadow-md">
      <Card className="h-full p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1.5 text-2xl font-semibold text-foreground",
            tone === "red" && "text-red-700",
            tone === "amber" && "text-amber-700",
            tone === "green" && "text-emerald-700",
          )}
        >
          {value}
        </p>
      </Card>
    </Link>
  );
}

interface QuickLink {
  to: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
}

function QuickLinks({ title, links }: { title: string; links: QuickLink[] }) {
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {links.map((l) => (
          <Link
            key={l.to + l.label}
            to={l.to}
            className="group rounded-lg border border-border/70 bg-background p-3 transition-colors hover:bg-muted"
          >
            <l.icon className="mb-2 h-5 w-5 text-accent" />
            <p className="text-sm font-medium text-foreground group-hover:text-accent">{l.label}</p>
            {l.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{l.hint}</p> : null}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <p className="py-3 text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

/** Shared subtitle for every workspace: date plus the signed-in person. */
function WsHeader({
  title,
  person,
  extra,
}: {
  title: string;
  person?: string | undefined;
  extra?: string | undefined;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={`${extra ? extra + " · " : ""}${fmtDate(todayISO())}${person ? ` · ${person}` : ""}`}
    />
  );
}

/* ------------------------------------------------------------- reception */

export function ReceptionWorkspace() {
  const { state, upsert } = useHms();
  const { user } = useSession();
  const today = todayISO();
  const day = useMemo(() => appointmentsOn(state, today), [state, today]);
  const queue = useMemo(() => queueStats(state, today), [state, today]);
  const due = useMemo(() => dueBills(state), [state]);
  const serving = useMemo(() => waitingQueue(state, today)[0] ?? null, [state, today]);
  const count = (s: Appointment["status"]) => day.filter((a) => a.status === s).length;
  const arrivals = useMemo(
    () => day.filter((a) => a.status === "Scheduled" || a.status === "Confirmed").slice(0, 6),
    [day],
  );

  const checkIn = (a: Appointment) => {
    const token = nextTokenNo(state, a.date);
    upsert<Appointment>("appointments", {
      ...a,
      status: "CheckedIn",
      tokenNo: token,
      tokenTime: hhmmNow(),
    });
    toast.success(`Token ${token} issued to ${patientName(state, a.patientId)}`);
  };

  return (
    <div className="space-y-6">
      <WsHeader title="Front desk" person={user?.displayName} extra="Reception workspace" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WsStat to="/appointments" label="Booked today" value={day.length} />
        <WsStat to="/appointments" label="Scheduled" value={count("Scheduled")} />
        <WsStat to="/appointments" label="Confirmed" value={count("Confirmed")} />
        <WsStat to="/queue" label="Waiting in queue" value={count("CheckedIn")} tone="amber" />
        <WsStat
          to="/appointments"
          label="Completed today"
          value={count("Completed")}
          tone="green"
        />
        <WsStat to="/queue" label="Tokens issued" value={queue.tokens} />
        <WsStat
          to="/queue"
          label="Now serving"
          value={
            serving ? `#${serving.tokenNo ?? "—"} · ${patientName(state, serving.patientId)}` : "—"
          }
        />
        <WsStat
          to="/billing"
          label="Bills with dues"
          value={due.length}
          tone={due.length ? "red" : undefined}
        />
        <WsStat
          to="/billing"
          label="Total due"
          value={money(due.reduce((s, d) => s + Number(d.bill.due || 0), 0))}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Next arrivals — one-click check-in"
          badge={
            <Badge tone={arrivals.length ? "amber" : "neutral"}>{arrivals.length} pending</Badge>
          }
        >
          {arrivals.length === 0 ? (
            <EmptyRow>
              Nothing pending today — every booked appointment is checked in or closed.
            </EmptyRow>
          ) : (
            <ul className="space-y-2">
              {arrivals.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-card p-3 ring-1 ring-border/60"
                >
                  <span className="text-sm text-muted-foreground">{a.time || "—"}</span>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: a.patientId }}
                    className="text-sm font-medium text-accent underline"
                  >
                    {patientName(state, a.patientId)}
                  </Link>
                  <span className="text-sm text-muted-foreground">{a.doctor || "No doctor"}</span>
                  <Badge tone="amber">{a.status}</Badge>
                  <Button variant="outline" className="ml-auto" onClick={() => checkIn(a)}>
                    <UserCheck className="h-4 w-4" /> Check in
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <QuickLinks
          title="Quick actions"
          links={[
            {
              to: "/patients",
              label: "Register a patient",
              icon: Users,
              hint: "New patient record",
            },
            {
              to: "/appointments",
              label: "Book an appointment",
              icon: CalendarDays,
              hint: "Against the roster",
            },
            {
              to: "/queue",
              label: "Open the token queue",
              icon: ListOrdered,
              hint: "Live OPD queue",
            },
            {
              to: "/billing",
              label: "See unpaid bills",
              icon: IndianRupee,
              hint: `${due.length} bill${due.length === 1 ? "" : "s"} with dues`,
            },
          ]}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- doctor */

export function DoctorWorkspace() {
  const { state } = useHms();
  const { user } = useSession();
  const name = user?.displayName ?? "";
  const queue = useMemo(() => (user ? myTodayQueue(state, user) : []), [state, user]);
  const appts = useMemo(() => (user ? myTodayAppointments(state, user) : []), [state, user]);
  const recent = useMemo(() => (user ? myRecentPatients(state, user) : []), [state, user]);
  const rxToday = useMemo(
    () =>
      Object.values(state.prescriptions ?? {}).filter(
        (r) => isSameDay(r.date) && doctorMatches(name, r.doctor),
      ).length,
    [state.prescriptions, name],
  );

  return (
    <div className="space-y-6">
      <WsHeader title="OPD consultation" person={name || undefined} extra="Doctor workspace" />

      {!user ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Sign in with a doctor account (Settings → Users) — your queue, appointments and recent
            patients match your display name against the doctor field.
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WsStat
          to="/queue"
          label="My queue now"
          value={queue.length}
          tone={queue.length ? "amber" : undefined}
        />
        <WsStat to="/appointments" label="My appointments today" value={appts.length} />
        <WsStat to="/prescriptions" label="My prescriptions today" value={rxToday} />
        <WsStat to="/visits" label="My recent patients" value={recent.length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="My OPD queue today"
          badge={<Badge tone={queue.length ? "amber" : "neutral"}>{queue.length} waiting</Badge>}
        >
          {queue.length === 0 ? (
            <EmptyRow>No checked-in patients in your queue yet.</EmptyRow>
          ) : (
            <DataTable columns={["Token", "Patient", "Checked in", "Type"]} rowCount={queue.length}>
              {queue.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Badge tone="neutral">{a.tokenNo ?? "—"}</Badge>
                  </Td>
                  <Td>
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: a.patientId }}
                      className="text-accent underline"
                    >
                      {patientName(state, a.patientId)}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{a.tokenTime || "—"}</Td>
                  <Td>{a.type}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>

        <Section
          title="My appointments today"
          badge={<Badge tone="neutral">{appts.length} open</Badge>}
        >
          {appts.length === 0 ? (
            <EmptyRow>No open appointments on your name today.</EmptyRow>
          ) : (
            <ul className="space-y-1 text-sm">
              {appts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{a.time || "—"}</span>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: a.patientId }}
                    className="font-medium text-accent underline"
                  >
                    {patientName(state, a.patientId)}
                  </Link>
                  <span className="text-muted-foreground">{a.department || ""}</span>
                  <Badge tone={a.status === "CheckedIn" ? "amber" : "green"}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="My recent patients"
        badge={<Badge tone="neutral">{recent.length} shown</Badge>}
      >
        {recent.length === 0 ? (
          <EmptyRow>No visits on your name yet.</EmptyRow>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.map(({ patient, visit }) => (
              <li key={patient.id} className="rounded-lg bg-card p-3 ring-1 ring-border/60">
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: patient.id }}
                  className="text-sm font-medium text-accent underline"
                >
                  {patient.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fmtDate(visit.date)} · {visit.type}
                  {visit.diagnosis ? ` · ${visit.diagnosis}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <QuickLinks
        title="Quick actions"
        links={[
          { to: "/visits", label: "Add a visit", icon: Stethoscope, hint: "OPD / IPD record" },
          {
            to: "/prescriptions",
            label: "Write a prescription",
            icon: ScrollText,
            hint: "With letterhead print",
          },
          { to: "/laboratory", label: "Laboratory", icon: FlaskConical, hint: "Results and flags" },
          { to: "/radiology", label: "Radiology", icon: Scan, hint: "Studies and impressions" },
        ]}
      />
    </div>
  );
}

/* --------------------------------------------------------------- pharmacy */

export function PharmacyWorkspace() {
  const { state } = useHms();
  const { user } = useSession();
  const rxToday = useMemo(
    () =>
      sortByDateDesc(
        Object.values(state.prescriptions ?? {}).filter((r) => isSameDay(r.date)),
      ).slice(0, 8),
    [state.prescriptions],
  );
  const pharms = useMemo(() => sortByDateDesc(Object.values(state.pharms ?? {})), [state.pharms]);
  const pharmsToday = pharms.filter((p) => isSameDay(p.date)).length;
  const recentPharms = pharms.slice(0, 6);

  return (
    <div className="space-y-6">
      <WsHeader title="Dispense" person={user?.displayName} extra="Pharmacy workspace" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WsStat
          to="/prescriptions"
          label="Prescriptions today"
          value={rxToday.length}
          tone={rxToday.length ? "amber" : undefined}
        />
        <WsStat to="/pharmacy" label="Dispense entries today" value={pharmsToday} />
        <WsStat to="/pharmacy" label="Dispense entries (all)" value={pharms.length} />
        <WsStat
          to="/pharmacy"
          label="Dispensed value (all)"
          value={money(pharms.reduce((s, p) => s + Number(p.qty || 0) * Number(p.rate || 0), 0))}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Prescriptions written today"
          badge={
            <Badge tone={rxToday.length ? "amber" : "neutral"}>{rxToday.length} to review</Badge>
          }
        >
          <p className="mb-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            No dispense status exists on prescriptions yet, so every prescription from today is
            listed here — the honest stand-in for an "awaiting dispense" queue.
          </p>
          {rxToday.length === 0 ? (
            <EmptyRow>No prescriptions written today.</EmptyRow>
          ) : (
            <ul className="space-y-1 text-sm">
              {rxToday.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: r.patientId }}
                    className="font-medium text-accent underline"
                  >
                    {patientName(state, r.patientId)}
                  </Link>
                  <span className="text-muted-foreground">{r.doctor || "—"}</span>
                  <span className="text-muted-foreground">{prescriptionSummary(r)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Recent dispense entries"
          badge={<Badge tone="neutral">{recentPharms.length} shown</Badge>}
        >
          {recentPharms.length === 0 ? (
            <EmptyRow>No dispense entries yet.</EmptyRow>
          ) : (
            <ul className="space-y-1 text-sm">
              {recentPharms.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{fmtDate(p.date)}</span>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: p.patientId }}
                    className="font-medium text-accent underline"
                  >
                    {patientName(state, p.patientId)}
                  </Link>
                  <span>{p.medication}</span>
                  <span className="ml-auto font-medium">{money(p.qty * p.rate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <QuickLinks
        title="Quick actions"
        links={[
          {
            to: "/prescriptions",
            label: "Prescriptions list",
            icon: ScrollText,
            hint: "All ranges and print",
          },
          {
            to: "/pharmacy",
            label: "Pharmacy dispense log",
            icon: Pill,
            hint: "Entry per medication",
          },
        ]}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- lab */

export function LabWorkspace() {
  const { state } = useHms();
  const { user } = useSession();
  const labs = useMemo(() => sortByDateDesc(Object.values(state.labs ?? {})), [state.labs]);
  const labsToday = labs.filter((l) => isSameDay(l.date)).length;
  const critical = labs.filter((l) => l.flag === "critical").length;
  const recent = labs.slice(0, 8);
  const tone = (f: string) =>
    (f === "normal" ? "green" : f === "critical" ? "red" : "amber") as "green" | "red" | "amber";

  return (
    <div className="space-y-6">
      <WsHeader title="Laboratory" person={user?.displayName} extra="Lab workspace" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WsStat to="/laboratory" label="Lab entries today" value={labsToday} />
        <WsStat to="/laboratory" label="Lab entries (all)" value={labs.length} />
        <WsStat
          to="/laboratory"
          label="Critical flags"
          value={critical}
          tone={critical ? "red" : undefined}
        />
        <WsStat
          to="/patients"
          label="Patients on file"
          value={Object.keys(state.patients).length}
        />
      </div>

      <Section
        title="Recent lab results"
        badge={<Badge tone="neutral">{recent.length} shown</Badge>}
      >
        <p className="mb-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Lab entries have no awaiting-results status yet, so this workspace lists recent activity
          only — there is no results queue to show.
        </p>
        {recent.length === 0 ? (
          <EmptyRow>No lab entries yet.</EmptyRow>
        ) : (
          <DataTable
            columns={["Date", "Patient", "Test", "Result", "Flag", "Technician"]}
            rowCount={recent.length}
          >
            {recent.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{fmtDate(l.date)}</Td>
                <Td>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: l.patientId }}
                    className="text-accent underline"
                  >
                    {patientName(state, l.patientId)}
                  </Link>
                </Td>
                <Td>{l.testName}</Td>
                <Td>
                  {l.result} {l.unit}
                </Td>
                <Td>
                  <Badge tone={tone(l.flag)}>{l.flag}</Badge>
                </Td>
                <Td>{l.technician || "—"}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <QuickLinks
        title="Quick actions"
        links={[
          {
            to: "/laboratory",
            label: "New lab entry",
            icon: FlaskConical,
            hint: "Results with ranges",
          },
          { to: "/patients", label: "Patient lookup", icon: Users, hint: "Name, MRN or phone" },
        ]}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- billing */

export function BillingWorkspace() {
  const { state, settings } = useHms();
  const { user } = useSession();
  const role = user ? user.role : settings.role;
  const allowed = useMemo(() => navForRole(role).map((i) => i.to), [role]);
  const due = useMemo(() => dueBills(state), [state]);
  const unpaid = due.filter((d) => !d.partial);
  const partial = due.filter((d) => d.partial);
  const collected = useMemo(() => todayCollection(state), [state]);
  const totalDue = due.reduce((s, d) => s + Number(d.bill.due || 0), 0);

  return (
    <div className="space-y-6">
      <WsHeader title="Billing desk" person={user?.displayName} extra="Billing workspace" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WsStat
          to="/billing"
          label="Unpaid bills"
          value={unpaid.length}
          tone={unpaid.length ? "red" : undefined}
        />
        <WsStat
          to="/billing"
          label="Partially paid"
          value={partial.length}
          tone={partial.length ? "amber" : undefined}
        />
        <WsStat to="/billing" label="Total due" value={money(totalDue)} />
        <WsStat to="/billing" label="Collected today" value={money(collected)} tone="green" />
      </div>

      <Section
        title="Bills with outstanding dues"
        badge={<Badge tone={due.length ? "red" : "neutral"}>{due.length} open</Badge>}
      >
        {due.length === 0 ? (
          <EmptyRow>Nothing outstanding — every bill is fully paid.</EmptyRow>
        ) : (
          <DataTable
            columns={["Date", "Patient", "Total", "Paid", "Due", "Payment mode"]}
            rowCount={due.length}
          >
            {due.map((d) => (
              <tr key={d.bill.id}>
                <Td className="whitespace-nowrap">{fmtDate(d.bill.date)}</Td>
                <Td>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: d.bill.patientId }}
                    className="text-accent underline"
                  >
                    {d.patientName}
                  </Link>
                </Td>
                <Td>{money(d.bill.totalAmount)}</Td>
                <Td>{money(d.bill.paid)}</Td>
                <Td>
                  <Badge tone={d.partial ? "amber" : "red"}>{money(d.bill.due)}</Badge>
                </Td>
                <Td>{d.bill.paymentMode || "—"}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <QuickLinks
        title="Quick actions"
        links={[
          {
            to: "/billing",
            label: "Billing",
            icon: IndianRupee,
            hint: "Raise bills and take payments",
          },
          {
            to: "/expenses",
            label: "Expenses",
            icon: Receipt,
            hint: "Hospital running costs",
          },
        ].filter((l) => allowed.includes(l.to))}
      />
    </div>
  );
}

/* ------------------------------------------------------------- placeholder */

/**
 * Used only if a new role is ever added without a dedicated workspace: keep
 * the landing page honest instead of faking tiles.
 */
export function GenericWorkspace({ role }: { role: string }) {
  return (
    <div>
      <WsHeader title="My workspace" extra={`${role} workspace`} />
      <Card>
        <p className="text-sm text-muted-foreground">
          No dedicated workspace exists for this role yet — use the sidebar to open your sections.
        </p>
      </Card>
      <QuickLinks
        title="Quick actions"
        links={[
          { to: "/patients", label: "Patient lookup", icon: Users, hint: "Name, MRN or phone" },
          {
            to: "/appointments",
            label: "Appointments",
            icon: CalendarDays,
            hint: "Book and track",
          },
          { to: "/reports", label: "Reports", icon: ClipboardList, hint: "Section-wise" },
        ]}
      />
    </div>
  );
}
