import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import { EXPENSE_CATEGORIES, type Expense } from "@/lib/hms/types";
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

export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — KEGH HMS" },
      {
        name: "description",
        content: "Track hospital expenses — date, category, amount, notes and who paid.",
      },
      { property: "og:title", content: "Expenses — KEGH HMS" },
      {
        property: "og:description",
        content: "Track hospital expenses by category with monthly totals.",
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

function ExpensesPage() {
  const { state, settings, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Expense>>(blank);

  const rows = useMemo(
    () => sortByDateDesc(Object.values(state.expenses ?? {})) as Expense[],
    [state.expenses],
  );

  const monthTotal = useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return rows
      .filter((e) => (e.date || "").slice(0, 7) === key)
      .reduce((s, e) => s + Number(e.amount || 0), 0);
  }, [rows]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) {
      const c = e.category || "Miscellaneous";
      map.set(c, (map.get(c) ?? 0) + Number(e.amount || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const allTotal = useMemo(() => rows.reduce((s, e) => s + Number(e.amount || 0), 0), [rows]);

  if (settings.role !== "Admin") {
    return (
      <div>
        <PageHeader title="Expenses" subtitle="Restricted — Admin only" />
        <Card className="my-4">
          <p className="text-sm text-muted-foreground">
            Expense entry is available to the Admin portal. Monthly expense totals are visible under
            Reports for other roles.
          </p>
        </Card>
      </div>
    );
  }

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

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"} · this month ${money(monthTotal)}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New expense
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">This month</p>
          <p className="text-base font-semibold">{money(monthTotal)}</p>
        </div>
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">All time</p>
          <p className="text-base font-semibold">{money(allTotal)}</p>
        </div>
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">Entries</p>
          <p className="text-base font-semibold">{rows.length}</p>
        </div>
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">Categories</p>
          <p className="text-base font-semibold">{byCategory.length}</p>
        </div>
      </div>

      <DataTable
        columns={["Date", "Category", "Notes", "Paid by", "Amount", ""]}
        rowCount={rows.length}
      >
        {rows.map((e) => (
          <tr key={e.id}>
            <Td>{fmtDate(e.date)}</Td>
            <Td>
              <Badge tone="neutral">{e.category}</Badge>
            </Td>
            <Td>{e.notes || "—"}</Td>
            <Td>{e.paidBy || "—"}</Td>
            <Td className="font-medium">{money(e.amount)}</Td>
            <Td className="whitespace-nowrap">
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(e);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="text-muted-foreground hover:text-destructive"
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
                <option key={c}>{c}</option>
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
  );
}
