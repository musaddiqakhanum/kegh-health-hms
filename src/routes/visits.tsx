import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { sortByDateDesc } from "@/lib/hms/selectors";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import type { Visit } from "@/lib/hms/types";
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
import { PatientPicker, confirmDelete } from "@/components/hms/pickers";
import { PatientHeader } from "@/components/hms/record";
import { PrintOverlay } from "@/components/hms/PrintOverlay";

export const Route = createFileRoute("/visits")({
  head: () => ({
    meta: [
      { title: "Visits (OPD/IPD) — KEGH HMS" },
      {
        name: "description",
        content: "Record OPD, IPD and emergency visits with diagnosis and doctor notes.",
      },
      { property: "og:title", content: "Visits (OPD/IPD) — KEGH HMS" },
      {
        property: "og:description",
        content: "Record OPD, IPD and emergency visits with diagnosis and notes.",
      },
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
  procedures: "",
  followUp: "",
});

function VisitsPage() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Visit>>(blank);
  const [summaryVisit, setSummaryVisit] = useState<Visit | null>(null);
  const rows = useMemo(() => sortByDateDesc(Object.values(state.visits)), [state.visits]);
  const set = (k: keyof Visit, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const dischargeSummary = useMemo(() => {
    if (!summaryVisit) return null;
    const v = summaryVisit;
    const patient = state.patients[v.patientId];
    const labs = Object.values(state.labs).filter((l) => l.visitId === v.id);
    const rads = Object.values(state.rads).filter((r) => r.visitId === v.id);
    const pharms = Object.values(state.pharms).filter((p) => p.visitId === v.id);
    const bills = Object.values(state.bills).filter((b) => b.visitId === v.id);
    const billed = bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
    const paid = bills.reduce((s, b) => s + Number(b.paid || 0), 0);
    return { patient, labs, rads, pharms, bills, billed, paid, due: billed - paid };
  }, [summaryVisit, state]);

  const save = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.date) {
      toast.error("Visit date is required");
      return;
    }
    upsert<Visit>("visits", form as Visit);
    toast.success(form.id ? "Visit updated" : "Visit added");
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Visits (OPD/IPD)"
        subtitle={`${rows.length} visit${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New visit
          </Button>
        }
      />

      <DataTable
        columns={["Date", "Patient", "Type", "Doctor", "Department", "Diagnosis", ""]}
        rowCount={rows.length}
      >
        {rows.map((v) => (
          <tr key={v.id}>
            <Td>{fmtDate(v.date)}</Td>
            <Td>{state.patients[v.patientId]?.name ?? "—"}</Td>
            <Td>
              <Badge tone={v.type === "Emergency" ? "red" : v.type === "IPD" ? "amber" : "green"}>
                {v.type}
              </Badge>
            </Td>
            <Td>{v.doctor || "—"}</Td>
            <Td>{v.department || "—"}</Td>
            <Td>{v.diagnosis || "—"}</Td>
            <Td className="whitespace-nowrap">
              {v.type === "IPD" ? (
                <button
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  title="Discharge summary"
                  onClick={() => setSummaryVisit(v)}
                >
                  <Printer className="h-4 w-4" />
                </button>
              ) : null}
              <button
                className="mr-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setForm(v);
                  setOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirmDelete("this visit")) {
                    remove("visits", v.id);
                    toast.success("Visit deleted");
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
        title={form.id ? "Edit visit" : "New visit"}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker value={form.patientId ?? ""} onChange={(id) => set("patientId", id)} />
          </Field>
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="Type">
            <Select value={form.type ?? "OPD"} onChange={(e) => set("type", e.target.value)}>
              <option>OPD</option>
              <option>IPD</option>
              <option>Emergency</option>
            </Select>
          </Field>
          <Field label="Doctor">
            <Input value={form.doctor ?? ""} onChange={(e) => set("doctor", e.target.value)} />
          </Field>
          <Field label="Department">
            <Input
              value={form.department ?? ""}
              onChange={(e) => set("department", e.target.value)}
            />
          </Field>
          {form.type === "IPD" ? (
            <>
              <Field label="Admission date">
                <Input
                  type="date"
                  value={form.admissionDate ?? ""}
                  onChange={(e) => set("admissionDate", e.target.value)}
                />
              </Field>
              <Field label="Discharge date">
                <Input
                  type="date"
                  value={form.dischargeDate ?? ""}
                  onChange={(e) => set("dischargeDate", e.target.value)}
                />
              </Field>
            </>
          ) : null}
          <Field label="Diagnosis" className="sm:col-span-2">
            <Input
              value={form.diagnosis ?? ""}
              onChange={(e) => set("diagnosis", e.target.value)}
            />
          </Field>
          {form.type === "IPD" ? (
            <Field label="Procedures / interventions" className="sm:col-span-2">
              <Textarea
                value={form.procedures ?? ""}
                onChange={(e) => set("procedures", e.target.value)}
                placeholder="Surgeries, procedures and interventions performed…"
              />
            </Field>
          ) : null}
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          {form.type === "IPD" ? (
            <Field label="Follow-up advice" className="sm:col-span-2">
              <Textarea
                value={form.followUp ?? ""}
                onChange={(e) => set("followUp", e.target.value)}
                placeholder="Review in 7 days, continue medication…"
              />
            </Field>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save visit</Button>
        </div>
      </Modal>

      <PrintOverlay
        open={Boolean(summaryVisit)}
        title={`Discharge Summary — ${summaryVisit?.type ?? "IPD"}`}
        onClose={() => setSummaryVisit(null)}
      >
        {summaryVisit && dischargeSummary ? (
          <div>
            {dischargeSummary.patient ? <PatientHeader patient={dischargeSummary.patient} /> : null}
            <table className="mb-4">
              <tbody>
                <tr>
                  <th className="w-36">Admission date</th>
                  <td>{fmtDate(summaryVisit.admissionDate)}</td>
                  <th className="w-36">Discharge date</th>
                  <td>{fmtDate(summaryVisit.dischargeDate)}</td>
                </tr>
                <tr>
                  <th>Attending doctor</th>
                  <td>{summaryVisit.doctor || "—"}</td>
                  <th>Department</th>
                  <td>{summaryVisit.department || "—"}</td>
                </tr>
                <tr>
                  <th>Diagnosis</th>
                  <td colSpan={3}>{summaryVisit.diagnosis || "—"}</td>
                </tr>
                <tr>
                  <th>Procedures</th>
                  <td colSpan={3}>{summaryVisit.procedures || "—"}</td>
                </tr>
              </tbody>
            </table>

            {dischargeSummary.pharms.length > 0 ? (
              <>
                <h3 className="mb-1 font-semibold">Medications on discharge</h3>
                <table className="mb-4">
                  <thead>
                    <tr>
                      <th>Medication</th>
                      <th>Dosage</th>
                      <th>Frequency</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dischargeSummary.pharms.map((p) => (
                      <tr key={p.id}>
                        <td>{p.medication}</td>
                        <td>{p.dosage || "—"}</td>
                        <td>{p.frequency || "—"}</td>
                        <td>{p.duration || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            {dischargeSummary.labs.length > 0 ? (
              <>
                <h3 className="mb-1 font-semibold">Investigations</h3>
                <table className="mb-4">
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Result</th>
                      <th>Range</th>
                      <th>Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dischargeSummary.labs.map((l) => (
                      <tr key={l.id}>
                        <td>{l.testName}</td>
                        <td>
                          {l.result} {l.unit}
                        </td>
                        <td>{l.normalRange || "—"}</td>
                        <td>{l.flag}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            {dischargeSummary.rads.length > 0 ? (
              <>
                <h3 className="mb-1 font-semibold">Imaging</h3>
                <table className="mb-4">
                  <thead>
                    <tr>
                      <th>Study</th>
                      <th>Impression</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dischargeSummary.rads.map((r) => (
                      <tr key={r.id}>
                        <td>{r.studyType}</td>
                        <td>{r.impression || r.findings || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            <table className="mb-4">
              <tbody>
                <tr>
                  <th className="w-36">Follow-up</th>
                  <td>{summaryVisit.followUp || "As advised"}</td>
                </tr>
                {dischargeSummary.bills.length > 0 ? (
                  <tr>
                    <th>Billing summary</th>
                    <td>
                      Billed {money(dischargeSummary.billed)} · Paid {money(dischargeSummary.paid)}{" "}
                      · Due {money(dischargeSummary.due)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            {summaryVisit.notes ? (
              <p className="mb-4">
                <strong>Clinical notes:</strong> {summaryVisit.notes}
              </p>
            ) : null}

            <div className="mt-8 flex justify-end">
              <div className="w-56 text-center">
                <p className="border-t border-slate-400 pt-1 font-semibold">
                  {summaryVisit.doctor || "Attending doctor"}
                </p>
                <p className="text-xs text-slate-500">Doctor's signature</p>
              </div>
            </div>
          </div>
        ) : null}
      </PrintOverlay>
    </div>
  );
}
