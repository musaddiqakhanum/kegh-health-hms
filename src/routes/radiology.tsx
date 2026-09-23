import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type { Rad } from "@/lib/hms/types";
import { Button, DataTable, Field, Input, Modal, PageHeader, Td, Textarea } from "@/components/hms/ui";
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";

export const Route = createFileRoute("/radiology")({
  head: () => ({
    meta: [
      { title: "Radiology — KEGH HMS" },
      { name: "description", content: "Record imaging studies, findings and impressions." },
      { property: "og:title", content: "Radiology — KEGH HMS" },
      { property: "og:description", content: "Record imaging studies, findings and impressions." },
    ],
  }),
  component: RadPage,
});

const blank = (): Partial<Rad> => ({
  patientId: "", visitId: "", date: todayISO(), studyType: "", findings: "", impression: "", radiologist: "",
});

function RadPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Rad>>(blank);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.rads)), [state.rads]);
  const set = (k: keyof Rad, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.patientId) { toast.error("Select a patient"); return; }
    if (!form.studyType?.trim()) { toast.error("Study type is required"); return; }
    upsert<Rad>("rads", form as Rad);
    toast.success(form.id ? "Study updated" : "Study added");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Radiology"
        subtitle={`${rows.length} stud${rows.length === 1 ? "y" : "ies"}`}
        actions={<Button onClick={() => { setForm(blank()); setOpen(true); }}><Plus className="h-4 w-4" /> New study</Button>}
      />

      <DataTable columns={["Date", "Patient", "Study type", "Impression", "Radiologist", ""]} rowCount={rows.length}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{fmtDate(r.date)}</Td>
            <Td>{state.patients[r.patientId]?.name ?? "—"}</Td>
            <Td>{r.studyType}</Td>
            <Td>{r.impression || "—"}</Td>
            <Td>{r.radiologist || "—"}</Td>
            <Td className="whitespace-nowrap">
              <button className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => { setForm(r); setOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </button>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => {
                if (confirmDelete("this study")) { remove("rads", r.id); toast.success("Study deleted"); }
              }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal open={open} title={form.id ? "Edit study" : "New study"} onClose={() => setOpen(false)} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker value={form.patientId ?? ""} onChange={(id) => setForm((f) => ({ ...f, patientId: id, visitId: "" }))} />
          </Field>
          <Field label="Linked visit">
            <VisitPicker patientId={form.patientId ?? ""} value={form.visitId ?? ""} onChange={(id) => set("visitId", id)} />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date ?? ""} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Study type" required>
            <Input placeholder="X-Ray Chest PA, USG Abdomen…" value={form.studyType ?? ""} onChange={(e) => set("studyType", e.target.value)} />
          </Field>
          <Field label="Radiologist">
            <Input value={form.radiologist ?? ""} onChange={(e) => set("radiologist", e.target.value)} />
          </Field>
          <Field label="Findings" className="sm:col-span-2">
            <Textarea value={form.findings ?? ""} onChange={(e) => set("findings", e.target.value)} />
          </Field>
          <Field label="Impression" className="sm:col-span-2">
            <Textarea value={form.impression ?? ""} onChange={(e) => set("impression", e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save study</Button>
        </div>
      </Modal>
    </div>
  );
}
