import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import {
  RANGE_LABELS,
  prescriptionSummary,
  prescriptionsInRange,
  sortByDateDesc,
  type RangeKey,
} from "@/lib/hms/selectors";
import { ageFromDob, fmtDate, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import type { Prescription, PrescriptionItem } from "@/lib/hms/types";
import {
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
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";
import { PrintOverlay } from "@/components/hms/PrintOverlay";

export const Route = createFileRoute("/prescriptions")({
  head: () => ({
    meta: [
      { title: "Prescriptions — KEGH HMS" },
      {
        name: "description",
        content: "Write prescriptions with allergy warnings and print them on the KEGH letterhead.",
      },
      { property: "og:title", content: "Prescriptions — KEGH HMS" },
      {
        property: "og:description",
        content: "Write prescriptions with allergy warnings and print them on the KEGH letterhead.",
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

/** Quick picks for the frequency and duration fields (1-0-1 = morning & night). */
const FREQUENCY_SUGGESTIONS = ["1-0-0", "0-0-1", "1-0-1", "0-1-0", "1-1-1", "1-1-1-1", "SOS"];
const DURATION_SUGGESTIONS = [
  "3 days",
  "5 days",
  "7 days",
  "10 days",
  "14 days",
  "1 month",
  "3 months",
];

function PrescriptionsPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Prescription>>(blank);
  const [error, setError] = useState("");
  const [printRx, setPrintRx] = useState<Prescription | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const [q, setQ] = useState("");

  const total = Object.keys(state.prescriptions ?? {}).length;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inRange = prescriptionsInRange(state, range);
    const filtered = !s
      ? inRange
      : inRange.filter((r) =>
          [
            state.patients[r.patientId]?.name ?? "",
            r.doctor ?? "",
            r.diagnosis ?? "",
            ...(r.items ?? []).map((i) => i.medication),
          ].some((v) => (v || "").toLowerCase().includes(s)),
        );
    return sortByDateDesc(filtered);
  }, [state, range, q]);

  const items = form.items ?? [];
  const allergyPatient = form.patientId ? state.patients[form.patientId] : undefined;
  const allergies = (allergyPatient?.allergies ?? "").trim();

  const set = (patch: Partial<Prescription>) => setForm((f) => ({ ...f, ...patch }));

  const setItem = (idx: number, patch: Partial<PrescriptionItem>) =>
    setForm((f) => {
      const next = [...(f.items ?? [])];
      next[idx] = { ...blankItem(), ...next[idx], ...patch };
      return { ...f, items: next };
    });

  const save = () => {
    if (!form.patientId) {
      setError("Select a patient before saving the prescription.");
      return;
    }
    const cleaned = items
      .map((i) => ({ ...i, medication: i.medication?.trim() ?? "" }))
      .filter((i) => i.medication);
    if (cleaned.length === 0) {
      setError("Add at least one medicine before saving the prescription.");
      return;
    }
    upsert<Prescription>("prescriptions", {
      ...form,
      doctor: form.doctor?.trim() ?? "",
      diagnosis: form.diagnosis?.trim() ?? "",
      notes: form.notes?.trim() ?? "",
      signOff: form.signOff?.trim() ?? "",
      items: cleaned,
    } as Prescription);
    toast.success(form.id ? "Prescription updated" : "Prescription saved");
    setOpen(false);
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const out: (string | number)[][] = [
      [
        "Date",
        "Patient",
        "MRN",
        "Doctor",
        "Diagnosis",
        "Medicine",
        "Dosage",
        "Frequency",
        "Duration",
        "Advice",
      ],
    ];
    for (const r of rows) {
      const p = state.patients[r.patientId];
      for (const item of r.items ?? []) {
        out.push([
          r.date,
          p?.name ?? "",
          p?.mrn ?? "",
          r.doctor ?? "",
          r.diagnosis ?? "",
          item.medication,
          item.dosage,
          item.frequency,
          item.duration,
          r.notes ?? "",
        ]);
      }
    }
    downloadCsv(`prescriptions-${range}.csv`, out);
  };

  const printPatient = printRx ? state.patients[printRx.patientId] : undefined;

  return (
    <div>
      <PageHeader
        title="Prescriptions"
        subtitle={`${rows.length} in this range · ${total} total`}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button
              onClick={() => {
                setForm(blank());
                setError("");
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New prescription
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Search">
          <Input
            placeholder="Patient, doctor, diagnosis or medicine…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Field label="Date range">
          <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
            {Object.entries(RANGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <DataTable
        columns={["Date", "Patient", "Doctor", "Diagnosis", "Medicines", ""]}
        rowCount={rows.length}
        empty="No prescriptions in this range."
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{fmtDate(r.date)}</Td>
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
            <Td>{prescriptionSummary(r)}</Td>
            <Td className="whitespace-nowrap">
              <div className="flex items-center gap-1">
                <button
                  className="text-muted-foreground hover:text-foreground"
                  title="Print"
                  onClick={() => setPrintRx(r)}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  title="Edit"
                  onClick={() => {
                    setForm({ ...r, items: r.items?.map((i) => ({ ...i })) ?? [] });
                    setError("");
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete"
                  onClick={() => {
                    if (confirmDelete("this prescription")) {
                      remove("prescriptions", r.id);
                      toast.success("Prescription deleted");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Td>
          </tr>
        ))}
      </DataTable>

      {/* Editor */}
      <Modal
        open={open}
        title={form.id ? "Edit prescription" : "New prescription"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker
              value={form.patientId ?? ""}
              onChange={(id) => set({ patientId: id, visitId: "" })}
            />
          </Field>
          {allergies ? (
            <p className="sm:col-span-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800">
              Allergies on record: {allergies}
            </p>
          ) : null}
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field label="Doctor">
            <DoctorSelect value={form.doctor ?? ""} onChange={(d) => set({ doctor: d })} />
          </Field>
          <Field label="Diagnosis" className="sm:col-span-2">
            <Input
              value={form.diagnosis ?? ""}
              placeholder="Working diagnosis"
              onChange={(e) => set({ diagnosis: e.target.value })}
            />
          </Field>
          <Field label="Linked visit" className="sm:col-span-2">
            <VisitPicker
              patientId={form.patientId ?? ""}
              value={form.visitId ?? ""}
              onChange={(id) => set({ visitId: id })}
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-foreground">Medicines</p>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-4"
                  placeholder="Medicine"
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
                  list="rx-frequency"
                  value={item.frequency}
                  onChange={(e) => setItem(idx, { frequency: e.target.value })}
                />
                <Input
                  className="col-span-3"
                  placeholder="Duration"
                  list="rx-duration"
                  value={item.duration}
                  onChange={(e) => setItem(idx, { duration: e.target.value })}
                />
                <button
                  className="col-span-1 text-muted-foreground hover:text-destructive"
                  title="Remove medicine"
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
            <Plus className="h-4 w-4" /> Add medicine
          </Button>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Advice / notes">
            <Textarea
              value={form.notes ?? ""}
              placeholder="Take after food, review in 5 days…"
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Field>
          <Field label="Sign off (defaults to the doctor)">
            <Input
              value={form.signOff ?? ""}
              placeholder={form.doctor?.trim() || "Doctor's name"}
              onChange={(e) => set({ signOff: e.target.value })}
            />
          </Field>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{form.id ? "Save changes" : "Save prescription"}</Button>
        </div>
      </Modal>

      {/* Letterhead print */}
      <PrintOverlay open={Boolean(printRx)} title="Prescription" onClose={() => setPrintRx(null)}>
        {printRx ? (
          <div>
            {printPatient ? (
              <table className="mb-4">
                <tbody>
                  <tr>
                    <th className="w-36">Name</th>
                    <td>{printPatient.name}</td>
                    <th className="w-36">MRN</th>
                    <td>{printPatient.mrn}</td>
                  </tr>
                  <tr>
                    <th>Age / Gender</th>
                    <td>
                      {ageFromDob(printPatient.dob)} / {printPatient.gender}
                    </td>
                    <th>Date</th>
                    <td>{fmtDate(printRx.date)}</td>
                  </tr>
                  <tr>
                    <th>Allergies</th>
                    <td colSpan={3}>{printPatient.allergies || "None recorded"}</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <table className="mb-4">
              <tbody>
                <tr>
                  <th className="w-36">Attending doctor</th>
                  <td>{printRx.doctor || "—"}</td>
                </tr>
                {printRx.diagnosis ? (
                  <tr>
                    <th>Diagnosis</th>
                    <td>{printRx.diagnosis}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <p className="mb-1 font-semibold">℞ Medicines</p>
            <table className="mb-4">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>Frequency</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {(printRx.items ?? []).map((m, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{m.medication || "—"}</td>
                    <td>{m.dosage || "—"}</td>
                    <td>{m.frequency || "—"}</td>
                    <td>{m.duration || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {printRx.notes ? (
              <p className="mb-4">
                <strong>Advice:</strong> {printRx.notes}
              </p>
            ) : null}

            <div className="mt-8 flex justify-end">
              <div className="w-56 text-center">
                <p className="border-t border-slate-400 pt-1 font-semibold">
                  {(printRx.signOff || "").trim() || printRx.doctor || "—"}
                </p>
                <p className="text-xs text-slate-500">Doctor's signature</p>
              </div>
            </div>
          </div>
        ) : null}
      </PrintOverlay>

      <datalist id="rx-frequency">
        {FREQUENCY_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id="rx-duration">
        {DURATION_SUGGESTIONS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}
