import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type { Lab, LabFlag } from "@/lib/hms/types";
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, Td } from "@/components/hms/ui";
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";

export const Route = createFileRoute("/laboratory")({
  head: () => ({
    meta: [
      { title: "Laboratory — KEGH HMS" },
      { name: "description", content: "Enter and review laboratory results with normal ranges and flags." },
      { property: "og:title", content: "Laboratory — KEGH HMS" },
      { property: "og:description", content: "Enter and review laboratory results with normal ranges and flags." },
    ],
  }),
  component: LabPage,
});

const blank = (): Partial<Lab> => ({
  patientId: "", visitId: "", date: todayISO(), testName: "", result: "",
  unit: "", normalRange: "", flag: "normal", technician: "",
});

export function autoFlag(result: string, range: string): LabFlag | null {
  const value = parseFloat(result);
  const m = range.match(/(-?\d+(?:\.\d+)?)\s*[-–to]+\s*(-?\d+(?:\.\d+)?)/i);
  if (Number.isNaN(value) || !m) return null;
  const low = parseFloat(m[1]);
  const high = parseFloat(m[2]);
  if (value < low) return value < low * 0.5 ? "critical" : "low";
  if (value > high) return value > high * 1.5 ? "critical" : "high";
  return "normal";
}

const tone = (f: string) => (f === "normal" ? "green" : f === "critical" ? "red" : "amber");

function LabPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Lab>>(blank);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.labs)), [state.labs]);
  const set = (k: keyof Lab, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.patientId) return toast.error("Select a patient");
    if (!form.testName?.trim()) return toast.error("Test name is required");
    upsert<Lab>("labs", form as Lab);
    toast.success(form.id ? "Result updated" : "Result added");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Laboratory"
        subtitle={`${rows.length} result${rows.length === 1 ? "" : "s"}`}
        actions={<Button onClick={() => { setForm(blank()); setOpen(true); }}><Plus className="h-4 w-4" /> New result</Button>}
      />

      <DataTable columns={["Date", "Patient", "Test", "Result", "Normal range", "Flag", "Technician", ""]} rowCount={rows.length}>
        {rows.map((l) => (
          <tr key={l.id}>
            <Td>{fmtDate(l.date)}</Td>
            <Td>{state.patients[l.patientId]?.name ?? "—"}</Td>
            <Td>{l.testName}</Td>
            <Td>{l.result} {l.unit}</Td>
            <Td>{l.normalRange || "—"}</Td>
            <Td><Badge tone={tone(l.flag) as never}>{l.flag}</Badge></Td>
            <Td>{l.technician || "—"}</Td>
            <Td className="whitespace-nowrap">
              <button className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => { setForm(l); setOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </button>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => {
                if (confirmDelete("this lab result")) { remove("labs", l.id); toast.success("Result deleted"); }
              }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </DataTable>

      <Modal open={open} title={form.id ? "Edit lab result" : "New lab result"} onClose={() => setOpen(false)} wide>
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
          <Field label="Test name" required>
            <Input value={form.testName ?? ""} onChange={(e) => set("testName", e.target.value)} />
          </Field>
          <Field label="Result">
            <Input
              value={form.result ?? ""}
              onChange={(e) => {
                const result = e.target.value;
                const auto = autoFlag(result, form.normalRange ?? "");
                setForm((f) => ({ ...f, result, flag: auto ?? f.flag }));
              }}
            />
          </Field>
          <Field label="Unit">
            <Input value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value)} />
          </Field>
          <Field label="Normal range (e.g. 12-16)">
            <Input
              value={form.normalRange ?? ""}
              onChange={(e) => {
                const normalRange = e.target.value;
                const auto = autoFlag(form.result ?? "", normalRange);
                setForm((f) => ({ ...f, normalRange, flag: auto ?? f.flag }));
              }}
            />
          </Field>
          <Field label="Flag">
            <Select value={form.flag ?? "normal"} onChange={(e) => set("flag", e.target.value)}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
          <Field label="Technician">
            <Input value={form.technician ?? ""} onChange={(e) => set("technician", e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save result</Button>
        </div>
      </Modal>
    </div>
  );
}
