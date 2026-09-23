import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarPlus,
  Download,
  FileText,
  Pencil,
  Printer,
  Receipt,
  RefreshCw,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { payrollExpenseForPeriod, payrollForPeriod, payrollPeriods } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import {
  currentPeriod,
  draftPayroll,
  netPay,
  payrollTotals,
  periodEnd,
  periodLabel,
  periodOptions,
  refreshPayroll,
  round2,
  shiftPeriod,
  shortPeriodLabel,
  staffPayableIn,
  withNet,
  type PayrollTotals,
} from "@/lib/hms/payroll";
import {
  PAYROLL_MODES,
  PAYROLL_STATUSES,
  DEDUCTION_REASONS,
  type Expense,
  type PayrollEntry,
  type PayrollStatus,
} from "@/lib/hms/types";
import { downloadCsv } from "@/lib/hms/csv";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Td,
  Textarea,
} from "@/components/hms/ui";
import { confirmDelete } from "@/components/hms/pickers";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { AdminOnly } from "@/components/hms/gate";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll — KEGH HMS" },
      {
        name: "description",
        content:
          "Run monthly payroll for hospital staff — advances, deductions, net pay and payslips.",
      },
      { property: "og:title", content: "Payroll — KEGH HMS" },
      {
        property: "og:description",
        content: "Monthly payroll run with net pay, payslips and salary expense posting.",
      },
    ],
  }),
  component: PayrollPage,
});

const statusTone = (s: PayrollStatus): "green" | "amber" | "neutral" =>
  s === "Paid" ? "green" : s === "Approved" ? "amber" : "neutral";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          tone === "green"
            ? "text-base font-semibold text-emerald-700"
            : tone === "red"
              ? "text-base font-semibold text-red-700"
              : "text-base font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}

