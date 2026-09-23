import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import type { Pharm } from "@/lib/hms/types";
import { Button, DataTable, Field, Input, Modal, PageHeader, Td } from "@/components/hms/ui";
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";

export const Route = createFileRoute("/pharmacy")({
  head: () => ({
    meta: [
      { title: "Pharmacy — KEGH HMS" },
      { name: "description", content: "Dispense medicines with dosage, quantity and automatic amounts." },
      { property: "og:title", content: "Pharmacy — KEGH HMS" },
      { property: "og:description", content: "Dispense medicines with dosage, quantity and automatic amounts." },
    ],
  }),
  component: PharmPage,
});

const blank = (): Partial<Pharm> => ({
  patientId: "", visitId: "", date: todayISO(), medication: "", dosage: "",
  frequency: "", duration: "", qty: 1, rate: 0,
});

function PharmPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Pharm>>(blank);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.pharms)), [state.pharms]);

  const save = () => {
    if (!form.patientId) { toast.error("Select a patient"); return; }
    if (!form.medication?.trim()) { toast.error("Medication name is required"); return; }
    upsert<Pharm>("pharms", { ...form, qty: Number(form.qty || 0), rate: Number(form.rate || 0) } as Pharm);
    toast.success(form.id ? "Entry updated" : "Entry added");
    setOpen(false);
  };

  const amount = Number(form.qty || 0) * Number(form.rate || 0);

  return (
    <div>
      <PageHeader
        title="Pharmacy"
        subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
        actions={<Button onClick={() => { setForm(blank()); setOpen(true); }}><Plus className="h-4 w-4" /> New entry</Button>}
      />

      <DataTable columns={["Date", "Patient", "Medication", "Dosage", "Qty", "Rate", "Amount", ""]} rowCount={rows.length}>
        {rows.map((p) => (
          <tr key={p.id}>
            <Td>{fmtDate(p.date)}</Td>
            <Td>{state.patients[p.patientId]?.name ?? "—"}</Td>
            <Td>{p.medication}</Td>
            <Td>{[p.dosage, p.frequency, p.duration].filter(Boolean).join(" · ") || "—"}</Td>
            <Td>{p.qty}</Td>
            <Td>{money(p.rate)}</Td>
            <Td className="font-medium">{money(p.qty * p.rate)}</Td>
            <Td className="whitespace-nowrap">
              <button className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => { setForm(p); setOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </button>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => {
                if (confirmDelete("this entry")) { remove("pharms", p.id); toast.success("Entry deleted"); }
              }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal open={open} title={form.id ? "Edit pharmacy entry" : "New pharmacy entry"} onClose={() => setOpen(false)} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker value={form.patientId ?? ""} onChange={(id) => setForm((f) => ({ ...f, patientId: id, visitId: "" }))} />
          </Field>
          <Field label="Linked visit">
            <VisitPicker patientId={form.patientId ?? ""} value={form.visitId ?? ""} onChange={(id) => setForm((f) => ({ ...f, visitId: id }))} />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date ?? ""} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field label="Medication" required>
            <Input value={form.medication ?? ""} onChange={(e) => setForm((f) => ({ ...f, medication: e.target.value }))} />
          </Field>
          <Field label="Dosage">
            <Input placeholder="500 mg" value={form.dosage ?? ""} onChange={(e) => setForm((f) => ({ ...f, dosage: e.target.value }))} />
          </Field>
          <Field label="Frequency">
            <Input placeholder="1-0-1" value={form.frequency ?? ""} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} />
          </Field>
          <Field label="Duration">
            <Input placeholder="5 days" value={form.duration ?? ""} onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))} />
          </Field>
          <Field label="Quantity">
            <Input type="number" min={0} value={form.qty ?? 0} onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))} />
          </Field>
          <Field label="Rate per unit (₹)">
            <Input type="number" min={0} step="0.01" value={form.rate ?? 0} onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) }))} />
          </Field>
          <div className="sm:col-span-2 rounded-md bg-muted px-3 py-2 text-sm">
            Amount: <strong>{money(amount)}</strong>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save entry</Button>
        </div>
      </Modal>
    </div>
  );
}
