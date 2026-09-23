import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { useHms } from "@/lib/hms/store";
import {
  RANGE_LABELS,
  inRange,
  type RangeKey,
  billPaymentStatus,
  type PaymentStatus,
} from "@/lib/hms/selectors";
import { fmtDate, money } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import { EXPENSE_CATEGORIES } from "@/lib/hms/types";
import { Button, Card, Field, PageHeader, Select, Badge } from "@/components/hms/ui";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { PatientPicker } from "@/components/hms/pickers";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — KEGH HMS" },
      {
        name: "description",
        content:
          "Section-wise, paid/collections, appointments and patient-wise hospital reports with print and CSV export.",
      },
      { property: "og:title", content: "Reports — KEGH HMS" },
      {
        property: "og:description",
        content: "Hospital reports including paid collections and operational summaries.",
      },
    ],
  }),
  component: ReportsPage,
});

type Section = "labs" | "bills" | "pharms" | "rads" | "appointments";
const SECTION_LABELS: Record<Section, string> = {
  labs: "Laboratory",
  bills: "Billing",
  pharms: "Pharmacy",
  rads: "Radiology",
  appointments: "Appointments",
};

type PaidStatusFilter = PaymentStatus | "All";
type ModeFilter = "All" | "Cash" | "UPI" | "Card" | "Insurance";

