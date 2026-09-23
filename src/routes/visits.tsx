import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type { Visit } from "@/lib/hms/types";
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, Td, Textarea } from "@/components/hms/ui";
import { PatientPicker, confirmDelete } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";

export const Route = createFileRoute("/visits")({
  head: () => ({
    meta: [
      { title: "Visits (OPD/IPD) — KEGH HMS" },
      { name: "description", content: "Record OPD, IPD and emergency visits with diagnosis and doctor notes." },
      { property: "og:title", content: "Visits (OPD/IPD) — KEGH HMS" },
      { property: "og:description", content: "Record OPD, IPD and emergency visits with diagnosis and notes." },
    ],
  }),
  component: VisitsPage,
});

const blank = (): Partial<Visit> => ({
  patientId: "",
  date: todayISO(),
  type: "OPD",
  doctor: "",
  department: "",
  diagnosis: "",
  notes: "",
  admissionDate: "",
  dischargeDate: "",
});

function VisitsPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Visit>>(blank);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.visits)), [state.visits]);
  const set = (k: keyof Visit, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.patientId) { toast.error("Select a patient"); return; }
    if (!form.date) { toast.error("Visit date is required"); return; }
    upsert<Visit>("visits", form as Visit);
    toast.success(form.id ? "Visit updated" : "Visit added");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Visits (OPD/IPD)"
        subtitle={`${rows.length} visit${rows.length === 1 ? "" : "s"}`}
        actions={<Button onClick={() => { setForm(blank()); setOpen(true); }}><Plus className="h-4 w-4" /> New visit</Button>}
      />

      <DataTable columns={["Date", "Patient", "Type", "Doctor", "Department", "Diagnosis", ""]} rowCount={rows.length}>
        {rows.map((v) => (
          <tr key={v.id}>
            <Td>{fmtDate(v.date)}</Td>
            <Td>{state.patients[v.patientId]?.name ?? "—"}</Td>
            <Td><Badge tone={v.type === "Emergency" ? "red" : v.type === "IPD" ? "amber" : "green"}>{v.type}</Badge></Td>
            <Td>{v.doctor || "—"}</Td>
            <Td>{v.department || "—"}</Td>
            <Td>{v.diagnosis || "—"}</Td>
            <Td className="whitespace-nowrap">
              <button className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => { setForm(v); setOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </button>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => {
                if (confirmDelete("this visit")) { remove("visits", v.id); toast.success("Visit deleted"); }
              }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal open={open} title={form.id ? "Edit visit" : "New visit"} onClose={() => setOpen(false)} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker
              value={form.patientId ?? ""}
              onChange={(id) =>
                setForm((f) => ({
                  ...f,
                  patientId: id,
                  doctor: f.doctor || state.patients[id]?.doctor || "",
                }))
              }
            />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date ?? ""} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Type">
            <Select value={form.type ?? "OPD"} onChange={(e) => set("type", e.target.value)}>
              <option>OPD</option><option>IPD</option><option>Emergency</option>
            </Select>
          </Field>
          <Field label="Doctor">
            <DoctorSelect value={form.doctor ?? ""} onChange={(d) => set("doctor", d)} />
          </Field>
          <Field label="Department">
            <Input value={form.department ?? ""} onChange={(e) => set("department", e.target.value)} />
          </Field>
          {form.type === "IPD" ? (
            <>
              <Field label="Admission date">
                <Input type="date" value={form.admissionDate ?? ""} onChange={(e) => set("admissionDate", e.target.value)} />
              </Field>
              <Field label="Discharge date">
                <Input type="date" value={form.dischargeDate ?? ""} onChange={(e) => set("dischargeDate", e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field label="Diagnosis" className="sm:col-span-2">
            <Input value={form.diagnosis ?? ""} onChange={(e) => set("diagnosis", e.target.value)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save visit</Button>
        </div>
      </Modal>
    </div>
  );
}
