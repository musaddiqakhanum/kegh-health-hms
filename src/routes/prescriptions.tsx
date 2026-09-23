import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import type { Prescription, PrescriptionItem } from "@/lib/hms/types";
import {
  Badge,
  Button,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  Td,
  Textarea,
} from "@/components/hms/ui";
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";
import { PrescriptionPrint } from "@/components/hms/record";

export const Route = createFileRoute("/prescriptions")({
  head: () => ({
    meta: [
      { title: "Prescriptions — KEGH HMS" },
      {
        name: "description",
        content:
          "Printable prescriptions with patient header, medication table and doctor sign-off.",
      },
      { property: "og:title", content: "Prescriptions — KEGH HMS" },
      {
        property: "og:description",
        content: "Printable prescriptions with medication table and doctor sign-off.",
      },
    ],
  }),
  component: PrescriptionsPage,
});

const blankItem = (): PrescriptionItem => ({
  medication: "",
  dosage: "",
  frequency: "",
  duration: "",
});

const blank = (): Partial<Prescription> => ({
  patientId: "",
  visitId: "",
  date: todayISO(),
  doctor: "",
  diagnosis: "",
  items: [blankItem()],
  notes: "",
  signOff: "",
});

function PrescriptionsPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Prescription>>(blank);
  const [printRx, setPrintRx] = useState<Prescription | null>(null);

  const rows = useMemo(
    () => sortByDateDesc(Object.values(state.prescriptions ?? {})),
    [state.prescriptions],
  );

  const items = form.items ?? [];

  const setItem = (idx: number, patch: Partial<PrescriptionItem>) =>
    setForm((f) => {
      const next = [...(f.items ?? [])];
      next[idx] = { ...blankItem(), ...next[idx], ...patch };
      return { ...f, items: next };
    });

  const pickPatient = (id: string) => {
    setForm((f) => ({ ...f, patientId: id, visitId: "" }));
  };

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    const cleaned = items
      .map((i) => ({ ...i, medication: i.medication?.trim() ?? "" }))
      .filter((i) => i.medication);
    if (cleaned.length === 0) {
      toast.error("Add at least one medication");
      return;
    }
    upsert<Prescription>("prescriptions", {
      ...form,
      doctor: form.doctor?.trim() ?? "",
      diagnosis: form.diagnosis?.trim() ?? "",
      notes: form.notes?.trim() ?? "",
      items: cleaned,
      signOff: form.signOff?.trim() ?? "",
    } as Prescription);
    toast.success(form.id ? "Prescription updated" : "Prescription saved");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Prescriptions"
        subtitle={`${rows.length} prescription${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New prescription
          </Button>
        }
      />

      <DataTable
        columns={["Date", "Patient", "Doctor", "Diagnosis", "Medications", ""]}
        rowCount={rows.length}
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{fmtDate(r.date)}</Td>
            <Td>
              <Link
                to="/patients/$patientId"
                params={{ patientId: r.patientId }}
                className="text-accent underline"
              >
                {state.patients[r.patientId]?.name ?? "—"}
              </Link>
            </Td>
            <Td>{r.doctor || "—"}</Td>
            <Td>{r.diagnosis || "—"}</Td>
            <Td>
              <Badge tone="neutral">{r.items?.length ?? 0} item(s)</Badge>
            </Td>
            <Td className="whitespace-nowrap">
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                title="Print / preview"
                onClick={() => setPrintRx(r)}
              >
                <Printer className="h-4 w-4" />
              </button>
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(r);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirmDelete("this prescription")) {
                    remove("prescriptions", r.id);
                    toast.success("Prescription deleted");
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
        title={form.id ? "Edit prescription" : "New prescription"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker value={form.patientId ?? ""} onChange={pickPatient} />
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
          <Field label="Doctor">
            <Input
              value={form.doctor ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, doctor: e.target.value }))}
            />
          </Field>
          <Field label="Diagnosis">
            <Input
              value={form.diagnosis ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Medications</p>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-4"
                  placeholder="Medication"
                  value={item.medication}
                  onChange={(e) => setItem(idx, { medication: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  placeholder="Dosage"
                  value={item.dosage}
                  onChange={(e) => setItem(idx, { dosage: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  placeholder="Frequency"
                  value={item.frequency}
                  onChange={(e) => setItem(idx, { frequency: e.target.value })}
                />
                <Input
                  className="col-span-3"
                  placeholder="Duration"
                  value={item.duration}
                  onChange={(e) => setItem(idx, { duration: e.target.value })}
                />
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
            <Plus className="h-4 w-4" /> Add medication
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-1">
          <Field label="Instructions / notes">
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Take after food, review in 5 days…"
            />
          </Field>
          <Field label="Signature line (defaults to doctor name)">
            <Input
              value={form.signOff ?? ""}
              placeholder={form.doctor?.trim() || "Doctor's name"}
              onChange={(e) => setForm((f) => ({ ...f, signOff: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save prescription</Button>
        </div>
      </Modal>

      <PrescriptionPrint
        open={Boolean(printRx)}
        onClose={() => setPrintRx(null)}
        prescription={printRx}
        patient={printRx ? state.patients[printRx.patientId] : undefined}
      />
    </div>
  );
}