function ReportsPage() {
  const { state } = useHms();
  const [section, setSection] = useState<Section>("labs");
  const [range, setRange] = useState<RangeKey>("today");
  const [patientId, setPatientId] = useState("");
  const [printKind, setPrintKind] = useState<"section" | "patient" | "paid" | null>(null);

  // Section-wise
  const rows = useMemo(() => {
    const list = Object.values((state[section] ?? {}) as Record<string, { date: string }>);
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
      return {
        head: ["Date", "Time", "Patient", "Doctor", "Type", "Status"],
        body: r.map((x) => [
          fmtDate(x.date),
          x.time || "—",
          name(x.patientId),
          x.doctor || "—",
          x.type,
          x.status,
        ]),
        summary: [
          ["Total appointments", String(r.length)],
          ["Scheduled", String(r.filter((x) => x.status === "Scheduled").length)],
          ["Confirmed", String(r.filter((x) => x.status === "Confirmed").length)],
          ["Completed", String(r.filter((x) => x.status === "Completed").length)],
          [
            "Cancelled / NoShow",
            String(r.filter((x) => x.status === "Cancelled" || x.status === "NoShow").length),
          ],
        ],
      };
    }
    const r = rows as unknown as (typeof state.bills)[string][];
    const modes = ["Cash", "UPI", "Card", "Insurance"];
    const subtotalOf = (x: (typeof r)[number]) =>
      (x.items ?? []).reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0), 0);
    return {
      head: ["Date", "Patient", "Subtotal", "Disc.", "Tax", "Total", "Paid", "Due", "Mode"],
      body: r.map((x) => [
        fmtDate(x.date),
        name(x.patientId),
        money(subtotalOf(x)),
        money(x.discount),
        money(x.tax),
        money(x.totalAmount),
        money(x.paid),
        money(x.due),
        x.paymentMode,
      ]),
      summary: [
        ["Bills", String(r.length)],
        ["Billed", money(r.reduce((s, x) => s + Number(x.totalAmount || 0), 0))],
        ["Discount given", money(r.reduce((s, x) => s + Number(x.discount || 0), 0))],
        ["Tax charged", money(r.reduce((s, x) => s + Number(x.tax || 0), 0))],
        ["Net collected", money(r.reduce((s, x) => s + Number(x.paid || 0), 0))],
        ["Outstanding", money(r.reduce((s, x) => s + Number(x.due || 0), 0))],
        ...modes.map((m) => [
          `Collected via ${m}`,
          money(r.filter((x) => x.paymentMode === m).reduce((s, x) => s + Number(x.paid || 0), 0)),
        ]),
      ],
    };
  }, [rows, section, state]);

  // Paid / Collections report
  const [paidRange, setPaidRange] = useState<RangeKey>("today");
  const [paidStatus, setPaidStatus] = useState<PaidStatusFilter>("All");
  const [paidMode, setPaidMode] = useState<ModeFilter>("All");

  const paidRows = useMemo(() => {
    let list = Object.values(state.bills).filter((b) => inRange(b.date, paidRange));
    if (paidStatus !== "All") list = list.filter((b) => billPaymentStatus(b) === paidStatus);
    if (paidMode !== "All") list = list.filter((b) => b.paymentMode === paidMode);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [state.bills, paidRange, paidStatus, paidMode]);

  const paidSummary = useMemo(() => {
    const billed = paidRows.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
    const collected = paidRows.reduce((s, b) => s + Number(b.paid || 0), 0);
    const discount = paidRows.reduce((s, b) => s + Number(b.discount || 0), 0);
    const tax = paidRows.reduce((s, b) => s + Number(b.tax || 0), 0);
    const outstanding = paidRows.reduce((s, b) => s + Number(b.due || 0), 0);
    const efficiency = billed > 0 ? (collected / billed) * 100 : 0;
    const byMode = ["Cash", "UPI", "Card", "Insurance"].map((m) => ({
      mode: m,
      collected: paidRows
        .filter((b) => b.paymentMode === m)
        .reduce((s, b) => s + Number(b.paid || 0), 0),
      count: paidRows.filter((b) => b.paymentMode === m).length,
    }));
    const byStatus = (["Paid", "Partial", "Due"] as PaymentStatus[]).map((s) => ({
      status: s,
      count: paidRows.filter((b) => billPaymentStatus(b) === s).length,
      amount: paidRows
        .filter((b) => billPaymentStatus(b) === s)
        .reduce((sum, b) => sum + Number(b.totalAmount || 0), 0),
    }));
    return {
      billed,
      collected,
      /** Net cash in hand after discounts and taxes flow through the grand total. */
      netCollected: collected,
      discount,
      tax,
      outstanding,
      efficiency,
      byMode,
      byStatus,
      count: paidRows.length,
    };
  }, [paidRows]);

  const [expenseMode, setExpenseMode] = useState<"monthly" | "category">("monthly");

  const expenseMonthly = useMemo(() => {
    const months = new Map<string, number>();
    for (const e of Object.values(state.expenses ?? {})) {
      const key = (e.date || "").slice(0, 7);
      if (!key || key === "NaN-NaN") continue;
      months.set(key, (months.get(key) ?? 0) + Number(e.amount || 0));
    }
    return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [state.expenses]);

  const expenseCategoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of EXPENSE_CATEGORIES) map.set(cat, 0);
    for (const e of Object.values(state.expenses ?? {})) {
      const c = e.category || "Miscellaneous";
      map.set(c, (map.get(c) ?? 0) + Number(e.amount || 0));
    }
    return [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }, [state.expenses]);

  const expenseTotal = useMemo(
    () => Object.values(state.expenses ?? {}).reduce((s, e) => s + Number(e.amount || 0), 0),
    [state.expenses],
  );

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-");
    if (!y || !m) return key;
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[Number(m) - 1]} ${y}`;
  };

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
    };
  }, [state, patientId]);

  const exportSectionCsv = () =>
    downloadCsv(`${section}-${range}-report.csv`, [sectionTable.head, ...sectionTable.body]);

  const exportPaidCsv = () => {
    const head = [
      "Date",
      "Patient",
      "MRN",
      "Total",
      "Discount",
      "Tax",
      "Paid",
      "Due",
      "Mode",
      "Status",
    ];
    const body = paidRows.map((b) => [
      b.date,
      state.patients[b.patientId]?.name ?? "—",
      state.patients[b.patientId]?.mrn ?? "—",
      String(b.totalAmount),
      String(Number(b.discount || 0)),
      String(Number(b.tax || 0)),
      String(b.paid),
      String(b.due),
      b.paymentMode,
      billPaymentStatus(b),
    ]);
    downloadCsv(`paid-${paidRange}-${paidStatus}-${paidMode}.csv`, [head, ...body]);
  };

  const exportPatientCsv = () => {
    if (!pData || !patient) return;
    const out: (string | number)[][] = [["Section", "Date", "A", "B", "C"]];
    pData.visits.forEach((v) => out.push(["Visit", v.date, v.type, v.doctor, v.diagnosis]));
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
    pData.appointments.forEach((a) => out.push(["Appointment", a.date, a.time, a.type, a.status]));
    downloadCsv(`${patient.mrn.replace(/\//g, "-")}-report.csv`, out);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Section-wise, paid/collections, appointments and patient-wise summaries"
      />

      {/* Paid / Collections Report */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Paid & collections report
          </h2>
          <Badge tone="green">Paid HMS report</Badge>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Filter by date, payment status (Paid / Partial / Due) and payment mode. This is the
          primary billing reconciliation report for Reception, Billing and Admin portals.
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Date range">
            <Select value={paidRange} onChange={(e) => setPaidRange(e.target.value as RangeKey)}>
              {Object.entries(RANGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment status">
            <Select
              value={paidStatus}
              onChange={(e) => setPaidStatus(e.target.value as PaidStatusFilter)}
            >
              <option value="All">All</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Due">Due</option>
            </Select>
          </Field>
          <Field label="Payment mode">
            <Select value={paidMode} onChange={(e) => setPaidMode(e.target.value as ModeFilter)}>
              <option value="All">All modes</option>
              <option>Cash</option>
              <option>UPI</option>
              <option>Card</option>
              <option>Insurance</option>
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => setPrintKind("paid")}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" onClick={exportPaidCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Bills</p>
            <p className="text-base font-semibold">{paidSummary.count}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Billed</p>
            <p className="text-base font-semibold">{money(paidSummary.billed)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Discount given</p>
            <p className="text-base font-semibold">{money(paidSummary.discount)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Tax charged</p>
            <p className="text-base font-semibold">{money(paidSummary.tax)}</p>
          </div>
          <div className="rounded-md bg-emerald-50 px-3 py-2">
            <p className="text-xs text-muted-foreground">Net collected</p>
            <p className="text-base font-semibold text-emerald-700">
              {money(paidSummary.netCollected)}
            </p>
          </div>
          <div className="rounded-md bg-amber-50 px-3 py-2">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-base font-semibold text-amber-700">
              {money(paidSummary.outstanding)}
            </p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Collection efficiency</p>
            <p className="text-base font-semibold">{paidSummary.efficiency.toFixed(1)}%</p>
          </div>
          {paidSummary.byStatus.map((s) => (
            <div key={s.status} className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">{s.status}</p>
              <p className="text-base font-semibold">
                {s.count} · {money(s.amount)}
              </p>
            </div>
          ))}
          {paidSummary.byMode.map((m) => (
            <div key={m.mode} className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">Via {m.mode}</p>
              <p className="text-base font-semibold">
                {m.count} · {money(m.collected)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 max-h-80 overflow-auto rounded-md ring-1 ring-border/60">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-secondary">
              <tr>
                {["Date", "Patient", "Total", "Disc.", "Tax", "Paid", "Due", "Mode", "Status"].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
              {paidRows.map((b) => {
                const status = billPaymentStatus(b);
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2">{fmtDate(b.date)}</td>
                    <td className="px-3 py-2">{state.patients[b.patientId]?.name ?? "—"}</td>
                    <td className="px-3 py-2">{money(b.totalAmount)}</td>
                    <td className="px-3 py-2">{money(b.discount)}</td>
                    <td className="px-3 py-2">{money(b.tax)}</td>
                    <td className="px-3 py-2">{money(b.paid)}</td>
                    <td className="px-3 py-2">{money(b.due)}</td>
                    <td className="px-3 py-2">{b.paymentMode}</td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={status === "Paid" ? "green" : status === "Partial" ? "amber" : "red"}
                      >
                        {status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {paidRows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No bills match these filters.
            </p>
          ) : null}
        </div>
      </Card>

      {/* Expense summary */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Expense summary
          </h2>
          <Badge tone="amber">{money(expenseTotal)} all-time</Badge>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Hospital running costs entered on the Expenses page — monthly totals and category
          breakdown.
        </p>
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
        </div>
        {expenseMode === "monthly" ? (
          <div className="max-h-80 overflow-auto rounded-md ring-1 ring-border/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Month</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Expenses</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Share</th>
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
                {expenseMonthly.map(([key, total]) => (
                  <tr key={key}>
                    <td className="px-3 py-2 font-medium">{monthLabel(key)}</td>
                    <td className="px-3 py-2">{money(total)}</td>
                    <td className="px-3 py-2">
                      {expenseTotal > 0 ? `${((total / expenseTotal) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {expenseMonthly.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      No expenses recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {expenseCategoryTotals.map(([cat, total]) => (
              <div key={cat} className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">{cat}</p>
                <p className="text-base font-semibold">{money(total)}</p>
              </div>
            ))}
            {expenseCategoryTotals.length === 0 ? (
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
            {[
              ["Visits", pData.visits.length],
              ["Appointments", pData.appointments.length],
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
        open={printKind === "paid"}
        title={`Paid & Collections Report — ${RANGE_LABELS[paidRange]} · ${paidStatus} · ${paidMode}`}
        onClose={() => setPrintKind(null)}
      >
        <table className="mb-4">
          <tbody>
            <tr>
              <th>Bills</th>
              <td>{paidSummary.count}</td>
            </tr>
            <tr>
              <th>Billed</th>
              <td>{money(paidSummary.billed)}</td>
            </tr>
            <tr>
              <th>Discount given</th>
              <td>{money(paidSummary.discount)}</td>
            </tr>
            <tr>
              <th>Tax charged</th>
              <td>{money(paidSummary.tax)}</td>
            </tr>
            <tr>
              <th>Net collected</th>
              <td>{money(paidSummary.netCollected)}</td>
            </tr>
            <tr>
              <th>Outstanding</th>
              <td>{money(paidSummary.outstanding)}</td>
            </tr>
            <tr>
              <th>Efficiency</th>
              <td>{paidSummary.efficiency.toFixed(1)}%</td>
            </tr>
            {paidSummary.byStatus.map((s) => (
              <tr key={s.status}>
                <th>{s.status}</th>
                <td>
                  {s.count} · {money(s.amount)}
                </td>
              </tr>
            ))}
            {paidSummary.byMode.map((m) => (
              <tr key={m.mode}>
                <th>Via {m.mode}</th>
                <td>
                  {m.count} · {money(m.collected)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Total</th>
              <th>Discount</th>
              <th>Tax</th>
              <th>Paid</th>
              <th>Due</th>
              <th>Mode</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {paidRows.map((b) => (
              <tr key={b.id}>
                <td>{fmtDate(b.date)}</td>
                <td>{state.patients[b.patientId]?.name ?? "—"}</td>
                <td>{money(b.totalAmount)}</td>
                <td>{money(b.discount)}</td>
                <td>{money(b.tax)}</td>
                <td>{money(b.paid)}</td>
                <td>{money(b.due)}</td>
                <td>{b.paymentMode}</td>
                <td>{billPaymentStatus(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PrintOverlay>

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
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pData.appointments.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDate(a.date)}</td>
                    <td>{a.time}</td>
                    <td>{a.doctor}</td>
                    <td>{a.type}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
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
