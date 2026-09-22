import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import {
  lowStockMedications,
  medicationInventory,
  pharmStock,
  sortByDateDesc,
} from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import type { Pharm } from "@/lib/hms/types";
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

export const Route = createFileRoute("/pharmacy")({
  head: () => ({
    meta: [
      { title: "Pharmacy — KEGH HMS" },
      {
        name: "description",
        content: "Dispense medicines with dosage, quantity, stock levels and low-stock alerts.",
      },
      { property: "og:title", content: "Pharmacy — KEGH HMS" },
      {
        property: "og:description",
        content: "Dispense medicines with dosage, quantity, stock levels and low-stock alerts.",
      },
    ],
  }),
  component: PharmPage,
});

const blank = (): Partial<Pharm> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  medication: "",
  dosage: "",
  frequency: "",
  duration: "",
  qty: 1,
  rate: 0,
  supplier: "",
});

function PharmPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Pharm>>(blank);
  const [lowOnly, setLowOnly] = useState(false);
  const [restock, setRestock] = useState<Pharm | null>(null);
  const [addQty, setAddQty] = useState(0);
  const [restockMin, setRestockMin] = useState<number | undefined>(undefined);
  const [restockSupplier, setRestockSupplier] = useState("");

  const inventory = useMemo(() => medicationInventory(Object.values(state.pharms)), [state.pharms]);
  const lowMeds = useMemo(() => lowStockMedications(Object.values(state.pharms)), [state.pharms]);

  const rows = useMemo(() => {
    let list = sortByDateDesc(Object.values(state.pharms));
    if (lowOnly) list = list.filter((p) => pharmStock(p).low);
    return list;
  }, [state.pharms, lowOnly]);

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.medication?.trim()) {
      toast.error("Medication name is required");
      return;
    }
    upsert<Pharm>("pharms", {
      ...form,
      qty: Number(form.qty || 0),
      rate: Number(form.rate || 0),
    } as Pharm);
    toast.success(form.id ? "Entry updated" : "Entry added");
    setOpen(false);
  };

  const onMedicationChange = (name: string) => {
    setForm((f) => {
      const next = { ...f, medication: name };
      const untouched = f.stockQty === undefined && f.minStock === undefined && !f.supplier?.trim();
      if (!f.id && untouched && name.trim()) {
        const match = inventory.find(
          (m) => m.hasData && m.medication.toLowerCase() === name.trim().toLowerCase(),
        );
        if (match) {
          next.stockQty = match.stockQty;
          next.minStock = match.minStock;
          next.supplier = match.supplier;
        }
      }
      return next;
    });
  };

  const openRestock = (p: Pharm) => {
    const s = pharmStock(p);
    setRestock(p);
    setAddQty(0);
    setRestockMin(s.known ? s.minStock : undefined);
    setRestockSupplier(s.supplier);
  };

  const saveRestock = () => {
    if (!restock) return;
    const add = Number(addQty || 0);
    if (add <= 0) {
      toast.error("Enter a quantity greater than zero");
      return;
    }
    const current = Number(restock.stockQty ?? 0);
    upsert<Pharm>("pharms", {
      ...restock,
      stockQty: current + add,
      minStock: restockMin ?? restock.minStock,
      supplier: restockSupplier.trim() || restock.supplier,
    });
    toast.success(`Restocked ${restock.medication}: ${current} → ${current + add}`);
    setRestock(null);
  };

  const amount = Number(form.qty || 0) * Number(form.rate || 0);

  return (
    <div>
      <PageHeader
        title="Pharmacy"
        subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}${lowMeds.length ? ` · ${lowMeds.length} low-stock` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {lowMeds.length > 0 ? <Badge tone="red">{lowMeds.length} low-stock</Badge> : null}
            <Button
              onClick={() => {
                setForm(blank());
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New entry
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Stock filter">
          <Select
            value={lowOnly ? "low" : "all"}
            onChange={(e) => setLowOnly(e.target.value === "low")}
          >
            <option value="all">All entries</option>
            <option value="low">Low stock only</option>
          </Select>
        </Field>
      </div>

      <DataTable
        columns={["Date", "Patient", "Medication", "Dosage", "Qty", "Rate", "Amount", "Stock", ""]}
        rowCount={rows.length}
        {...(lowOnly ? { empty: "No low-stock entries." } : {})}
      >
        {rows.map((p) => {
          const s = pharmStock(p);
          return (
            <tr key={p.id}>
              <Td>{fmtDate(p.date)}</Td>
              <Td>{state.patients[p.patientId]?.name ?? "—"}</Td>
              <Td>
                {p.medication}
                {s.supplier ? (
                  <span className="block text-xs text-muted-foreground">{s.supplier}</span>
                ) : null}
              </Td>
              <Td>{[p.dosage, p.frequency, p.duration].filter(Boolean).join(" · ") || "—"}</Td>
              <Td>{p.qty}</Td>
              <Td>{money(p.rate)}</Td>
              <Td className="font-medium">{money(p.qty * p.rate)}</Td>
              <Td>
                {!s.known ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="flex flex-col items-start gap-1">
                    <Badge tone={s.low ? "red" : "green"}>
                      {s.low ? "Low" : "OK"} · {s.stockQty}
                    </Badge>
                    <span className="text-xs text-muted-foreground">min {s.minStock}</span>
                  </span>
                )}
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  title="Restock"
                  onClick={() => openRestock(p)}
                >
                  <PackagePlus className="h-4 w-4" />
                </button>
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setForm(p);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirmDelete("this entry")) {
                      remove("pharms", p.id);
                      toast.success("Entry deleted");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          );
        })}
      </DataTable>

      <Modal
        open={open}
        title={form.id ? "Edit pharmacy entry" : "New pharmacy entry"}
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
          <Field label="Medication" required>
            <Input
              value={form.medication ?? ""}
              onChange={(e) => onMedicationChange(e.target.value)}
              placeholder="Paracetamol"
              list="kegh-medications"
            />
            <datalist id="kegh-medications">
              {inventory.map((m) => (
                <option key={m.medication} value={m.medication} />
              ))}
            </datalist>
          </Field>
          <Field label="Dosage">
            <Input
              placeholder="500 mg"
              value={form.dosage ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, dosage: e.target.value }))}
            />
          </Field>
          <Field label="Frequency">
            <Input
              placeholder="1-0-1"
              value={form.frequency ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
            />
          </Field>
          <Field label="Duration">
            <Input
              placeholder="5 days"
              value={form.duration ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
            />
          </Field>
          <Field label="Quantity">
            <Input
              type="number"
              min={0}
              value={form.qty ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Rate per unit (₹)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.rate ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) }))}
            />
          </Field>
          <div className="sm:col-span-2 rounded-md bg-muted px-3 py-2 text-sm">
            Amount: <strong>{money(amount)}</strong>
          </div>
          <Field label="Current stock (units)">
            <Input
              type="number"
              min={0}
              value={form.stockQty ?? ""}
              placeholder="e.g. 120"
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  stockQty: e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          </Field>
          <Field label="Reorder level (units)">
            <Input
              type="number"
              min={0}
              value={form.minStock ?? ""}
              placeholder="e.g. 20"
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  minStock: e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          </Field>
          <Field label="Supplier" className="sm:col-span-2">
            <Input
              value={form.supplier ?? ""}
              placeholder="Distributor name for reorders"
              onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save entry</Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(restock)}
        title={restock ? `Restock — ${restock.medication}` : "Restock"}
        onClose={() => setRestock(null)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
            Current stock: <strong>{Number(restock?.stockQty ?? 0)} units</strong>
            {restock?.supplier ? ` · Supplier: ${restock.supplier}` : ""}
          </div>
          <Field label="Add quantity" required>
            <Input
              type="number"
              min={0}
              value={addQty}
              onChange={(e) => setAddQty(Number(e.target.value))}
            />
          </Field>
          <Field label="Reorder level (units)">
            <Input
              type="number"
              min={0}
              value={restockMin ?? ""}
              onChange={(e) =>
                setRestockMin(e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          </Field>
          <Field label="Supplier" className="sm:col-span-2">
            <Input
              value={restockSupplier}
              placeholder="Distributor name for reorders"
              onChange={(e) => setRestockSupplier(e.target.value)}
            />
          </Field>
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm sm:col-span-2">
            New stock after restock:{" "}
            <strong>{Number(restock?.stockQty ?? 0) + Number(addQty || 0)} units</strong>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRestock(null)}>
            Cancel
          </Button>
          <Button onClick={saveRestock}>
            <PackagePlus className="h-4 w-4" /> Restock
          </Button>
        </div>
      </Modal>
    </div>
  );
}
