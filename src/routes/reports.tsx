import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Printer, Receipt } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import {
  RANGE_LABELS,
  appointmentStats,
  appointmentsInRange,
  doctorActivityRows,
  expenseCategoryTotals,
  expenseMonthlyTotals,
  expenseTotal,
  inRange,
  prescriptionSummary,
  prescriptionsInRange,
  salaryMonthlyTotals,
  topMedicines,
  type RangeKey,
} from "@/lib/hms/selectors";
import { fmtDate, money } from "@/lib/hms/format";
import { currentPeriod, shortPeriodLabel } from "@/lib/hms/payroll";
import { downloadCsv } from "@/lib/hms/csv";
import { Badge, Button, Card, Field, PageHeader, Select } from "@/components/hms/ui";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { PatientPicker } from "@/components/hms/pickers";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — KEGH HMS" },
      {
        name: "description",
        content: "Section-wise and patient-wise hospital reports with print and CSV export.",
      },
      { property: "og:title", content: "Reports — KEGH HMS" },
      {
        property: "og:description",
        content: "Section-wise and patient-wise hospital reports with print and CSV export.",
      },
    ],
  }),
  component: ReportsPage,
});

type Section = "labs" | "bills" | "pharms" | "rads" | "appointments" | "prescriptions";
const SECTION_LABELS: Record<Section, string> = {
  labs: "Laboratory",
  bills: "Billing",
  pharms: "Pharmacy",
  rads: "Radiology",
  appointments: "Appointments",
  prescriptions: "Prescriptions",
};

