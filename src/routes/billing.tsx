import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import type { Bill, BillItem } from "@/lib/hms/types";
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
} from "@/components/hms/ui";
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";

export const Route = createFileRoute("/billing")({
  head: () => ({
    meta: [
      { title: "Billing — KEGH HMS" },
      {
        name: "description",
        content: "Raise bills with line items, payments and outstanding dues.",
      },
      { property: "og:title", content: "Billing — KEGH HMS" },
      {
        property: "og:description",
        content: "Raise bills with line items, payments and outstanding dues.",
      },
    ],
  }),
  component: BillingPage,
});

const blankItem = (): BillItem => ({ description: "", qty: 1, rate: 0, amount: 0 });
const blank = (): Partial<Bill> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  items: [blankItem()],
  totalAmount: 0,
  discount: 0,
  tax: 0,
  paid: 0,
  due: 0,
  paymentMode: "Cash",
});

function BillingPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Bill>>(blank);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.bills)), [state.bills]);

  const items = form.items ?? [];
  const subtotal = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0), 0);
  const discount = Math.max(0, Number(form.discount || 0));
  const tax = Math.max(0, Number(form.tax || 0));
  const grandTotal = Math.max(0, subtotal - discount) + tax;
  const due = grandTotal - Number(form.paid || 0);

  const setItem = (idx: number, patch: Partial<BillItem>) =>
    setForm((f) => {
      const next = [...(f.items ?? [])];
      const merged: BillItem = { ...blankItem(), ...next[idx], ...patch };
      merged.amount = Number(merged.qty || 0) * Number(merged.rate || 0);
      next[idx] = merged;
      return { ...f, items: next };
    });

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    const cleaned = items.filter((i) => i.description.trim());
    if (cleaned.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    upsert<Bill>("bills", {
      ...form,
      items: cleaned,
      totalAmount: grandTotal,
      discount,
      tax,
      paid: Number(form.paid || 0),
      due,
    } as Bill);
    toast.success(form.id ? "Bill updated" : "Bill created");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle={`${rows.length} bill${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New bill
          </Button>
        }
      />

      <DataTable
        columns={[
          "Date",
          "Patient",
          "Items",
          "Subtotal",
          "Disc.",
          "Tax",
          "Total",
          "Paid",
          "Due",
          "Mode",
          "",
        ]}
        rowCount={rows.length}
      >
        {rows.map((b) => (
          <tr key={b.id}>
            <Td>{fmtDate(b.date)}</Td>
            <Td>{state.patients[b.patientId]?.name ?? "—"}</Td>
            <Td>{b.items?.length ?? 0}</Td>
            <Td>
              {money(
                (b.items ?? []).reduce((s, i) => s + Number(i.qty || 0) * Number(i.rate || 0), 0),
              )}
            </Td>
            <Td>{money(b.discount)}</Td>
            <Td>{money(b.tax)}</Td>
            <Td className="font-medium">{money(b.totalAmount)}</Td>
            <Td>{money(b.paid)}</Td>
            <Td>
              <Badge tone={Number(b.due) <= 0 ? "green" : Number(b.paid) > 0 ? "amber" : "red"}>
                {money(b.due)}
              </Badge>
            </Td>
            <Td>{b.paymentMode}</Td>
            <Td className="whitespace-nowrap">
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(b);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirmDelete("this bill")) {
                    remove("bills", b.id);
                    toast.success("Bill deleted");
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal
        open={open}
        title={form.id ? "Edit bill" : "New bill"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker
              value={form.patientId ?? ""}
              onChange={(id) => setForm((f) => ({ ...f, patientId: id, visitId: "" }))}
            />
          </Field>
          <Field label="Linked visit">
            <VisitPicker
              patientId={form.patientId ?? ""}
              value={form.visitId ?? ""}
              onChange={(id) => setForm((f) => ({ ...f, visitId: id }))}
            />
          </Field>
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Line items</p>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-5"
                  placeholder="Description"
                  value={item.description}
                  onChange={(e) => setItem(idx, { description: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  value={item.qty}
                  onChange={(e) => setItem(idx, { qty: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  step="0.01"
                  value={item.rate}
                  onChange={(e) => setItem(idx, { rate: Number(e.target.value) })}
                />
                <span className="col-span-2 text-right text-sm font-medium">
                  {money(Number(item.qty || 0) * Number(item.rate || 0))}
                </span>
                <button
                  className="col-span-1 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    setForm((f) => ({ ...f, items: (f.items ?? []).filter((_, i) => i !== idx) }))
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => setForm((f) => ({ ...f, items: [...(f.items ?? []), blankItem()] }))}
          >
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Discount (₹)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.discount ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, discount: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Tax (₹)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.tax ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, tax: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Paid amount (₹)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.paid ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, paid: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Payment mode">
            <Select
              value={form.paymentMode ?? "Cash"}
              onChange={(e) => setForm((f) => ({ ...f, paymentMode: e.target.value }))}
            >
              <option>Cash</option>
              <option>UPI</option>
              <option>Card</option>
              <option>Insurance</option>
            </Select>
          </Field>
          <div className="rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
            <p>
              Subtotal: <strong>{money(subtotal)}</strong>
              {" · "}Discount: <strong>−{money(discount)}</strong>
              {" · "}Tax: <strong>+{money(tax)}</strong>
            </p>
            <p className="mt-1">
              Grand total: <strong>{money(grandTotal)}</strong>
              {" · "}Due: <strong>{money(due)}</strong>
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save bill</Button>
        </div>
      </Modal>
    </div>
  );
}