function PayrollPage() {
  const { state, upsert, remove } = useHms();
  const navigate = useNavigate();

  const [period, setPeriod] = useState<string>(currentPeriod());
  const [q, setQ] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<PayrollEntry>>({});
  const [payOpen, setPayOpen] = useState(false);
  const [bulk, setBulk] = useState({ mode: "Bank transfer", paidOn: todayISO() });
  const [payslip, setPayslip] = useState<PayrollEntry | null>(null);
  const [printRegister, setPrintRegister] = useState(false);

  const staffRows = useMemo(() => Object.values(state.staff ?? {}), [state.staff]);
  const entries = useMemo(() => payrollForPeriod(state, period), [state, period]);
  const payableStaff = useMemo(
    () => staffRows.filter((s) => staffPayableIn(s, period)),
    [staffRows, period],
  );
  const totals: PayrollTotals = useMemo(() => payrollTotals(entries), [entries]);
  const posted = payrollExpenseForPeriod(state, period);

  const periods = useMemo(() => {
    const set = new Set<string>([...periodOptions(18, 2), ...payrollPeriods(state), period]);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [state, period]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter(
      (e) =>
        e.staffName?.toLowerCase().includes(s) ||
        e.role?.toLowerCase().includes(s) ||
        e.department?.toLowerCase().includes(s),
    );
  }, [entries, q]);

  /**
   * One Salary expense per payroll month, tagged with the period so every
   * device updates the same record instead of adding another line.
   */
  const syncSalaryExpense = (paid: PayrollEntry[]) => {
    const total = round2(paid.reduce((s, e) => s + Number(e.netPay || 0), 0));
    const existing = payrollExpenseForPeriod(state, period);
    if (total <= 0) {
      if (existing?.source === "payroll") remove("expenses", existing.id);
      return;
    }
    const modes = Array.from(new Set(paid.map((e) => e.paymentMode).filter(Boolean)));
    upsert<Expense>("expenses", {
      ...(existing ?? {}),
      id: existing?.id,
      date: periodEnd(period) || todayISO(),
      category: "Salaries",
      amount: total,
      notes: `Payroll ${periodLabel(period)} · ${paid.length} staff · net pay after advances and deductions`,
      paidBy: modes.length === 1 ? (modes[0] ?? "Payroll") : "Payroll run",
      payrollPeriod: period,
      source: "payroll",
    } as Expense);
  };

  /** Write payroll lines, then keep the month's Salary expense in step with them. */
  const commit = (updates: PayrollEntry[], announce?: string) => {
    const byId = new Map<string, PayrollEntry>(
      Object.values(state.payrolls ?? {}).map((e) => [e.id, e]),
    );
    for (const u of updates) {
      const next = withNet(u);
      byId.set(next.id, next);
      upsert<PayrollEntry>("payrolls", next);
    }
    const paid = [...byId.values()].filter((e) => e.period === period && e.status === "Paid");
    syncSalaryExpense(paid);
    if (announce) toast.success(announce);
  };

  const generate = (refresh: boolean) => {
    if (!payableStaff.length) {
      toast.error(`No staff are on roll in ${periodLabel(period)}`);
      return;
    }
    const existing = new Map(entries.map((e) => [e.staffId, e]));
    const updates: PayrollEntry[] = [];
    let added = 0;
    let skipped = 0;
    for (const s of payableStaff) {
      const prev = existing.get(s.id);
      if (!prev) {
        updates.push({ ...draftPayroll(s, period), id: crypto.randomUUID() } as PayrollEntry);
        added += 1;
      } else if (prev.status === "Paid") {
        skipped += 1;
      } else if (refresh) {
        updates.push(refreshPayroll(prev, s, period));
      }
    }
    if (!updates.length) {
      toast.info(
        skipped
          ? `${periodLabel(period)} is already paid — nothing to do`
          : `Payroll for ${periodLabel(period)} is up to date`,
      );
      return;
    }
    commit(updates);
    toast.success(
      `${added ? `${added} new line${added === 1 ? "" : "s"}` : "Payroll"} prepared for ${periodLabel(period)}${
        skipped ? ` · ${skipped} paid line${skipped === 1 ? "" : "s"} left untouched` : ""
      }`,
    );
  };

  const saveEntry = () => {
    if (!form.id) return;
    const current = state.payrolls[form.id];
    if (!current) {
      toast.error("That payroll line no longer exists");
      setEditOpen(false);
      return;
    }
    const days = Number(form.payableDays ?? current.payableDays);
    const gross = Number(form.gross ?? current.gross);
    const advanceGiven = Number(form.advanceGiven ?? 0);
    const advanceRecovery = Number(form.advanceRecovery ?? 0);
    const deductions = Number(form.deductions ?? 0);
    if ([days, gross, advanceGiven, advanceRecovery, deductions].some((n) => Number.isNaN(n))) {
      toast.error("Check the numbers — something is not a valid amount");
      return;
    }
    if (advanceGiven < 0 || advanceRecovery < 0 || deductions < 0) {
      toast.error("Advances and deductions cannot be negative");
      return;
    }
    const status = (form.status ?? current.status) as PayrollStatus;
    commit([
      withNet({
        ...current,
        ...form,
        payableDays: Math.max(0, days),
        gross: round2(gross),
        advanceGiven: round2(advanceGiven),
        advanceRecovery: round2(advanceRecovery),
        deductions: round2(deductions),
        deductionNote: (form.deductionNote ?? "").trim(),
        notes: (form.notes ?? "").trim(),
        status,
        paidOn: status === "Paid" ? form.paidOn || todayISO() : "",
        netPay: netPay({ gross, advanceGiven, advanceRecovery, deductions }),
      } as PayrollEntry),
    ]);
    toast.success("Payroll line updated");
    setEditOpen(false);
  };

  const setStatus = (entry: PayrollEntry, status: PayrollStatus) => {
    commit([
      {
        ...entry,
        status,
        paidOn: status === "Paid" ? entry.paidOn || todayISO() : "",
      },
    ]);
    toast.success(`${entry.staffName} marked ${status}`);
  };

  const markAllPaid = () => {
    const pending = entries.filter((e) => e.status !== "Paid");
    if (!pending.length) {
      toast.info("Every line for this month is already paid");
      setPayOpen(false);
      return;
    }
    if (!bulk.paidOn) {
      toast.error("Pick the payment date");
      return;
    }
    commit(
      pending.map((e) => ({
        ...e,
        status: "Paid" as PayrollStatus,
        paymentMode: bulk.mode,
        paidOn: bulk.paidOn,
      })),
      `${pending.length} line${pending.length === 1 ? "" : "s"} paid · salary expense posted to Expenses`,
    );
    setPayOpen(false);
  };

  const exportCsv = () => {
    downloadCsv(`kegh-payroll-${period}.csv`, [
      [
        "Period",
        "Staff",
        "Role",
        "Department",
        "Payable days",
        "Days in month",
        "Gross",
        "Advance given",
        "Advance recovery",
        "Deductions",
        "Deduction note",
        "Net pay",
        "Mode",
        "Paid on",
        "Status",
      ],
      ...entries.map((e) => [
        e.period,
        e.staffName,
        e.role || "—",
        e.department || "—",
        e.payableDays,
        e.daysInMonth,
        e.gross,
        e.advanceGiven,
        e.advanceRecovery,
        e.deductions,
        e.deductionNote || "",
        e.netPay,
        e.paymentMode || "",
        e.paidOn || "",
        e.status,
      ]),
      [
        "",
        "",
        "",
        "",
        "",
        "Total",
        totals.gross,
        totals.advanceGiven,
        totals.advanceRecovery,
        totals.deductions,
        "",
        totals.net,
        "",
        "",
        "",
      ],
    ]);
    toast.success("Payroll register exported");
  };

  const formNet = netPay({
    gross: Number(form.gross ?? 0),
    advanceGiven: Number(form.advanceGiven ?? 0),
    advanceRecovery: Number(form.advanceRecovery ?? 0),
    deductions: Number(form.deductions ?? 0),
  });

  const missingStaff = payableStaff.filter((s) => !entries.some((e) => e.staffId === s.id)).length;

  return (
    <AdminOnly
      page="Payroll"
      hint="Ask an Admin to run the month's payroll. Posted salary totals still show up under Reports."
    >
      <div className="space-y-5">
        <PageHeader
          title="Payroll"
          subtitle={`${periodLabel(period)} · ${entries.length} line${entries.length === 1 ? "" : "s"} · net ${money(totals.net)}`}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => setPrintRegister(true)}
                disabled={!entries.length}
              >
                <Printer className="h-4 w-4" /> Register
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={!entries.length}>
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => generate(true)}
                disabled={!payableStaff.length}
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
              <Button onClick={() => generate(false)} disabled={!payableStaff.length}>
                <CalendarPlus className="h-4 w-4" /> Run payroll
              </Button>
            </>
          }
        />

        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Payroll month" className="min-w-52">
              <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button
                variant="outline"
                title="Previous month"
                onClick={() => setPeriod(shiftPeriod(period, -1))}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                title="Next month"
                onClick={() => setPeriod(shiftPeriod(period, 1))}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <Field label="Find staff" className="min-w-52 flex-1">
              <Input
                placeholder="Name, role or department"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
            <Button
              onClick={() => {
                if (!entries.length) {
                  toast.error("Nothing to pay yet — run the payroll first");
                  return;
                }
                setBulk({ mode: entries[0]?.paymentMode || "Bank transfer", paidOn: todayISO() });
                setPayOpen(true);
              }}
              disabled={!totals.pendingCount}
            >
              <Banknote className="h-4 w-4" /> Mark month paid
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Gross salary" value={money(totals.gross)} />
            <Tile label="Advance given" value={money(totals.advanceGiven)} />
            <Tile label="Advance recovery" value={money(totals.advanceRecovery)} />
            <Tile label="Deductions" value={money(totals.deductions)} />
            <Tile label="Net payable" value={money(totals.net)} />
            <Tile
              label={`Paid · ${totals.paidCount}/${totals.count}`}
              value={money(totals.paidNet)}
              tone="green"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <span>
              {payableStaff.length} staff payable in {shortPeriodLabel(period)}
              {missingStaff ? ` · ${missingStaff} not on this run yet` : ""}
            </span>
            {posted ? (
              <span className="inline-flex items-center gap-1">
                <Receipt className="h-3.5 w-3.5" />
                Salary expense posted:{" "}
                <strong className="text-foreground">{money(posted.amount)}</strong>
                <Link to="/expenses" className="text-accent underline">
                  open Expenses
                </Link>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Receipt className="h-3.5 w-3.5" />
                Not posted to Expenses yet — mark the month paid (or use Post now) and it lands
                under Reports → monthly totals.
              </span>
            )}
            {totals.paidNet > 0 ? (
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  syncSalaryExpense(entries.filter((e) => e.status === "Paid"));
                  toast.success("Salary expense updated on the Expenses page");
                }}
              >
                Post now
              </Button>
            ) : null}
          </div>
        </Card>

        {!entries.length ? (
          <Card className="text-sm text-muted-foreground">
            {staffRows.length ? (
              <>
                No payroll lines for {periodLabel(period)} yet.{" "}
                <Button
                  className="ml-1"
                  onClick={() => generate(false)}
                  disabled={!payableStaff.length}
                >
                  <CalendarPlus className="h-4 w-4" /> Run payroll for {shortPeriodLabel(period)}
                </Button>
                <p className="mt-2 text-xs">
                  Gross pay is pro-rated from each person's joining and leave dates, then advances
                  and deductions are applied to reach the net pay.
                </p>
              </>
            ) : (
              <>
                Register your team first — payroll reads the salary, joining date and leave date
                from each staff record.{" "}
                <Button className="ml-1" onClick={() => navigate({ to: "/staff" })}>
                  <UsersRound className="h-4 w-4" /> Go to Staff Records
                </Button>
              </>
            )}
          </Card>
        ) : null}

        <DataTable
          columns={[
            "Staff",
            "Days",
            "Gross",
            "Advance given",
            "Advance recovery",
            "Deductions",
            "Net pay",
            "Status",
            "",
          ]}
          rowCount={rows.length}
          empty="No payroll lines match this search."
        >
          {rows.map((e) => (
            <tr key={e.id}>
              <Td className="font-medium">
                {e.staffName}
                <span className="block text-xs font-normal text-muted-foreground">
                  {[e.role, e.department].filter(Boolean).join(" · ") || "—"}
                </span>
              </Td>
              <Td>
                {e.payableDays}/{e.daysInMonth}
              </Td>
              <Td>{money(e.gross)}</Td>
              <Td className="text-emerald-700">
                {e.advanceGiven ? `+ ${money(e.advanceGiven)}` : "—"}
              </Td>
              <Td className="text-red-700">
                {e.advanceRecovery ? `− ${money(e.advanceRecovery)}` : "—"}
              </Td>
              <Td className="text-red-700">
                {e.deductions ? (
                  <>
                    − {money(e.deductions)}
                    {e.deductionNote ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {e.deductionNote}
                      </span>
                    ) : null}
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="font-semibold">
                {money(e.netPay)}
                {e.netPay < 0 ? (
                  <span className="block text-xs font-normal text-red-700">recovery due</span>
                ) : null}
                {e.paidOn ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {e.paymentMode} · {fmtDate(e.paidOn)}
                  </span>
                ) : null}
              </Td>
              <Td>
                <Select
                  className="h-8 w-28 py-0 text-xs"
                  value={e.status}
                  onChange={(ev) => setStatus(e, ev.target.value as PayrollStatus)}
                >
                  {PAYROLL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <span className="mt-1 block">
                  <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                </span>
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  title="Edit advances and deductions"
                  onClick={() => {
                    setForm(e);
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  title="Payslip"
                  onClick={() => setPayslip(e)}
                >
                  <FileText className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove from this run"
                  onClick={() => {
                    if (confirmDelete(`${e.staffName}'s line for ${periodLabel(e.period)}`)) {
                      remove("payrolls", e.id);
                      const paid = entries.filter((x) => x.id !== e.id && x.status === "Paid");
                      syncSalaryExpense(paid);
                      toast.success("Payroll line removed");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          ))}
        </DataTable>

        {/* Edit a payroll line */}
        <Modal
          open={editOpen}
          title={`Payroll · ${form.staffName ?? ""} · ${periodLabel(form.period ?? period)}`}
          onClose={() => setEditOpen(false)}
          wide
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payable days">
              <Input
                type="number"
                min={0}
                max={form.daysInMonth ?? 31}
                value={form.payableDays ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, payableDays: Number(e.target.value) }))}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Out of {form.daysInMonth ?? "—"} days — pro-rated from the join / leave dates on the
                staff record.
              </span>
            </Field>
            <Field label="Gross for the month (₹)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.gross ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, gross: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Advance given with this pay (₹)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.advanceGiven ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, advanceGiven: Number(e.target.value) }))}
              />
              <span className="mt-1 block text-xs text-muted-foreground">Added to the payout.</span>
            </Field>
            <Field label="Advance recovery (₹)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.advanceRecovery ?? 0}
                onChange={(e) =>
                  setForm((f) => ({ ...f, advanceRecovery: Number(e.target.value) }))
                }
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Deducted — recovery of an advance paid earlier.
              </span>
            </Field>
            <Field label="Other deductions (₹)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.deductions ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, deductions: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Deduction reason">
              <Input
                list="kegh-deduction-reasons"
                placeholder="PF, ESI, TDS, loan…"
                value={form.deductionNote ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, deductionNote: e.target.value }))}
              />
              <datalist id="kegh-deduction-reasons">
                {DEDUCTION_REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Payment mode">
              <Select
                value={form.paymentMode ?? "Bank transfer"}
                onChange={(e) => setForm((f) => ({ ...f, paymentMode: e.target.value }))}
              >
                {PAYROLL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status ?? "Draft"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as PayrollStatus }))
                }
              >
                {PAYROLL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid on">
              <Input
                type="date"
                value={form.paidOn ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, paidOn: e.target.value }))}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                className="min-h-16"
                placeholder="Arrears, bonus, half-day on 12th…"
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
            <div className="rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
              Net pay: <strong className="text-base">{money(formNet)}</strong>
              <span className="ml-2 text-xs text-muted-foreground">
                gross {money(form.gross ?? 0)} + advance {money(form.advanceGiven ?? 0)} − recovery{" "}
                {money(form.advanceRecovery ?? 0)} − deductions {money(form.deductions ?? 0)}
              </span>
              {formNet < 0 ? (
                <p className="mt-1 text-xs text-red-700">
                  Deductions are higher than the salary — the balance is recoverable from the next
                  month.
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEntry}>Save line</Button>
          </div>
        </Modal>

        {/* Mark the month paid */}
        <Modal
          open={payOpen}
          title={`Mark ${periodLabel(period)} paid`}
          onClose={() => setPayOpen(false)}
        >
          <p className="mb-4 text-sm text-muted-foreground">
            {totals.pendingCount} line{totals.pendingCount === 1 ? "" : "s"} totalling{" "}
            <strong className="text-foreground">{money(totals.pendingNet)}</strong> will be marked
            paid, and one Salary expense for {shortPeriodLabel(period)} is posted to the Expenses
            page — it feeds the monthly totals under Reports.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment date" required>
              <Input
                type="date"
                value={bulk.paidOn}
                onChange={(e) => setBulk((b) => ({ ...b, paidOn: e.target.value }))}
              />
            </Field>
            <Field label="Payment mode">
              <Select
                value={bulk.mode}
                onChange={(e) => setBulk((b) => ({ ...b, mode: e.target.value }))}
              >
                {PAYROLL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={markAllPaid}>
              <Banknote className="h-4 w-4" /> Mark paid & post expense
            </Button>
          </div>
        </Modal>

        {/* Payslip */}
        <PrintOverlay
          open={Boolean(payslip)}
          title={`Payslip — ${periodLabel(payslip?.period ?? period)}`}
          onClose={() => setPayslip(null)}
        >
          {payslip ? (
            <>
              <table className="mb-4">
                <tbody>
                  <tr>
                    <th>Employee</th>
                    <td>{payslip.staffName}</td>
                    <th>Role</th>
                    <td>{payslip.role || "—"}</td>
                  </tr>
                  <tr>
                    <th>Department</th>
                    <td>{payslip.department || "—"}</td>
                    <th>Pay period</th>
                    <td>{periodLabel(payslip.period)}</td>
                  </tr>
                  <tr>
                    <th>Payable days</th>
                    <td>
                      {payslip.payableDays} of {payslip.daysInMonth}
                    </td>
                    <th>Status</th>
                    <td>
                      {payslip.status}
                      {payslip.paidOn
                        ? ` · ${fmtDate(payslip.paidOn)} · ${payslip.paymentMode}`
                        : ""}
                    </td>
                  </tr>
                </tbody>
              </table>
              <table className="mb-4">
                <thead>
                  <tr>
                    <th>Earnings / deductions</th>
                    <th>Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Gross salary (pro-rated)</td>
                    <td>{money(payslip.gross)}</td>
                  </tr>
                  <tr>
                    <td>Advance given with this pay</td>
                    <td>{payslip.advanceGiven ? `+ ${money(payslip.advanceGiven)}` : "—"}</td>
                  </tr>
                  <tr>
                    <td>Advance recovery</td>
                    <td>{payslip.advanceRecovery ? `− ${money(payslip.advanceRecovery)}` : "—"}</td>
                  </tr>
                  <tr>
                    <td>Deductions{payslip.deductionNote ? ` (${payslip.deductionNote})` : ""}</td>
                    <td>{payslip.deductions ? `− ${money(payslip.deductions)}` : "—"}</td>
                  </tr>
                  <tr>
                    <th>Net pay</th>
                    <th>{money(payslip.netPay)}</th>
                  </tr>
                </tbody>
              </table>
              {payslip.notes ? <p className="mb-4">Notes: {payslip.notes}</p> : null}
              <table>
                <tbody>
                  <tr>
                    <td style={{ border: "none", height: "3.5rem" }}>Prepared by</td>
                    <td style={{ border: "none" }}>Authorised signatory</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : null}
        </PrintOverlay>

        {/* Payroll register */}
        <PrintOverlay
          open={printRegister}
          title={`Payroll Register — ${periodLabel(period)}`}
          onClose={() => setPrintRegister(false)}
        >
          <table className="mb-4">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Role / dept.</th>
                <th>Days</th>
                <th>Gross</th>
                <th>Advance</th>
                <th>Recovery</th>
                <th>Deductions</th>
                <th>Net pay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.staffName}</td>
                  <td>{[e.role, e.department].filter(Boolean).join(" · ") || "—"}</td>
                  <td>
                    {e.payableDays}/{e.daysInMonth}
                  </td>
                  <td>{money(e.gross)}</td>
                  <td>{money(e.advanceGiven)}</td>
                  <td>{money(e.advanceRecovery)}</td>
                  <td>{money(e.deductions)}</td>
                  <td>{money(e.netPay)}</td>
                  <td>{e.status}</td>
                </tr>
              ))}
              <tr>
                <th colSpan={3}>Total · {entries.length} staff</th>
                <th>{money(totals.gross)}</th>
                <th>{money(totals.advanceGiven)}</th>
                <th>{money(totals.advanceRecovery)}</th>
                <th>{money(totals.deductions)}</th>
                <th>{money(totals.net)}</th>
                <th>
                  {totals.paidCount} paid / {totals.pendingCount} pending
                </th>
              </tr>
            </tbody>
          </table>
          <p>
            Paid {money(totals.paidNet)} · pending {money(totals.pendingNet)}. Salary is posted to
            the Expenses page as a single “Salaries” entry for {periodLabel(period)}.
          </p>
        </PrintOverlay>
      </div>
    </AdminOnly>
  );
}
