import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BedDouble,
  Download,
  DoorOpen,
  IndianRupee,
  Pencil,
  Plus,
  Printer,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { useSession } from "@/lib/hms/useSession";
import { fmtDate, money, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import { WARDS, type Admission, type Bed, type Bill, type Visit } from "@/lib/hms/types";
import {
  activeAdmissionForBed,
  activeAdmissionForPatient,
  activeAdmissions,
  admissionList,
  bedChargeFor,
  bedList,
  bedStats,
  dueTodayDischarges,
  freeBeds,
  stayDays,
  wardOccupancy,
} from "@/lib/hms/ipd";
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
import { PatientPicker, VisitPicker, confirmDelete } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";
import { PrintOverlay } from "@/components/hms/PrintOverlay";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ipd")({
  head: () => ({
    meta: [
      { title: "IPD — KEGH HMS" },
      {
        name: "description",
        content:
          "IPD admissions and beds — ward bed board, admit and discharge patients, discharge summaries.",
      },
      { property: "og:title", content: "IPD — KEGH HMS" },
      {
        property: "og:description",
        content:
          "IPD admissions and beds — ward bed board, admit and discharge patients, discharge summaries.",
      },
    ],
  }),
  component: IpdPage,
});

type Tab = "board" | "admissions" | "beds";

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function IpdPage() {
  const { state } = useHms();
  const [tab, setTab] = useState<Tab>("board");
  const stats = useMemo(() => bedStats(state), [state]);
  const active = useMemo(() => activeAdmissions(state), [state]);

  return (
    <div>
      <PageHeader
        title="IPD — Admissions & Beds"
        subtitle={
          stats.total > 0
            ? `${stats.occupied}/${stats.total} beds occupied (${stats.pct}%) · ${active.length} admitted`
            : "Set up wards and beds, then admit patients"
        }
      />

      <div className="mb-4 inline-flex flex-wrap rounded-lg bg-muted p-1">
        {(
          [
            ["board", "Bed board"],
            ["admissions", `Admissions (${active.length})`],
            ["beds", "Beds & wards"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "board" ? <BoardTab /> : null}
      {tab === "admissions" ? <AdmissionsTab /> : null}
      {tab === "beds" ? <BedsTab /> : null}
    </div>
  );
}

/* -------------------------------------------------------------- board */

function BoardTab() {
  const { state } = useHms();
  const wards = useMemo(() => wardOccupancy(state), [state]);
  const beds = useMemo(() => bedList(state), [state]);

  if (beds.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          No beds yet — open the <strong>Beds &amp; wards</strong> tab to add your first ward.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {wards.map((w) => (
        <div key={w.ward}>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {w.ward}
            </h3>
            <Badge tone={w.occupied === w.total ? "red" : w.occupied > 0 ? "amber" : "green"}>
              {w.occupied}/{w.total} occupied
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {beds
              .filter((b) => b.ward === w.ward)
              .map((b) => {
                const adm = activeAdmissionForBed(state, b.id);
                const patient = adm ? state.patients[adm.patientId] : undefined;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "rounded-lg p-3 ring-1 shadow-sm",
                      adm ? "bg-red-50 ring-red-200" : "bg-emerald-50 ring-emerald-200",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-foreground">
                        <BedDouble className="mr-1 inline h-4 w-4" />
                        {b.label}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {b.rate ? `${money(b.rate)}/day` : ""}
                      </span>
                    </div>
                    {adm ? (
                      <div className="mt-1.5 text-xs">
                        <Link
                          to="/patients/$patientId"
                          params={{ patientId: adm.patientId }}
                          className="font-medium text-accent underline"
                        >
                          {patient?.name ?? "—"}
                        </Link>
                        <p className="text-muted-foreground">
                          {stayDays(adm.admitDate)} day{stayDays(adm.admitDate) === 1 ? "" : "s"} ·{" "}
                          {adm.doctor || "no doctor"}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs font-medium text-emerald-700">Free</p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- admissions */

const blankAdmit = (): Partial<Admission> => ({
  patientId: "",
  visitId: "",
  bedId: "",
  admitDate: todayISO(),
  admitTime: hhmmNow(),
  reason: "",
  doctor: "",
  status: "Admitted",
  expectedDischarge: "",
});

function AdmissionsTab() {
  const { state, upsert, remove } = useHms();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"active" | "all">("active");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Admission>>(blankAdmit);
  const [dischargeFor, setDischargeFor] = useState<Admission | null>(null);
  const [printAdm, setPrintAdm] = useState<Admission | null>(null);

  const rows = useMemo(() => {
    const list = admissionList(state).sort(
      (a, b) =>
        (a.status === "Admitted" ? 0 : 1) - (b.status === "Admitted" ? 0 : 1) ||
        (b.admitDate || "").localeCompare(a.admitDate || "") ||
        b.createdAt - a.createdAt,
    );
    const shown = show === "active" ? list.filter((a) => a.status === "Admitted") : list;
    const s = q.trim().toLowerCase();
    if (!s) return shown;
    return shown.filter(
      (a) =>
        (state.patients[a.patientId]?.name ?? "").toLowerCase().includes(s) ||
        (state.beds[a.bedId]?.label ?? "").toLowerCase().includes(s) ||
        (state.beds[a.bedId]?.ward ?? "").toLowerCase().includes(s) ||
        a.reason?.toLowerCase().includes(s) ||
        a.doctor?.toLowerCase().includes(s),
    );
  }, [state, q, show]);

  const beds = freeBeds(state);
  const dueToday = useMemo(() => dueTodayDischarges(state), [state]);

  const saveAdmit = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.bedId) {
      toast.error("Pick a bed");
      return;
    }
    if (!form.id) {
      if (activeAdmissionForPatient(state, form.patientId)) {
        toast.error("This patient is already admitted — discharge them first");
        return;
      }
      if (activeAdmissionForBed(state, form.bedId)) {
        toast.error("That bed is occupied — pick a free bed");
        return;
      }
    }
    upsert<Admission>("admissions", {
      ...form,
      status: form.id ? form.status : "Admitted",
    } as Admission);
    toast.success(form.id ? "Admission updated" : "Patient admitted");
    setOpen(false);
  };

  const del = (a: Admission) => {
    if (confirmDelete(`this admission for ${state.patients[a.patientId]?.name ?? "the patient"}`)) {
      remove("admissions", a.id);
      toast.success("Admission deleted — the bed is free again");
    }
  };

  /** Post days-stayed × bed-rate to the patient's bill — new bill the first
      time, amount refreshed on the same bill afterwards (never duplicated). */
  const postBedCharges = (a: Admission) => {
    const charge = bedChargeFor(state, a);
    if (!charge) {
      toast.error("This bed has no per-day rate — set it on the Beds tab, or bill manually");
      return;
    }
    const line = {
      description: charge.description,
      qty: charge.days,
      rate: charge.rate,
      amount: charge.amount,
    };
    if (a.bedChargeBillId && state.bills[a.bedChargeBillId]) {
      const bill = state.bills[a.bedChargeBillId]!;
      const items = [
        line,
        ...bill.items.filter((i) => !i.description.startsWith("Bed charges — ")),
      ];
      const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
      const totalAmount = subtotal - Number(bill.discount || 0) + Number(bill.tax || 0);
      upsert<Bill>("bills", {
        id: bill.id,
        items,
        totalAmount,
        due: Math.max(0, totalAmount - Number(bill.paid || 0)),
      } as Bill);
      toast.success(`Bed charges updated on the existing bill — ${money(totalAmount)}`);
    } else {
      const billId = crypto.randomUUID();
      upsert<Bill>("bills", {
        id: billId,
        patientId: a.patientId,
        visitId: a.visitId || "",
        date: todayISO(),
        items: [line],
        totalAmount: charge.amount,
        discount: 0,
        tax: 0,
        paid: 0,
        due: charge.amount,
        paymentMode: "",
      } as Bill);
      upsert<Admission>("admissions", { id: a.id, bedChargeBillId: billId });
      toast.success(`Bed charges posted — new bill of ${money(charge.amount)}`);
    }
  };

  const exportCsv = () => {
    downloadCsv("ipd-admissions.csv", [
      [
        "Patient",
        "MRN",
        "Ward",
        "Bed",
        "Admit date",
        "Days",
        "Doctor",
        "Reason",
        "Status",
        "Discharge date",
      ],
      ...rows.map((a) => [
        state.patients[a.patientId]?.name ?? "",
        state.patients[a.patientId]?.mrn ?? "",
        state.beds[a.bedId]?.ward ?? "",
        state.beds[a.bedId]?.label ?? "",
        a.admitDate,
        stayDays(a.admitDate, a.dischargeDate),
        a.doctor,
        a.reason,
        a.status,
        a.dischargeDate ?? "",
      ]),
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search patient / bed / doctor / reason"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          className="w-44"
          value={show}
          onChange={(e) => setShow(e.target.value as typeof show)}
        >
          <option value="active">Currently admitted</option>
          <option value="all">All admissions</option>
        </Select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button
            onClick={() => {
              setForm(blankAdmit());
              setOpen(true);
            }}
            disabled={beds.length === 0}
          >
            <UserPlus className="h-4 w-4" /> Admit patient
          </Button>
        </div>
      </div>

      {dueToday.length > 0 ? (
        <Card className="border-l-4 border-l-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Discharging today ({dueToday.length}) — beds to free
          </p>
          <ul className="space-y-1 text-sm">
            {dueToday.map((a) => {
              const p = state.patients[a.patientId];
              const b = state.beds[a.bedId];
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: a.patientId }}
                    className="font-medium text-accent underline"
                  >
                    {p?.name ?? "—"}
                  </Link>
                  <span className="text-muted-foreground">
                    {b ? `${b.ward} · ${b.label}` : "—"} · day {stayDays(a.admitDate)}
                    {a.doctor ? ` · ${a.doctor}` : ""}
                  </span>
                  <Badge tone="amber">Due today</Badge>
                  <button
                    className="ml-auto text-xs font-medium text-accent underline"
                    onClick={() => setDischargeFor(a)}
                  >
                    Discharge now →
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <DataTable
        columns={["Patient", "Bed", "Admitted", "Days", "Doctor", "Reason", "Status", ""]}
        rowCount={rows.length}
        empty="Nobody admitted right now."
      >
        {rows.map((a) => {
          const p = state.patients[a.patientId];
          const b = state.beds[a.bedId];
          return (
            <tr key={a.id}>
              <Td>
                <Link
                  to={`/patients/$patientId`}
                  params={{ patientId: a.patientId }}
                  className="font-medium text-accent underline"
                >
                  {p?.name ?? "—"}
                </Link>
                <div className="text-xs text-muted-foreground">{p?.mrn ?? ""}</div>
              </Td>
              <Td>
                {b ? (
                  <>
                    <span className="font-medium">{b.label}</span>
                    <div className="text-xs text-muted-foreground">{b.ward}</div>
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {fmtDate(a.admitDate)} {a.admitTime}
              </Td>
              <Td>{stayDays(a.admitDate, a.dischargeDate)}</Td>
              <Td>{a.doctor || "—"}</Td>
              <Td className="max-w-52">{a.reason || "—"}</Td>
              <Td>
                {a.status === "Admitted" ? (
                  <Badge tone="amber">Admitted</Badge>
                ) : (
                  <Badge tone="green">
                    Discharged {a.dischargeDate ? fmtDate(a.dischargeDate) : ""}
                  </Badge>
                )}
                {a.status === "Admitted" && (a.expectedDischarge ?? "") === todayISO() ? (
                  <div className="mt-1">
                    <Badge tone="red">due today</Badge>
                  </div>
                ) : null}
                {a.bedChargeBillId ? (
                  <div className="mt-1">
                    <Badge tone="neutral">bed billed</Badge>
                  </div>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  title="Post days-stayed × bed-rate to the patient's bill"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => postBedCharges(a)}
                >
                  <IndianRupee className="h-4 w-4" />
                </button>
                {a.status === "Admitted" ? (
                  <Button
                    variant="outline"
                    className="mr-1 px-2 py-1 text-xs"
                    onClick={() => setDischargeFor(a)}
                  >
                    <DoorOpen className="h-3.5 w-3.5" /> Discharge
                  </Button>
                ) : (
                  <button
                    title="Print discharge summary"
                    className="mr-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setPrintAdm(a)}
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                )}
                <button
                  title="Edit admission"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setForm(a);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  title="Delete admission"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => del(a)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Td>
            </tr>
          );
        })}
      </DataTable>

      {/* admit modal */}
      <Modal
        open={open}
        title={form.id ? "Edit admission" : "Admit patient"}
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
          <Field label="Linked IPD visit">
            <VisitPicker
              patientId={form.patientId ?? ""}
              value={form.visitId ?? ""}
              onChange={(id) => setForm((f) => ({ ...f, visitId: id }))}
            />
          </Field>
          <Field label="Bed" required>
            <Select
              value={form.bedId ?? ""}
              disabled={Boolean(form.id)}
              onChange={(e) => setForm((f) => ({ ...f, bedId: e.target.value }))}
            >
              <option value="">Select a free bed…</option>
              {beds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.ward} · {b.label}
                  {b.rate ? ` · ${money(b.rate)}/day` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Admit date" required>
            <Input
              type="date"
              value={form.admitDate ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, admitDate: e.target.value }))}
            />
          </Field>
          <Field label="Admit time">
            <Input
              type="time"
              value={form.admitTime ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, admitTime: e.target.value }))}
            />
          </Field>
          <Field label="Expected discharge (optional)">
            <Input
              type="date"
              min={form.admitDate || undefined}
              value={form.expectedDischarge ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, expectedDischarge: e.target.value }))}
            />
          </Field>
          <Field label="Treating doctor" className="sm:col-span-2">
            <DoctorSelect
              value={form.doctor ?? ""}
              onChange={(name) => setForm((f) => ({ ...f, doctor: name }))}
            />
          </Field>
          <Field label="Reason / provisional diagnosis" className="sm:col-span-2">
            <Textarea
              value={form.reason ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveAdmit}>{form.id ? "Save admission" : "Admit"}</Button>
        </div>
      </Modal>

      <DischargeModal admission={dischargeFor} onClose={() => setDischargeFor(null)} />

      {/* printable discharge summary */}
      <PrintOverlay
        open={Boolean(printAdm)}
        title="Discharge Summary"
        onClose={() => setPrintAdm(null)}
      >
        {printAdm ? (
          <div>
            <table className="mb-3">
              <tbody>
                <tr>
                  <td style={{ width: "50%" }}>
                    <strong>Patient:</strong> {state.patients[printAdm.patientId]?.name ?? "—"}
                  </td>
                  <td>
                    <strong>MRN:</strong> {state.patients[printAdm.patientId]?.mrn ?? "—"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Admitted:</strong> {fmtDate(printAdm.admitDate)} {printAdm.admitTime}
                  </td>
                  <td>
                    <strong>Discharged:</strong>{" "}
                    {printAdm.dischargeDate
                      ? `${fmtDate(printAdm.dischargeDate)} ${printAdm.dischargeTime ?? ""}`
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Bed:</strong> {state.beds[printAdm.bedId]?.ward ?? "—"} ·{" "}
                    {state.beds[printAdm.bedId]?.label ?? "—"}
                  </td>
                  <td>
                    <strong>Days:</strong> {stayDays(printAdm.admitDate, printAdm.dischargeDate)}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Treating doctor:</strong> {printAdm.doctor || "—"}
                  </td>
                  <td>
                    <strong>Discharged by:</strong> {printAdm.dischargedBy || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              <strong>Reason for admission:</strong> {printAdm.reason || "—"}
            </p>
            <p className="mt-3" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Summary / course in hospital:</strong>
              <br />
              {printAdm.dischargeSummary || "—"}
            </p>
            <p className="mt-3" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Follow-up advice:</strong>
              <br />
              {printAdm.dischargeAdvice || "—"}
            </p>
            <div className="mt-8 flex justify-end">
              <div className="w-56 text-center">
                <p className="border-t border-slate-400 pt-1 font-semibold">
                  {printAdm.doctor || printAdm.dischargedBy || "—"}
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

/* ----------------------------------------------------------- discharge */

function DischargeModal({
  admission,
  onClose,
}: {
  admission: Admission | null;
  onClose: () => void;
}) {
  const { state, upsert } = useHms();
  const { user } = useSession();
  const [form, setForm] = useState({
    dischargeDate: todayISO(),
    dischargeTime: hhmmNow(),
    dischargeSummary: "",
    dischargeAdvice: "",
  });
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (admission && admission.id !== seededFor) {
    setSeededFor(admission.id);
    setForm({
      dischargeDate: todayISO(),
      dischargeTime: hhmmNow(),
      dischargeSummary: admission.dischargeSummary ?? "",
      dischargeAdvice: admission.dischargeAdvice ?? "",
    });
  }
  if (!admission) return null;

  const p = state.patients[admission.patientId];
  const b = state.beds[admission.bedId];

  const save = () => {
    upsert<Admission>("admissions", {
      id: admission.id,
      status: "Discharged",
      dischargeDate: form.dischargeDate,
      dischargeTime: form.dischargeTime,
      dischargeSummary: form.dischargeSummary,
      dischargeAdvice: form.dischargeAdvice,
      dischargedBy: user?.displayName ?? "",
    });
    /* Reflect on the linked IPD visit when there is one. */
    if (admission.visitId && state.visits[admission.visitId]) {
      upsert<Visit>("visits", {
        id: admission.visitId,
        dischargeDate: form.dischargeDate,
        followUp: state.visits[admission.visitId]!.followUp || form.dischargeAdvice,
      } as Visit);
    }
    toast.success(`${p?.name ?? "Patient"} discharged — bed ${b?.label ?? ""} is free`);
    onClose();
  };

  return (
    <Modal open title={`Discharge — ${p?.name ?? "patient"}`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-muted-foreground">
        {b ? `${b.ward} · ${b.label} · ` : ""}admitted {fmtDate(admission.admitDate)} ·{" "}
        {stayDays(admission.admitDate, form.dischargeDate)} day
        {stayDays(admission.admitDate, form.dischargeDate) === 1 ? "" : "s"}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Discharge date" required>
          <Input
            type="date"
            value={form.dischargeDate}
            onChange={(e) => setForm((f) => ({ ...f, dischargeDate: e.target.value }))}
          />
        </Field>
        <Field label="Discharge time">
          <Input
            type="time"
            value={form.dischargeTime}
            onChange={(e) => setForm((f) => ({ ...f, dischargeTime: e.target.value }))}
          />
        </Field>
        <Field label="Summary / course in hospital" className="sm:col-span-2">
          <Textarea
            placeholder="Condition on admission, treatment given, condition at discharge…"
            value={form.dischargeSummary}
            onChange={(e) => setForm((f) => ({ ...f, dischargeSummary: e.target.value }))}
          />
        </Field>
        <Field label="Follow-up advice" className="sm:col-span-2">
          <Textarea
            placeholder="Medicines to continue, review after 1 week…"
            value={form.dischargeAdvice}
            onChange={(e) => setForm((f) => ({ ...f, dischargeAdvice: e.target.value }))}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>
          <DoorOpen className="h-4 w-4" /> Discharge patient
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- beds */

const blankBed = (): Partial<Bed> & { count?: number } => ({
  ward: "General Ward",
  room: "",
  label: "",
  rate: 0,
  active: true,
  notes: "",
  count: 1,
});

function BedsTab() {
  const { state, upsert, remove } = useHms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Bed> & { count?: number }>(blankBed);
  const beds = useMemo(() => bedList(state), [state]);
  const stats = useMemo(() => bedStats(state), [state]);

  const save = () => {
    const count = form.id ? 1 : Math.max(1, Math.min(50, Number(form.count || 1)));
    if (form.id) {
      if (!form.label?.trim()) {
        toast.error("Bed label is required");
        return;
      }
      upsert<Bed>("beds", { ...form, rate: Number(form.rate || 0) } as Bed);
      toast.success("Bed updated");
      setOpen(false);
      return;
    }
    /* Batch add: "GW-1" + count 5 → GW-1 .. GW-5 */
    const base = (form.label ?? "").trim();
    if (!base) {
      toast.error("Enter a bed label (e.g. GW-1)");
      return;
    }
    const m = base.match(/^(.*?)(\d+)$/);
    for (let k = 0; k < count; k++) {
      const label = m ? `${m[1]}${Number(m[2]) + k}` : count > 1 ? `${base}-${k + 1}` : base;
      upsert<Bed>("beds", {
        ward: form.ward || WARDS[0],
        room: form.room ?? "",
        label,
        rate: Number(form.rate || 0),
        active: true,
        notes: form.notes ?? "",
      } as Bed);
    }
    toast.success(count === 1 ? "Bed added" : `${count} beds added (${form.ward})`);
    setOpen(false);
  };

  const del = (b: Bed) => {
    if (activeAdmissionForBed(state, b.id)) {
      toast.error("This bed is occupied — discharge the patient first");
      return;
    }
    if (confirmDelete(`bed ${b.label} (${b.ward})`)) {
      remove("beds", b.id);
      toast.success("Bed removed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {stats.total} beds · {stats.free} free · add a whole row at once with the count field.
        </p>
        <Button
          className="ml-auto"
          onClick={() => {
            setForm(blankBed());
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add beds
        </Button>
      </div>

      <DataTable
        columns={["Ward", "Room", "Bed", "Rate per day", "Status", "Notes", ""]}
        rowCount={beds.length}
        empty="No beds yet."
      >
        {beds.map((b) => {
          const adm = activeAdmissionForBed(state, b.id);
          return (
            <tr key={b.id}>
              <Td>{b.ward}</Td>
              <Td>{b.room || "—"}</Td>
              <Td className="font-medium">
                <BedDouble className="mr-1 inline h-4 w-4 text-muted-foreground" />
                {b.label}
              </Td>
              <Td>{b.rate ? `${money(b.rate)}` : "—"}</Td>
              <Td>
                {adm ? (
                  <Badge tone="red">Occupied · {state.patients[adm.patientId]?.name ?? "—"}</Badge>
                ) : (
                  <Badge tone="green">Free</Badge>
                )}
              </Td>
              <Td>{b.notes || "—"}</Td>
              <Td className="whitespace-nowrap">
                <button
                  title="Edit bed"
                  className="mr-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setForm(b);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  title="Delete bed"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => del(b)}
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
        title={form.id ? `Edit bed ${form.label}` : "Add beds"}
        onClose={() => setOpen(false)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ward" required>
            <Input
              list="ward-picks"
              value={form.ward ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value }))}
            />
            <datalist id="ward-picks">
              {WARDS.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </Field>
          <Field label="Room">
            <Input
              placeholder="101"
              value={form.room ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
            />
          </Field>
          <Field label={form.id ? "Bed label" : "First bed label"} required>
            <Input
              placeholder="GW-1"
              value={form.label ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </Field>
          {!form.id ? (
            <Field label="How many beds">
              <Input
                type="number"
                min={1}
                max={50}
                value={form.count ?? 1}
                onChange={(e) => setForm((f) => ({ ...f, count: Number(e.target.value) }))}
              />
            </Field>
          ) : null}
          <Field label="Rate per day (₹)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.rate ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        {!form.id ? (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Labels ending in a number count up — "GW-1" × 6 beds becomes GW-1 … GW-6.
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{form.id ? "Save bed" : "Add beds"}</Button>
        </div>
      </Modal>
    </div>
  );
}