function ReportsPage() {
  const { state } = useHms();
  const [section, setSection] = useState<Section>("labs");
  const [range, setRange] = useState<RangeKey>("today");
  const [patientId, setPatientId] = useState("");
  const [printKind, setPrintKind] = useState<"section" | "patient" | "opd" | null>(null);
  const [expenseMode, setExpenseMode] = useState<"monthly" | "category">("monthly");
  const [opdRange, setOpdRange] = useState<RangeKey>("month");

  /* Running costs — the payroll run posts one "Salaries" expense per month. */
  const expenseMonthly = useMemo(() => expenseMonthlyTotals(state), [state]);
  const salaryMonthly = useMemo(() => salaryMonthlyTotals(state), [state]);
  const expenseByCategory = useMemo(() => expenseCategoryTotals(state), [state]);
  const expenseAll = useMemo(() => expenseTotal(state), [state]);
  const salaryAll = useMemo(
    () => [...salaryMonthly.values()].reduce((s, v) => s + v, 0),
    [salaryMonthly],
  );
  const thisMonth = currentPeriod();
  const expenseThisMonth = expenseMonthly.find(([k]) => k === thisMonth)?.[1] ?? 0;
  const salaryThisMonth = salaryMonthly.get(thisMonth) ?? 0;

  const rows = useMemo(() => {
    const list = Object.values(state[section] as Record<string, { date: string }>);
    return list.filter((r) => inRange(r.date, range));
  }, [state, section, range]);

  const sectionTable = useMemo(() => {
    const name = (id: string) => state.patients[id]?.name ?? "—";
    if (section === "labs") {
      const r = rows as unknown as (typeof state.labs)[string][];
      return {
        head: ["Date", "Patient", "Test", "Result", "Flag"],
        body: r.map((x) => [
          fmtDate(x.date),
          name(x.patientId),
          x.testName,
          `${x.result} ${x.unit}`,
          x.flag,
        ]),
        summary: [
          ["Total tests", String(r.length)],
          ["Normal", String(r.filter((x) => x.flag === "normal").length)],
          ["High / Low", String(r.filter((x) => x.flag === "high" || x.flag === "low").length)],
          ["Critical", String(r.filter((x) => x.flag === "critical").length)],
        ],
      };
    }
    if (section === "rads") {
      const r = rows as unknown as (typeof state.rads)[string][];
      return {
        head: ["Date", "Patient", "Study", "Impression", "Radiologist"],
        body: r.map((x) => [
          fmtDate(x.date),
          name(x.patientId),
          x.studyType,
          x.impression,
          x.radiologist,
        ]),
        summary: [["Total studies", String(r.length)]],
      };
    }
    if (section === "pharms") {
      const r = rows as unknown as (typeof state.pharms)[string][];
      const value = r.reduce((s, x) => s + Number(x.qty || 0) * Number(x.rate || 0), 0);
      return {
        head: ["Date", "Patient", "Medication", "Qty", "Amount"],
        body: r.map((x) => [
          fmtDate(x.date),
          name(x.patientId),
          x.medication,
          String(x.qty),
          money(x.qty * x.rate),
        ]),
        summary: [
          ["Total entries", String(r.length)],
          ["Items dispensed", String(r.reduce((s, x) => s + Number(x.qty || 0), 0))],
          ["Total value", money(value)],
        ],
      };
    }
    if (section === "appointments") {
      const r = rows as unknown as (typeof state.appointments)[string][];
      const stats = appointmentStats(r);
      return {
        head: ["Date", "Time", "Patient", "Doctor", "Department", "Type", "Status"],
        body: r.map((x) => [
          fmtDate(x.date),
          x.time || "—",
          name(x.patientId),
          x.doctor || "—",
          x.department || "—",
          x.type,
          x.status,
        ]),
        summary: [
          ["Booked", String(stats.total)],
          ["Still open", String(stats.open)],
          ["Completed", String(stats.completed)],
          ["Cancelled", String(stats.cancelled)],
          ["Tokens issued", String(stats.tokens)],
          ["Completion rate", `${stats.completedRate}%`],
          ["No-show rate", `${stats.noShowRate}%`],
        ],
      };
    }
    if (section === "prescriptions") {
      const r = rows as unknown as (typeof state.prescriptions)[string][];
      const medicines = r.reduce((s, x) => s + (x.items ?? []).length, 0);
      const distinct = new Set(
        r.flatMap((x) =>
          (x.items ?? []).map((i) => (i.medication || "").trim().toLowerCase()).filter(Boolean),
        ),
      );
      return {
        head: ["Date", "Patient", "Doctor", "Diagnosis", "Medicines"],
        body: r.map((x) => [
          fmtDate(x.date),
          name(x.patientId),
          x.doctor || "—",
          x.diagnosis || "—",
          prescriptionSummary(x, 3),
        ]),
        summary: [
          ["Prescriptions", String(r.length)],
          ["Medicines prescribed", String(medicines)],
          ["Distinct medicines", String(distinct.size)],
          ["Patients covered", String(new Set(r.map((x) => x.patientId)).size)],
        ],
      };
    }
    const r = rows as unknown as (typeof state.bills)[string][];
    const modes = ["Cash", "UPI", "Card", "Insurance"];
    return {
      head: ["Date", "Patient", "Total", "Paid", "Due", "Mode"],
      body: r.map((x) => [
        fmtDate(x.date),
        name(x.patientId),
        money(x.totalAmount),
        money(x.paid),
        money(x.due),
        x.paymentMode,
      ]),
      summary: [
        ["Bills", String(r.length)],
        ["Billed", money(r.reduce((s, x) => s + Number(x.totalAmount || 0), 0))],
        ["Collected", money(r.reduce((s, x) => s + Number(x.paid || 0), 0))],
        ["Outstanding", money(r.reduce((s, x) => s + Number(x.due || 0), 0))],
        ...modes.map((m) => [
          `Collected via ${m}`,
          money(r.filter((x) => x.paymentMode === m).reduce((s, x) => s + Number(x.paid || 0), 0)),
        ]),
      ],
    };
  }, [rows, section, state]);

  const patient = patientId ? state.patients[patientId] : null;
  const pData = useMemo(() => {
    if (!patientId) return null;
    return {
      visits: Object.values(state.visits).filter((v) => v.patientId === patientId),
      labs: Object.values(state.labs).filter((l) => l.patientId === patientId),
      rads: Object.values(state.rads).filter((r) => r.patientId === patientId),
      pharms: Object.values(state.pharms).filter((p) => p.patientId === patientId),
      bills: Object.values(state.bills).filter((b) => b.patientId === patientId),
      appointments: Object.values(state.appointments ?? {}).filter(
        (a) => a.patientId === patientId,
      ),
      prescriptions: Object.values(state.prescriptions ?? {}).filter(
        (r) => r.patientId === patientId,
      ),
    };
  }, [state, patientId]);

  /* OPD activity & prescribing — appointments, tokens and prescriptions per doctor. */
  const opdAppts = useMemo(() => appointmentsInRange(state, opdRange), [state, opdRange]);
  const opdRxs = useMemo(() => prescriptionsInRange(state, opdRange), [state, opdRange]);
  const opdStats = useMemo(() => appointmentStats(opdAppts), [opdAppts]);
  const opdMedicines = useMemo(
    () => opdRxs.reduce((s, r) => s + (r.items ?? []).length, 0),
    [opdRxs],
  );
  const opdDoctors = useMemo(() => doctorActivityRows(state, opdRange), [state, opdRange]);
  const opdTop = useMemo(() => topMedicines(opdRxs), [opdRxs]);

  const exportSectionCsv = () =>
    downloadCsv(`${section}-${range}-report.csv`, [sectionTable.head, ...sectionTable.body]);

  const exportPatientCsv = () => {
    if (!pData || !patient) return;
    const out: (string | number)[][] = [["Section", "Date", "A", "B", "C"]];
    pData.visits.forEach((v) => out.push(["Visit", v.date, v.type, v.doctor, v.diagnosis]));
    pData.appointments.forEach((a) =>
      out.push(["Appointment", a.date, a.time || "", a.doctor || "", a.status]),
    );
    pData.prescriptions.forEach((r) =>
      out.push([
        "Prescription",
        r.date,
        r.doctor || "",
        r.diagnosis || "",
        prescriptionSummary(r, 99),
      ]),
    );
    pData.labs.forEach((l) =>
      out.push(["Lab", l.date, l.testName, `${l.result} ${l.unit}`, l.flag]),
    );
    pData.rads.forEach((r) =>
      out.push(["Radiology", r.date, r.studyType, r.impression, r.radiologist]),
    );
    pData.pharms.forEach((p) =>
      out.push(["Pharmacy", p.date, p.medication, p.qty, p.qty * p.rate]),
    );
    pData.bills.forEach((b) => out.push(["Bill", b.date, b.totalAmount, b.paid, b.due]));
    downloadCsv(`${patient.mrn.replace(/\//g, "-")}-report.csv`, out);
  };

  const exportOpdCsv = () =>
    downloadCsv(`kegh-opd-activity-${opdRange}.csv`, [
      [
        "Doctor",
        "Appointments",
        "Completed",
        "Cancelled",
        "No-show",
        "No-show %",
        "Tokens",
        "Prescriptions",
        "Medicines",
      ],
      ...opdDoctors.map((d) => [
        d.doctor,
        d.total,
        d.completed,
        d.cancelled,
        d.noShow,
        `${d.noShowRate}%`,
        d.tokens,
        d.prescriptions,
        d.medicines,
      ]),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Section-wise, patient-wise and monthly expense summaries"
      />

      {/* Running costs — includes the salary expense posted by each payroll run */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Expense &amp; salary summary
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="amber">{money(expenseAll)} all-time</Badge>
            <Link to="/expenses">
              <Button variant="outline">
                <Receipt className="h-4 w-4" /> Expenses page
              </Button>
            </Link>
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Hospital running costs entered on the Expenses page. Each payroll run posts one
          &ldquo;Salaries&rdquo; entry per month, so the salary column below is the net pay of that
          month&rsquo;s run.
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Expenses · {shortPeriodLabel(thisMonth)}
            </p>
            <p className="text-base font-semibold">{money(expenseThisMonth)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Salaries · {shortPeriodLabel(thisMonth)}
            </p>
            <p className="text-base font-semibold">{money(salaryThisMonth)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Salaries all-time</p>
            <p className="text-base font-semibold">{money(salaryAll)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Collected · {RANGE_LABELS[range]}</p>
            <p className="text-base font-semibold">
              {money(
                Object.values(state.bills)
                  .filter((b) => inRange(b.date, range))
                  .reduce((s, b) => s + Number(b.paid || 0), 0),
              )}
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant={expenseMode === "monthly" ? "primary" : "outline"}
            onClick={() => setExpenseMode("monthly")}
          >
            Monthly totals
          </Button>
          <Button
            variant={expenseMode === "category" ? "primary" : "outline"}
            onClick={() => setExpenseMode("category")}
          >
            By category
          </Button>
          <Button
            variant="outline"
            disabled={!expenseMonthly.length}
            onClick={() =>
              downloadCsv("kegh-expense-monthly-totals.csv", [
                ["Month", "Expenses", "Of which salaries", "Share"],
                ...expenseMonthly.map(([key, total]) => [
                  shortPeriodLabel(key),
                  total,
                  salaryMonthly.get(key) ?? 0,
                  expenseAll > 0 ? `${((total / expenseAll) * 100).toFixed(0)}%` : "—",
                ]),
              ])
            }
          >
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>

        {expenseMode === "monthly" ? (
          <div className="max-h-80 overflow-auto rounded-md ring-1 ring-border/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Month</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Expenses</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">
                    Of which salaries
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Share</th>
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
                {expenseMonthly.map(([key, total]) => (
                  <tr key={key}>
                    <td className="px-3 py-2 font-medium">{shortPeriodLabel(key)}</td>
                    <td className="px-3 py-2">{money(total)}</td>
                    <td className="px-3 py-2">
                      {salaryMonthly.get(key) ? money(salaryMonthly.get(key)) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {expenseAll > 0 ? `${((total / expenseAll) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {expenseMonthly.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      No expenses recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {expenseByCategory.map(([cat, total]) => (
              <div key={cat} className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">{cat}</p>
                <p className="text-base font-semibold">{money(total)}</p>
              </div>
            ))}
            {expenseByCategory.length === 0 ? (
              <p className="col-span-full py-4 text-center text-sm text-muted-foreground">
                No expenses recorded yet.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Section-wise report
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Section">
            <Select value={section} onChange={(e) => setSection(e.target.value as Section)}>
              {Object.entries(SECTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date range">
            <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
              {Object.entries(RANGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => setPrintKind("section")}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" onClick={exportSectionCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sectionTable.summary.map(([k, v]) => (
            <div key={k} className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-base font-semibold">{v}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 max-h-80 overflow-auto rounded-md ring-1 ring-border/60">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-secondary">
              <tr>
                {sectionTable.head.map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
              {sectionTable.body.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sectionTable.body.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No records in this range.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            OPD activity &amp; prescribing
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={opdRange}
              onChange={(e) => setOpdRange(e.target.value as RangeKey)}
              className="w-40"
              aria-label="OPD report range"
            >
              {Object.entries(RANGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Button onClick={() => setPrintKind("opd")}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" disabled={opdDoctors.length === 0} onClick={exportOpdCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Appointments", String(opdStats.total)],
            ["Completed", `${opdStats.completedRate}%`],
            ["No-show rate", `${opdStats.noShowRate}%`],
            ["Tokens issued", String(opdStats.tokens)],
            ["Prescriptions", String(opdRxs.length)],
            ["Medicines", String(opdMedicines)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-base font-semibold">{v}</p>
            </div>
          ))}
        </div>

        <div className="max-h-80 overflow-auto rounded-md ring-1 ring-border/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-secondary">
              <tr>
                {[
                  "Doctor",
                  "Appointments",
                  "Completed",
                  "Cancelled",
                  "No-show",
                  "No-show %",
                  "Tokens",
                  "Prescriptions",
                  "Medicines",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
              {opdDoctors.map((d) => (
                <tr key={d.doctor}>
                  <td className="px-3 py-2 font-medium">{d.doctor}</td>
                  <td className="px-3 py-2">{d.total}</td>
                  <td className="px-3 py-2">{d.completed}</td>
                  <td className="px-3 py-2">{d.cancelled}</td>
                  <td className="px-3 py-2">{d.noShow}</td>
                  <td className="px-3 py-2">{d.noShowRate}%</td>
                  <td className="px-3 py-2">{d.tokens}</td>
                  <td className="px-3 py-2">{d.prescriptions}</td>
                  <td className="px-3 py-2">{d.medicines}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {opdDoctors.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No appointments or prescriptions in this range.
            </p>
          ) : null}
        </div>

        {opdTop.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Most prescribed
            </span>
            {opdTop.map(([name, count]) => (
              <Badge key={name} tone="neutral">
                {name} ×{count}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Patient-wise report
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient">
            <PatientPicker value={patientId} onChange={setPatientId} />
          </Field>
          <div className="flex items-end gap-2">
            <Button disabled={!patientId} onClick={() => setPrintKind("patient")}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" disabled={!patientId} onClick={exportPatientCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
        {pData && patient ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Visits", pData.visits.length],
              ["Appointments", pData.appointments.length],
              ["Prescriptions", pData.prescriptions.length],
              ["Lab tests", pData.labs.length],
              ["Studies", pData.rads.length],
              ["Pharmacy", pData.pharms.length],
              ["Billed", money(pData.bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0))],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="text-base font-semibold">{v}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <PrintOverlay
        open={printKind === "section"}
        title={`${SECTION_LABELS[section]} Report — ${RANGE_LABELS[range]}`}
        onClose={() => setPrintKind(null)}
      >
        <table className="mb-4">
          <tbody>
            {sectionTable.summary.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              {sectionTable.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectionTable.body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </PrintOverlay>

      <PrintOverlay
        open={printKind === "opd"}
        title={`OPD Activity — ${RANGE_LABELS[opdRange]}`}
        onClose={() => setPrintKind(null)}
      >
        <table className="mb-4">
          <tbody>
            {[
              ["Appointments", String(opdStats.total)],
              ["Completed", `${opdStats.completed} (${opdStats.completedRate}%)`],
              ["Cancelled", String(opdStats.cancelled)],
              ["No-show", `${opdStats.noShow} (${opdStats.noShowRate}%)`],
              ["Tokens issued", String(opdStats.tokens)],
              ["Prescriptions", String(opdRxs.length)],
              ["Medicines prescribed", String(opdMedicines)],
            ].map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mb-4">
          <thead>
            <tr>
              {[
                "Doctor",
                "Appointments",
                "Completed",
                "Cancelled",
                "No-show",
                "No-show %",
                "Tokens",
                "Prescriptions",
                "Medicines",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {opdDoctors.map((d) => (
              <tr key={d.doctor}>
                <td>{d.doctor}</td>
                <td>{d.total}</td>
                <td>{d.completed}</td>
                <td>{d.cancelled}</td>
                <td>{d.noShow}</td>
                <td>{d.noShowRate}%</td>
                <td>{d.tokens}</td>
                <td>{d.prescriptions}</td>
                <td>{d.medicines}</td>
              </tr>
            ))}
            {opdDoctors.length === 0 ? (
              <tr>
                <td colSpan={9}>No appointments or prescriptions in this range.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {opdTop.length > 0 ? (
          <p>
            <strong>Most prescribed:</strong>{" "}
            {opdTop.map(([name, count]) => `${name} ×${count}`).join(", ")}
          </p>
        ) : null}
      </PrintOverlay>

      <PrintOverlay
        open={printKind === "patient" && Boolean(patient)}
        title={`Patient Report — ${patient?.name ?? ""} (${patient?.mrn ?? ""})`}
        onClose={() => setPrintKind(null)}
      >
        {pData ? (
          <>
            <h3 className="mb-1 font-semibold">Visits</h3>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Doctor</th>
                  <th>Diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {pData.visits.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtDate(v.date)}</td>
                    <td>{v.type}</td>
                    <td>{v.doctor}</td>
                    <td>{v.diagnosis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mb-1 font-semibold">Appointments</h3>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Doctor</th>
                  <th>Token</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pData.appointments.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDate(a.date)}</td>
                    <td>{a.time || "—"}</td>
                    <td>{a.doctor || "—"}</td>
                    <td>{a.tokenNo ?? "—"}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
                {pData.appointments.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No appointments booked.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <h3 className="mb-1 font-semibold">Prescriptions</h3>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Doctor</th>
                  <th>Diagnosis</th>
                  <th>Medicines</th>
                </tr>
              </thead>
              <tbody>
                {pData.prescriptions.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.doctor || "—"}</td>
                    <td>{r.diagnosis || "—"}</td>
                    <td>{prescriptionSummary(r, 99)}</td>
                  </tr>
                ))}
                {pData.prescriptions.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No prescriptions written.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <h3 className="mb-1 font-semibold">Laboratory</h3>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Test</th>
                  <th>Result</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {pData.labs.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtDate(l.date)}</td>
                    <td>{l.testName}</td>
                    <td>
                      {l.result} {l.unit}
                    </td>
                    <td>{l.flag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mb-1 font-semibold">Radiology</h3>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Study</th>
                  <th>Impression</th>
                </tr>
              </thead>
              <tbody>
                {pData.rads.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.studyType}</td>
                    <td>{r.impression}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mb-1 font-semibold">Pharmacy</h3>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Medication</th>
                  <th>Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {pData.pharms.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td>{p.medication}</td>
                    <td>{p.qty}</td>
                    <td>{money(p.qty * p.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mb-1 font-semibold">Billing</h3>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {pData.bills.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.date)}</td>
                    <td>{money(b.totalAmount)}</td>
                    <td>{money(b.paid)}</td>
                    <td>{money(b.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </PrintOverlay>
    </div>
  );
}
