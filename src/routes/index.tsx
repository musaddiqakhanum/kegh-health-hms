import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Circle, FileText } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import { dashboardStats, sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, isSameDay, money } from "@/lib/hms/format";
import { getStoredToken } from "@/lib/hms/drive";
import { Button, Card, DataTable, PageHeader, Td } from "@/components/hms/ui";
import { PrintOverlay } from "@/components/hms/PrintOverlay";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — KEGH HMS" },
      { name: "description", content: "Daily hospital activity, collections and recent visits." },
      { property: "og:title", content: "Dashboard — KEGH HMS" },
      { property: "og:description", content: "Daily hospital activity, collections and recent visits." },
    ],
  }),
  component: Dashboard,
});

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function Dashboard() {
  const { state, settings } = useHms();
  const [dayEnd, setDayEnd] = useState(false);
  const stats = useMemo(() => dashboardStats(state), [state]);
  const recent = useMemo(() => sortByDateDesc(Object.values(state.visits)).slice(0, 6), [state.visits]);

  const checklist = [
    { label: "Hospital details filled in", done: Boolean(settings.hospitalName && settings.hospitalAddress && settings.hospitalPhone) },
    { label: `Role selected (${settings.role})`, done: true },
    { label: "Google Drive connected", done: Boolean(settings.driveClientId && getStoredToken()) },
    { label: "Encryption passphrase enabled", done: settings.encryptionEnabled },
  ];

  const todayBills = Object.values(state.bills).filter((b) => isSameDay(b.date));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Today at a glance"
        actions={
          <Button onClick={() => setDayEnd(true)}>
            <FileText className="h-4 w-4" /> Day-end report
          </Button>
        }
      />

      <Card className="sidebar-gradient text-white">
        <h2 className="text-xl font-bold">{settings.hospitalName || "KEGH Hospital"}</h2>
        <p className="mt-1 text-sm text-white/80">{settings.hospitalAddress || "Add your hospital address in Settings"}</p>
        <p className="text-sm text-white/80">
          {settings.hospitalPhone ? `Phone: ${settings.hospitalPhone}` : "Add a phone number in Settings"}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Patients registered" value={stats.patients} />
        <Stat label="Visits today" value={stats.visitsToday} />
        <Stat label="Laboratory today" value={stats.labsToday} />
        <Stat label="Radiology today" value={stats.radsToday} />
        <Stat label="Pharmacy today" value={stats.pharmsToday} />
        <Stat label="Today's collection" value={money(stats.collectionToday)} />
        <Stat label="Admitted (IPD)" value={stats.admitted} />
        <Stat label="All-time collection" value={money(stats.collectionAll)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent visits
          </h3>
          <DataTable columns={["Date", "Patient", "Type", "Doctor", "Diagnosis"]} rowCount={recent.length}>
            {recent.map((v) => (
              <tr key={v.id}>
                <Td>{fmtDate(v.date)}</Td>
                <Td>
                  <Link to="/patients/$patientId" params={{ patientId: v.patientId }} className="text-accent underline">
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
                <span className={c.done ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <PrintOverlay open={dayEnd} title="Day-end Summary" onClose={() => setDayEnd(false)}>
        <table>
          <tbody>
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
