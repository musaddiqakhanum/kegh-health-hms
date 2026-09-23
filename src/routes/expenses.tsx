import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Banknote, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import { monthOf, periodLabel } from "@/lib/hms/payroll";
import { EXPENSE_CATEGORIES, type Expense } from "@/lib/hms/types";
import { downloadCsv } from "@/lib/hms/csv";
import {
  Badge,
  Button,
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
import { AdminOnly } from "@/components/hms/gate";

export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — KEGH HMS" },
      {
        name: "description",
        content: "Track hospital expenses — salaries, rent, supplies, equipment and more.",
      },
      { property: "og:title", content: "Expenses — KEGH HMS" },
      {
        property: "og:description",
        content: "Hospital running costs by category with monthly totals, fed by the payroll run.",
      },
    ],
  }),
  component: ExpensesPage,
});

const blank = (): Partial<Expense> => ({
  date: todayISO(),
  category: "Salaries",
  amount: 0,
  notes: "",
  paidBy: "",
});

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function ExpensesPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Expense>>(blank);

  const rows = useMemo(
    () => sortByDateDesc(Object.values(state.expenses ?? {})) as Expense[],
    [state.expenses],
  );

  const thisMonth = todayISO().slice(0, 7);
  const monthTotal = useMemo(
    () =>
      rows
        .filter((e) => monthOf(e.date) === thisMonth)
        .reduce((s, e) => s + Number(e.amount || 0), 0),
    [rows, thisMonth],
  );
  const salaryTotal = useMemo(
    () =>
      rows
        .filter((e) => e.category === "Salaries" && monthOf(e.date) === thisMonth)
        .reduce((s, e) => s + Number(e.amount || 0), 0),
    [rows, thisMonth],
  );
  const allTotal = useMemo(() => rows.reduce((s, e) => s + Number(e.amount || 0), 0), [rows]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) {
      const c = e.category || "Miscellaneous";
      map.set(c, (map.get(c) ?? 0) + Number(e.amount || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const payrollEntries = rows.filter((e) => e.source === "payroll").length;

  const save = () => {
    if (!form.date) {
      toast.error("Date is required");
      return;
    }
    if (Number(form.amount || 0) <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    upsert<Expense>("expenses", {
      ...form,
      category: form.category || "Miscellaneous",
      amount: Number(form.amount || 0),
      notes: form.notes?.trim() ?? "",
      paidBy: form.paidBy?.trim() ?? "",
    } as Expense);
    toast.success(form.id ? "Expense updated" : "Expense added");
    setOpen(false);
  };

  const exportCsv = () => {
    downloadCsv("kegh-expenses.csv", [
      ["Date", "Category", "Notes", "Paid by", "Amount", "Source"],
      ...rows.map((e) => [
        e.date,
        e.category,
        e.notes || "",
        e.paidBy || "",
        Number(e.amount || 0),
        e.source === "payroll" ? `Payroll ${e.payrollPeriod ?? ""}`.trim() : "Manual",
      ]),
    ]);
    toast.success("Expenses exported");
  };

  return (
    <AdminOnly
      page="Expenses"
      hint="Monthly expense totals are visible to every role under Reports."
    >
      <div>
        <PageHeader
          title="Expenses"
          subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"} · this month ${money(monthTotal)}`}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Link to="/payroll">
                <Button variant="outline">
                  <Banknote className="h-4 w-4" /> Payroll
                </Button>
              </Link>
              <Button
                onClick={() => {
                  setForm(blank());
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> New expense
              </Button>
            </>
          }
        />

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="This month" value={money(monthTotal)} />
          <Tile label="Salaries this month" value={money(salaryTotal)} />
          <Tile label="All time" value={money(allTotal)} />
          <Tile label="From payroll runs" value={payrollEntries} />
        </div>

        <DataTable
          columns={["Date", "Category", "Notes", "Paid by", "Amount", ""]}
          rowCount={rows.length}
          empty="No expenses recorded yet."
        >
          {rows.map((e) => (
            <tr key={e.id}>
              <Td>{fmtDate(e.date)}</Td>
              <Td>
                <Badge tone={e.category === "Salaries" ? "amber" : "neutral"}>{e.category}</Badge>
                {e.source === "payroll" && e.payrollPeriod ? (
                  <Link
                    to="/payroll"
                    className="mt-1 block text-xs text-accent underline"
                    title="Open the payroll run that posted this"
                  >
                    Payroll {periodLabel(e.payrollPeriod)}
                  </Link>
                ) : null}
              </Td>
              <Td>{e.notes || "—"}</Td>
              <Td>{e.paidBy || "—"}</Td>
              <Td className="font-medium">{money(e.amount)}</Td>
              <Td className="whitespace-nowrap">
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  title="Edit"
                  onClick={() => {
                    setForm(e);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete"
                  onClick={() => {
                    if (confirmDelete("this expense")) {
                      remove("expenses", e.id);
                      toast.success("Expense deleted");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          ))}
        </DataTable>

        {byCategory.length > 0 ? (
          <div className="mt-6 max-w-xl">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              All-time by category
            </h2>
            <ul className="space-y-2">
              {byCategory.map(([cat, total]) => (
                <li
                  key={cat}
                  className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm"
                >
                  <span>{cat}</span>
                  <span className="font-medium">{money(total)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Modal
          open={open}
          title={form.id ? "Edit expense" : "New expense"}
          onClose={() => setOpen(false)}
        >
          {form.source === "payroll" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Posted by the payroll run for {periodLabel(form.payrollPeriod ?? "")}. Editing it here
              is fine, but re-posting that month from Payroll will overwrite the amount.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              <Input
                type="date"
                value={form.date ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>
            <Field label="Category">
              <Select
                value={form.category ?? "Salaries"}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (₹)" required>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.amount ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Paid by">
              <Input
                value={form.paidBy ?? ""}
                placeholder="Cash, bank, person…"
                onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))}
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="What was this for?"
              />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save expense</Button>
          </div>
        </Modal>
      </div>
    </AdminOnly>
  );
}
