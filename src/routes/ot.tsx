import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Download,
  IndianRupee,
  Pencil,
  Plus,
  Printer,
  Scissors,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { fmtDate, fmtDateTime, money, todayISO } from "@/lib/hms/format";
import { downloadCsv } from "@/lib/hms/csv";
import {
  ANAESTHESIA_TYPES,
  BILL_PAYMENT_MODES,
  OT_ROOMS,
  SURGERY_PRIORITIES,
  SURGERY_STATUSES,
  SAFETY_CHECKS,
  type Admission,
  type Bill,
  type Surgery,
  type SurgeryStatus,
} from "@/lib/hms/types";
import {
  COMMON_PROCEDURES,
  checksReady,
  defaultChecks,
  endsAt,
  isReady,
  minutesOf,
  missingChecks,
  missingOtRates,
  nextSurgeryNo,
  normalizeChecks,
  otDayStats,
  otTone,
  searchSurgeries,
  sortTheatreList,
  surgeryList,
  surgeryStats,
  timelineBounds,
  timelinePct,
  nowMinutes,
} from "@/lib/hms/ot";
import { orderCharge } from "@/lib/hms/charges";
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

export const Route = createFileRoute("/ot")({
  head: () => ({
    meta: [
      { title: "OT Scheduling — KEGH HMS" },
      {
        name: "description",
        content:
          "Operation theatre scheduling — day-wise theatre lists, surgical team, pre-op safety checklist, case outcomes and theatre charges.",
      },
      { property: "og:title", content: "OT Scheduling — KEGH HMS" },
      {
        property: "og:description",
        content:
          "Operation theatre scheduling — day-wise theatre lists, surgical team, pre-op checklist and charges.",
      },
    ],
  }),
  component: OtPage,
});

/* ----------------------------------------------------------------- helpers */

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date || todayISO()}T00:00:00`);
  if (Number.isNaN(d.getTime())) return todayISO();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Tab = "day" | "list";

type SurgeryForm = {
  id?: string;
  surgeryNo: number;
  patientId: string;
  visitId: string;
  admissionId: string;
  date: string;
  time: string;
  durationMinutes: number;
  room: string;
  procedure: string;
  code: string;
  priority: string;
  surgeon: string;
  assistant: string;
  anaesthetist: string;
  anaesthesia: string;
  diagnosis: string;
  scrubNurse: string;
  notes: string;
  checks: { name: string; ready: boolean }[];
};

const blankSurgery = (surgeryNo: number, date: string): SurgeryForm => ({
  surgeryNo,
  patientId: "",
  visitId: "",
  admissionId: "",
  date,
  time: "09:00",
  durationMinutes: 60,
  room: OT_ROOMS[0] ?? "OT 1",
  procedure: "",
  code: "",
  priority: "Elective",
  surgeon: "",
  assistant: "",
  anaesthetist: "",
  anaesthesia: "General",
  diagnosis: "",
  scrubNurse: "",
  notes: "",
  checks: defaultChecks(),
});

function surgeryToForm(s: Surgery): SurgeryForm {
  return {
    id: s.id,
    surgeryNo: s.surgeryNo,
    patientId: s.patientId,
    visitId: s.visitId || "",
    admissionId: s.admissionId || "",
    date: s.date,
    time: s.time,
    durationMinutes: Number(s.durationMinutes || 0),
    room: s.room,
    procedure: s.procedure,
    code: s.code || "",
    priority: s.priority || "Elective",
    surgeon: s.surgeon || "",
    assistant: s.assistant || "",
    anaesthetist: s.anaesthetist || "",
    anaesthesia: s.anaesthesia || "",
    diagnosis: s.diagnosis || "",
    scrubNurse: s.scrubNurse || "",
    notes: s.notes || "",
    checks: normalizeChecks(s.checks),
  };
}

/* --------------------------------------------------------------------- page */

function OtPage() {
  const { state, upsert, remove } = useHms();

  const [tab, setTab] = useState<Tab>("day");
  const [date, setDate] = useState(todayISO());
  const [room, setRoom] = useState("");
  const [status, setStatus] = useState<"" | SurgeryStatus>("");
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<SurgeryForm>(() => blankSurgery(1, todayISO()));
  const [caseFor, setCaseFor] = useState<Surgery | null>(null);
  const [printList, setPrintList] = useState(false);
  const [printCase, setPrintCase] = useState<Surgery | null>(null);

  const all = useMemo(() => sortTheatreList(surgeryList(state)), [state]);
  const dayRows = useMemo(
    () => all.filter((s) => s.date === date && (!room || s.room === room)),
    [all, date, room],
  );
  const day = useMemo(() => otDayStats(state, date), [state, date]);
  const roomsToday = useMemo(
    () => Array.from(new Set(all.filter((s) => s.date === date).map((s) => s.room))).sort(),
    [all, date],
  );
  const bounds = useMemo(() => timelineBounds(dayRows), [dayRows]);
  const inTheatre = dayRows.filter((s) => s.status === "In theatre");
  const unpriced = useMemo(
    () =>
      missingOtRates(
        state,
        dayRows.map((s) => s.procedure),
      ),
    [state, dayRows],
  );

  const listRows = useMemo(() => {
    const rows = status ? all.filter((s) => s.status === status) : all;
    return searchSurgeries(
      rows,
      q,
      (id) => `${state.patients[id]?.name ?? ""} ${state.patients[id]?.mrn ?? ""}`,
    );
  }, [all, status, q, state.patients]);
  const listStats = useMemo(() => surgeryStats(listRows), [listRows]);

  const openNew = () => {
    setForm(blankSurgery(nextSurgeryNo(state), date));
    setFormOpen(true);
  };

  const openEdit = (s: Surgery) => {
    setForm(surgeryToForm(s));
    setFormOpen(true);
  };

  const saveSurgery = () => {
    if (!form.patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!form.procedure.trim()) {
      toast.error("Enter the procedure");
      return;
    }
    if (!form.surgeon.trim()) {
      toast.error("Name the operating surgeon");
      return;
    }
    const existing = form.id ? state.surgeries[form.id] : undefined;
    const record: Surgery = {
      id: form.id ?? crypto.randomUUID(),
      surgeryNo: form.surgeryNo,
      patientId: form.patientId,
      visitId: form.visitId,
      admissionId: form.admissionId,
      date: form.date,
      time: form.time,
      durationMinutes: Math.max(0, Number(form.durationMinutes || 0)),
      room: form.room,
      procedure: form.procedure.trim(),
      code: form.code,
      priority: form.priority,
      surgeon: form.surgeon.trim(),
      assistant: form.assistant,
      anaesthetist: form.anaesthetist,
      anaesthesia: form.anaesthesia,
      diagnosis: form.diagnosis,
      scrubNurse: form.scrubNurse,
      notes: form.notes,
      status: existing?.status ?? "Scheduled",
      checks: normalizeChecks(form.checks),
      startedAt: existing?.startedAt,
      completedAt: existing?.completedAt,
      cancelledAt: existing?.cancelledAt,
      cancelReason: existing?.cancelReason,
      findings: existing?.findings,
      postOpNotes: existing?.postOpNotes,
      chargeBillId: existing?.chargeBillId,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    upsert<Surgery>("surgeries", record);
    toast.success(
      form.id
        ? `OT-${record.surgeryNo} updated`
        : `OT-${record.surgeryNo} booked — ${record.procedure}`,
    );
    setFormOpen(false);
  };

  const startCase = (s: Surgery) => {
    upsert<Surgery>("surgeries", { id: s.id, status: "In theatre", startedAt: Date.now() });
    toast.success(`OT-${s.surgeryNo} — patient in theatre`);
  };

  const cancelCase = (s: Surgery) => {
    const reason = window.prompt(`Why is OT-${s.surgeryNo} (${s.procedure}) cancelled?`) ?? "";
    upsert<Surgery>("surgeries", {
      id: s.id,
      status: "Cancelled",
      cancelledAt: Date.now(),
      cancelReason: reason.trim(),
    });
    toast.success(`OT-${s.surgeryNo} cancelled`);
  };

  const del = (s: Surgery) => {
    if (confirmDelete(`OT-${s.surgeryNo} — ${s.procedure}`)) {
      remove("surgeries", s.id);
      toast.success("Case removed from the theatre list");
    }
  };

  /** Post the theatre charge to the patient's bill — new bill first time, the
      same line refreshed afterwards (never duplicated). */
  const postOtCharges = (s: Surgery) => {
    const charge = orderCharge(state, "OT", s.procedure);
    if (!charge) {
      toast.error("No OT rate for this procedure — set it in Settings → Price list");
      return;
    }
    if (charge.missing.length > 0) {
      toast.error(`No rate for: ${charge.missing.join(", ")} — add it under Settings → Price list`);
      return;
    }
    const tag = `(OT-${s.surgeryNo})`;
    const line = {
      description: `${charge.description} ${tag}`,
      qty: 1,
      rate: charge.amount,
      amount: charge.amount,
    };
    if (s.chargeBillId && state.bills[s.chargeBillId]) {
      const bill = state.bills[s.chargeBillId]!;
      const items = [line, ...bill.items.filter((i) => !i.description.endsWith(tag))];
      const subtotal = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      const totalAmount = subtotal - Number(bill.discount || 0) + Number(bill.tax || 0);
      upsert<Bill>("bills", {
        id: bill.id,
        items,
        totalAmount,
        due: Math.max(0, totalAmount - Number(bill.paid || 0)),
      } as Bill);
      toast.success(`Theatre charges updated on the existing bill — ${money(totalAmount)}`);
    } else {
      const billId = crypto.randomUUID();
      upsert<Bill>("bills", {
        id: billId,
        patientId: s.patientId,
        visitId: s.visitId || "",
        date: todayISO(),
        items: [line],
        totalAmount: charge.amount,
        discount: 0,
        tax: 0,
        paid: 0,
        due: charge.amount,
        paymentMode: BILL_PAYMENT_MODES[0] ?? "Cash",
      } as Bill);
      upsert<Surgery>("surgeries", { id: s.id, chargeBillId: billId });
      toast.success(`Theatre charges posted to a new bill — ${money(charge.amount)}`);
    }
  };

  const exportCsv = () => {
    downloadCsv("theatre-list.csv", [
      [
        "OT no",
        "Date",
        "Time",
        "Duration (min)",
        "Room",
        "Patient",
        "MRN",
        "Procedure",
        "Code",
        "Priority",
        "Surgeon",
        "Assistant",
        "Anaesthetist",
        "Anaesthesia",
        "Scrub nurse",
        "Diagnosis",
        "Status",
        "Started",
        "Completed",
        "Checks ready",
        "Findings",
        "Post-op notes",
        "Cancelled reason",
      ],
      ...listRows.map((s) => [
        `OT-${s.surgeryNo}`,
        s.date,
        s.time,
        s.durationMinutes,
        s.room,
        state.patients[s.patientId]?.name ?? "",
        state.patients[s.patientId]?.mrn ?? "",
        s.procedure,
        s.code,
        s.priority,
        s.surgeon,
        s.assistant,
        s.anaesthetist,
        s.anaesthesia,
        s.scrubNurse,
        s.diagnosis,
        s.status,
        s.startedAt ? fmtDateTime(s.startedAt) : "",
        s.completedAt ? fmtDateTime(s.completedAt) : "",
        `${checksReady(s)}/${(s.checks ?? []).length}`,
        s.findings ?? "",
        s.postOpNotes ?? "",
        s.cancelReason ?? "",
      ]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="OT Scheduling"
        subtitle={
          all.length === 0
            ? "Book operations, run the theatre list and post theatre charges"
            : `${day.total} case${day.total === 1 ? "" : "s"} on ${fmtDate(date)} · ${
                day.inTheatre
              } in theatre · ${Math.round(day.plannedMinutes / 6) / 10} theatre hours planned`
        }
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" onClick={() => setPrintList(true)}>
              <Printer className="h-4 w-4" /> Day list
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> Schedule surgery
            </Button>
          </>
        }
      />

      <div className="mb-4 inline-flex flex-wrap rounded-lg bg-muted p-1">
        {(
          [
            ["day", "Theatre day"],
            ["list", `All cases (${all.length})`],
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

      {tab === "day" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setDate((d) => shiftDate(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
            />
            <Button variant="outline" onClick={() => setDate((d) => shiftDate(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setDate(todayISO())}>
              Today
            </Button>
            <Select className="w-44" value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">All theatres</option>
              {roomsToday.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            {day.next ? (
              <Badge tone="amber">
                Next: {day.next.time} · {day.next.procedure} · {day.next.room}
              </Badge>
            ) : null}
            {day.notReady > 0 ? <Badge tone="red">{day.notReady} not checklist-ready</Badge> : null}
            {unpriced.length > 0 ? (
              <Badge tone="neutral">{unpriced.length} procedure(s) unpriced</Badge>
            ) : null}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cases booked
              </p>
              <p className="mt-1.5 text-2xl font-semibold">{day.total}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                In theatre / done
              </p>
              <p className="mt-1.5 text-2xl font-semibold">
                {day.inTheatre} / {day.completed}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Theatre time planned
              </p>
              <p className="mt-1.5 text-2xl font-semibold">
                {(day.plannedMinutes / 60).toFixed(1)} h
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Emergency cases
              </p>
              <p
                className={cn("mt-1.5 text-2xl font-semibold", day.emergency > 0 && "text-red-700")}
              >
                {day.emergency}
              </p>
            </Card>
          </div>

          {dayRows.length === 0 ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                Nothing on the theatre list for {fmtDate(date)}
                {room ? ` in ${room}` : ""} — schedule a surgery, or step through the dates above.
              </p>
            </Card>
          ) : (
            <>
              <Card className="mb-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Theatre timeline
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {day.running
                      ? `Running: ${day.running.procedure} (${day.running.room})`
                      : date === todayISO()
                        ? "Nothing scheduled for this hour"
                        : "Past list"}
                  </p>
                </div>
                <div className="relative">
                  <div className="relative mb-1 h-4">
                    {bounds.ticks.map((t) => (
                      <span
                        key={t}
                        className="absolute -translate-x-1/2 text-[10px] text-muted-foreground"
                        style={{ left: `${timelinePct(t, bounds)}%` }}
                      >
                        {String(Math.floor(t / 60)).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                  {Array.from(new Set(dayRows.map((s) => s.room)))
                    .sort()
                    .map((r) => (
                      <div key={r} className="flex items-center gap-2 py-1">
                        <span className="w-20 shrink-0 text-xs font-medium text-foreground">
                          {r}
                        </span>
                        <div className="relative h-7 flex-1 rounded bg-muted/70">
                          {dayRows
                            .filter((s) => s.room === r)
                            .map((s) => {
                              const start = minutesOf(s.time);
                              const left = timelinePct(start, bounds);
                              const right = timelinePct(
                                start + Math.max(0, Number(s.durationMinutes || 0)),
                                bounds,
                              );
                              return (
                                <div
                                  key={s.id}
                                  title={`OT-${s.surgeryNo} · ${s.time}–${endsAt(s)} · ${s.procedure} · ${
                                    state.patients[s.patientId]?.name ?? ""
                                  } · ${s.status}`}
                                  style={{
                                    left: `${left}%`,
                                    width: `${Math.max(1.5, right - left)}%`,
                                  }}
                                  className={cn(
                                    "absolute top-0.5 bottom-0.5 overflow-hidden rounded px-1.5 text-[10px] font-medium leading-6 text-white",
                                    s.status === "Completed"
                                      ? "bg-emerald-600"
                                      : s.status === "In theatre"
                                        ? "bg-amber-600"
                                        : s.status === "Cancelled"
                                          ? "bg-slate-400 line-through"
                                          : "bg-accent",
                                  )}
                                >
                                  {s.procedure}
                                </div>
                              );
                            })}
                          {date === todayISO() ? (
                            <span
                              title="Now"
                              className="absolute top-0 bottom-0 w-px bg-red-600"
                              style={{
                                left: `${timelinePct(nowMinutes(), bounds)}%`,
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    ))}
                </div>
              </Card>

              <DataTable
                columns={[
                  "Time",
                  "Room",
                  "OT no",
                  "Patient",
                  "Procedure",
                  "Surgeon / team",
                  "Priority",
                  "Checks",
                  "Status",
                  "Actions",
                  "",
                ]}
                rowCount={dayRows.length}
              >
                {dayRows.map((s) => (
                  <tr key={s.id}>
                    <Td className="whitespace-nowrap">
                      {s.time} – {endsAt(s)}
                      <div className="text-xs text-muted-foreground">{s.durationMinutes} min</div>
                    </Td>
                    <Td className="whitespace-nowrap">{s.room}</Td>
                    <Td className="whitespace-nowrap font-medium">OT-{s.surgeryNo}</Td>
                    <Td>
                      <Link
                        to="/patients/$patientId"
                        params={{ patientId: s.patientId }}
                        className="font-medium text-accent underline"
                      >
                        {state.patients[s.patientId]?.name ?? "—"}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {state.patients[s.patientId]?.mrn ?? ""}
                      </div>
                    </Td>
                    <Td className="max-w-56">
                      {s.procedure}
                      {s.code ? (
                        <div className="text-xs text-muted-foreground">{s.code}</div>
                      ) : null}
                    </Td>
                    <Td className="text-xs">
                      {s.surgeon || "—"}
                      {s.assistant ? (
                        <div className="text-muted-foreground">+ {s.assistant}</div>
                      ) : null}
                      {s.anaesthetist ? (
                        <div className="text-muted-foreground">
                          {s.anaesthesia ? `${s.anaesthesia} · ` : ""}
                          {s.anaesthetist}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      {s.priority === "Emergency" ? (
                        <Badge tone="red">Emergency</Badge>
                      ) : (
                        <Badge tone="neutral">{s.priority}</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      <Badge tone={isReady(s) ? "green" : "amber"}>
                        {checksReady(s)}/{SAFETY_CHECKS.length}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={otTone(s.status)}>{s.status}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {s.status === "Scheduled" ? (
                        <Button
                          variant="outline"
                          className="mr-1 px-2 py-1 text-xs"
                          onClick={() => startCase(s)}
                        >
                          <Activity className="h-3.5 w-3.5" /> Start
                        </Button>
                      ) : null}
                      {s.status === "In theatre" ? (
                        <Button
                          variant="outline"
                          className="mr-1 px-2 py-1 text-xs"
                          onClick={() => setCaseFor(s)}
                        >
                          <Scissors className="h-3.5 w-3.5" /> Complete
                        </Button>
                      ) : null}
                      {s.status === "Completed" ? (
                        <button
                          title="Post theatre charges to the patient's bill"
                          className="mr-1 align-middle text-muted-foreground hover:text-foreground"
                          onClick={() => postOtCharges(s)}
                        >
                          <IndianRupee className="h-4 w-4" />
                        </button>
                      ) : null}
                      {s.status === "Completed" && s.chargeBillId ? (
                        <Badge tone="neutral">billed</Badge>
                      ) : null}
                      {s.status === "Scheduled" || s.status === "In theatre" ? (
                        <button
                          title="Cancel this case"
                          className="align-middle text-muted-foreground hover:text-destructive"
                          onClick={() => cancelCase(s)}
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <button
                        title="Open case sheet"
                        className="mr-2 text-muted-foreground hover:text-foreground"
                        onClick={() => setCaseFor(s)}
                      >
                        <ShieldCheck className="h-4 w-4" />
                      </button>
                      <button
                        title="Print case slip"
                        className="mr-2 text-muted-foreground hover:text-foreground"
                        onClick={() => setPrintCase(s)}
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      <button
                        title="Edit case"
                        className="mr-2 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(s)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        title="Remove from the list"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => del(s)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select
              className="w-52"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All statuses ({all.length})</option>
              {SURGERY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Input
              className="max-w-xs"
              placeholder="Search procedure, patient, surgeon, room…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {listStats.total} cases · {listStats.completed} completed · {listStats.cancelled}{" "}
              cancelled · {listStats.emergency} emergency ·{" "}
              {(listStats.plannedMinutes / 60).toFixed(1)} theatre hours
            </span>
          </div>

          <DataTable
            columns={[
              "Date",
              "Time",
              "OT no",
              "Patient",
              "Procedure",
              "Room",
              "Surgeon",
              "Status",
              "Findings",
              "",
            ]}
            rowCount={listRows.length}
            empty="No operations on the theatre list yet."
          >
            {listRows.map((s) => (
              <tr key={s.id}>
                <Td className="whitespace-nowrap">{fmtDate(s.date)}</Td>
                <Td className="whitespace-nowrap">{s.time}</Td>
                <Td className="whitespace-nowrap font-medium">OT-{s.surgeryNo}</Td>
                <Td>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: s.patientId }}
                    className="text-accent underline"
                  >
                    {state.patients[s.patientId]?.name ?? "—"}
                  </Link>
                </Td>
                <Td className="max-w-56">{s.procedure}</Td>
                <Td className="whitespace-nowrap">{s.room}</Td>
                <Td className="text-xs">{s.surgeon || "—"}</Td>
                <Td>
                  <Badge tone={otTone(s.status)}>{s.status}</Badge>
                </Td>
                <Td className="max-w-56 text-xs text-muted-foreground">
                  {s.findings || s.cancelReason || "—"}
                </Td>
                <Td className="whitespace-nowrap">
                  <button
                    title="Open case sheet"
                    className="mr-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setCaseFor(s)}
                  >
                    <ShieldCheck className="h-4 w-4" />
                  </button>
                  <button
                    title="Print case slip"
                    className="mr-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setPrintCase(s)}
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                  <button
                    title="Edit case"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(s)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </Td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <SurgeryFormModal
        open={formOpen}
        form={form}
        setForm={setForm}
        onClose={() => setFormOpen(false)}
        onSave={saveSurgery}
      />

      <CaseModal
        surgery={caseFor}
        onClose={() => setCaseFor(null)}
        onEdit={(s) => {
          setCaseFor(null);
          openEdit(s);
        }}
        onPrint={(s) => setPrintCase(s)}
        onCharges={(s) => postOtCharges(s)}
      />

      <TheatreListPrint
        open={printList}
        date={date}
        rows={dayRows}
        onClose={() => setPrintList(false)}
      />

      <CaseSlipPrint surgery={printCase} onClose={() => setPrintCase(null)} />
    </div>
  );
}

/* ------------------------------------------------------------- booking */

function SurgeryFormModal({
  open,
  form,
  setForm,
  onClose,
  onSave,
}: {
  open: boolean;
  form: SurgeryForm;
  setForm: React.Dispatch<React.SetStateAction<SurgeryForm>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { state } = useHms();
  const set = <K extends keyof SurgeryForm>(key: K, value: SurgeryForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const admissions = useMemo(
    () =>
      Object.values(state.admissions ?? {})
        .filter((a) => a.patientId === form.patientId)
        .sort((a, b) => (b.admitDate || "").localeCompare(a.admitDate || "")),
    [state.admissions, form.patientId],
  );

  const toggleCheck = (name: string) =>
    setForm((f) => ({
      ...f,
      checks: normalizeChecks(f.checks).map((c) =>
        c.name === name ? { ...c, ready: !c.ready } : c,
      ),
    }));

  const pickAdmission = (id: string) => {
    const adm: Admission | undefined = state.admissions[id];
    setForm((f) => ({
      ...f,
      admissionId: id,
      visitId: f.visitId || adm?.visitId || "",
      diagnosis: f.diagnosis || adm?.reason || "",
      surgeon: f.surgeon || adm?.doctor || "",
    }));
  };

  const ready = checksReady({ checks: form.checks });

  return (
    <Modal
      open={open}
      title={form.id ? `Edit OT-${form.surgeryNo}` : `Schedule surgery — OT-${form.surgeryNo}`}
      onClose={onClose}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Patient" required className="sm:col-span-2">
          <PatientPicker
            value={form.patientId}
            onChange={(id) =>
              setForm((f) => ({ ...f, patientId: id, visitId: "", admissionId: "" }))
            }
          />
        </Field>
        <Field label="Linked visit">
          <VisitPicker
            patientId={form.patientId}
            value={form.visitId}
            onChange={(id) => set("visitId", id)}
          />
        </Field>
        <Field label="IPD stay">
          <Select value={form.admissionId} onChange={(e) => pickAdmission(e.target.value)}>
            <option value="">Not admitted / day care</option>
            {admissions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.admitDate} → {a.dischargeDate || "admitted"} · {a.reason || "IPD"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Theatre date" required>
          <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Planned start" required>
          <Input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
        </Field>
        <Field label="Duration (minutes)">
          <Input
            type="number"
            min={0}
            step={5}
            value={form.durationMinutes}
            onChange={(e) => set("durationMinutes", Number(e.target.value))}
          />
        </Field>
        <Field label="Theatre / room" required>
          <Input list="ot-rooms" value={form.room} onChange={(e) => set("room", e.target.value)} />
          <datalist id="ot-rooms">
            {OT_ROOMS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>

        <Field label="Procedure" required className="sm:col-span-2">
          <Input
            list="ot-procedures"
            placeholder="Laparoscopic appendectomy"
            value={form.procedure}
            onChange={(e) => set("procedure", e.target.value)}
          />
          <datalist id="ot-procedures">
            {COMMON_PROCEDURES.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <Field label="Procedure / package code">
          <Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {SURGERY_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Surgeon" required>
          <DoctorSelect value={form.surgeon} onChange={(v) => set("surgeon", v)} />
        </Field>
        <Field label="Assistant / second surgeon">
          <DoctorSelect value={form.assistant} onChange={(v) => set("assistant", v)} />
        </Field>
        <Field label="Anaesthetist">
          <Input value={form.anaesthetist} onChange={(e) => set("anaesthetist", e.target.value)} />
        </Field>
        <Field label="Anaesthesia">
          <Input
            list="ot-anaesthesia"
            value={form.anaesthesia}
            onChange={(e) => set("anaesthesia", e.target.value)}
          />
          <datalist id="ot-anaesthesia">
            {ANAESTHESIA_TYPES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label="Scrub nurse / theatre assistant">
          <Input value={form.scrubNurse} onChange={(e) => set("scrubNurse", e.target.value)} />
        </Field>
        <Field label="Pre-op / working diagnosis">
          <Input value={form.diagnosis} onChange={(e) => set("diagnosis", e.target.value)} />
        </Field>
        <Field label="Notes for the team" className="sm:col-span-2">
          <Textarea
            placeholder="Implant to keep ready, blood products, positioning, special instructions…"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">
          Safety checklist{" "}
          <span className="text-muted-foreground">
            ({ready}/{SAFETY_CHECKS.length} ready)
          </span>
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {normalizeChecks(form.checks).map((c) => (
            <label key={c.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.ready}
                onChange={() => toggleCheck(c.name)}
                className="h-4 w-4"
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onSave}>{form.id ? "Save case" : "Book surgery"}</Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- case file */

function CaseModal({
  surgery,
  onClose,
  onEdit,
  onPrint,
  onCharges,
}: {
  surgery: Surgery | null;
  onClose: () => void;
  onEdit: (s: Surgery) => void;
  onPrint: (s: Surgery) => void;
  onCharges: (s: Surgery) => void;
}) {
  const { state, upsert } = useHms();
  const [findings, setFindings] = useState("");
  const [postOp, setPostOp] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (surgery && surgery.id !== seededFor) {
    setSeededFor(surgery.id);
    setFindings(surgery.findings ?? "");
    setPostOp(surgery.postOpNotes ?? "");
  }
  if (!surgery) return null;

  const patient = state.patients[surgery.patientId];
  const bill = surgery.chargeBillId ? state.bills[surgery.chargeBillId] : undefined;

  const toggleCheck = (name: string) =>
    upsert<Surgery>("surgeries", {
      id: surgery.id,
      checks: normalizeChecks(surgery.checks).map((c) =>
        c.name === name ? { ...c, ready: !c.ready } : c,
      ),
    });

  const saveNotes = () => {
    upsert<Surgery>("surgeries", {
      id: surgery.id,
      findings: findings.trim(),
      postOpNotes: postOp.trim(),
    });
    toast.success(`OT-${surgery.surgeryNo} — notes saved`);
  };

  const complete = () => {
    if (!findings.trim()) {
      toast.error("Dictate the operative findings before completing the case");
      return;
    }
    upsert<Surgery>("surgeries", {
      id: surgery.id,
      status: "Completed",
      completedAt: Date.now(),
      findings: findings.trim(),
      postOpNotes: postOp.trim(),
    });
    toast.success(`OT-${surgery.surgeryNo} completed`);
    onClose();
  };

  const moveTo = (to: SurgeryStatus) => {
    upsert<Surgery>("surgeries", {
      id: surgery.id,
      status: to,
      startedAt: to === "In theatre" ? Date.now() : surgery.startedAt,
    });
    toast.success(`OT-${surgery.surgeryNo} → ${to}`);
  };

  return (
    <Modal open title={`OT-${surgery.surgeryNo} — ${surgery.procedure}`} onClose={onClose} wide>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Patient:</span>{" "}
          <Link
            to="/patients/$patientId"
            params={{ patientId: surgery.patientId }}
            className="text-accent underline"
          >
            {patient?.name ?? "—"}
          </Link>{" "}
          {patient?.mrn ? <span className="text-muted-foreground">· {patient.mrn}</span> : null}
        </p>
        <p>
          <span className="text-muted-foreground">Listed:</span> {fmtDate(surgery.date)} ·{" "}
          {surgery.time}–{endsAt(surgery)} ({surgery.durationMinutes} min)
        </p>
        <p>
          <span className="text-muted-foreground">Theatre:</span> {surgery.room}
        </p>
        <p>
          <span className="text-muted-foreground">Priority:</span> {surgery.priority}
        </p>
        <p>
          <span className="text-muted-foreground">Surgeon:</span> {surgery.surgeon || "—"}
          {surgery.assistant ? ` · ${surgery.assistant}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Anaesthesia:</span> {surgery.anaesthesia || "—"}
          {surgery.anaesthetist ? ` · ${surgery.anaesthetist}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Scrub nurse:</span> {surgery.scrubNurse || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Code:</span> {surgery.code || "—"}
        </p>
        <p className="sm:col-span-2">
          <span className="text-muted-foreground">Diagnosis:</span> {surgery.diagnosis || "—"}
        </p>
        {surgery.notes ? (
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">Team notes:</span> {surgery.notes}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={otTone(surgery.status)}>{surgery.status}</Badge>
        {surgery.startedAt ? (
          <span className="text-xs text-muted-foreground">
            in at {fmtDateTime(surgery.startedAt)}
            {surgery.completedAt ? ` · out at ${fmtDateTime(surgery.completedAt)}` : ""}
          </span>
        ) : null}
        {surgery.status === "Scheduled" ? (
          <Button className="ml-auto px-2.5 py-1.5 text-xs" onClick={() => moveTo("In theatre")}>
            <Activity className="h-3.5 w-3.5" /> Patient in
          </Button>
        ) : null}
        {surgery.status === "Completed" ? (
          <Button
            variant="outline"
            className="ml-auto px-2.5 py-1.5 text-xs"
            onClick={() => onCharges(surgery)}
          >
            <IndianRupee className="h-3.5 w-3.5" /> Post theatre charges
          </Button>
        ) : null}
      </div>

      {surgery.status === "Cancelled" ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Cancelled {surgery.cancelledAt ? fmtDateTime(surgery.cancelledAt) : ""}
          {surgery.cancelReason ? ` — ${surgery.cancelReason}` : ""}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <Field
          label={
            surgery.status === "In theatre"
              ? "Operative findings (required to complete)"
              : "Operative findings"
          }
        >
          <Textarea
            placeholder="Procedure done, intra-op findings, implants, blood loss, specimens sent…"
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
          />
        </Field>
        <Field label="Post-op instructions">
          <Textarea
            placeholder="NPO till, analgesia, antibiotics, drain care, mobilisation…"
            value={postOp}
            onChange={(e) => setPostOp(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={saveNotes}>
            Save notes
          </Button>
          {surgery.status === "In theatre" ? (
            <Button onClick={complete}>
              <Scissors className="h-4 w-4" /> Complete case
            </Button>
          ) : null}
        </div>
      </div>

      {bill ? (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs">
          Theatre charges on bill {fmtDate(bill.date)} — total {money(bill.totalAmount)}, due{" "}
          <strong>{money(bill.due)}</strong>
        </p>
      ) : null}

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">
          Safety checklist{" "}
          <span className="text-muted-foreground">
            ({checksReady(surgery)}/{SAFETY_CHECKS.length} ready)
          </span>
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {normalizeChecks(surgery.checks).map((c) => (
            <label key={c.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.ready}
                onChange={() => toggleCheck(c.name)}
                className="h-4 w-4"
              />
              {c.name}
            </label>
          ))}
        </div>
        {missingChecks(surgery).length > 0 && surgery.status === "Scheduled" ? (
          <p className="mt-2 text-xs text-amber-700">
            Still to do: {missingChecks(surgery).join(", ")}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => onPrint(surgery)}>
          <Printer className="h-4 w-4" /> Case slip
        </Button>
        <Button variant="outline" onClick={() => onEdit(surgery)}>
          <Pencil className="h-4 w-4" /> Edit case
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- printing */

function TheatreListPrint({
  open,
  date,
  rows,
  onClose,
}: {
  open: boolean;
  date: string;
  rows: Surgery[];
  onClose: () => void;
}) {
  const { state } = useHms();
  if (!open) return null;
  const stats = surgeryStats(rows);
  return (
    <PrintOverlay open title={`Theatre List — ${fmtDate(date)}`} onClose={onClose}>
      <table className="mb-3">
        <thead>
          <tr>
            <th>Time</th>
            <th>Room</th>
            <th>Patient</th>
            <th>Procedure</th>
            <th>Surgeon</th>
            <th>Anaesthesia</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>
                {s.time}–{endsAt(s)}
              </td>
              <td>{s.room}</td>
              <td>
                {state.patients[s.patientId]?.name ?? "—"}
                <br />
                <small>{state.patients[s.patientId]?.mrn ?? ""}</small>
              </td>
              <td>
                {s.procedure}
                {s.priority === "Emergency" ? " (Emergency)" : ""}
              </td>
              <td>
                {s.surgeon}
                {s.assistant ? ` / ${s.assistant}` : ""}
              </td>
              <td>
                {s.anaesthesia}
                {s.anaesthetist ? ` — ${s.anaesthetist}` : ""}
              </td>
              <td>
                {s.status}
                {s.status === "Cancelled" && s.cancelReason ? ` (${s.cancelReason})` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mb-3 text-xs">
        {stats.total} cases · {stats.completed} completed · {stats.cancelled} cancelled ·{" "}
        {stats.emergency} emergency · {(stats.plannedMinutes / 60).toFixed(1)} theatre hours planned
      </p>
      <div className="mt-8 flex justify-between text-sm">
        <span>
          ______________________
          <br />
          OT in-charge
        </span>
        <span>
          ______________________
          <br />
          Theatre nurse
        </span>
      </div>
    </PrintOverlay>
  );
}

function CaseSlipPrint({ surgery, onClose }: { surgery: Surgery | null; onClose: () => void }) {
  const { state } = useHms();
  if (!surgery) return null;
  const patient = state.patients[surgery.patientId];
  return (
    <PrintOverlay open title={`OT Case Slip — OT-${surgery.surgeryNo}`} onClose={onClose}>
      <table className="mb-3">
        <tbody>
          <tr>
            <td style={{ width: "35%" }}>
              <strong>Patient:</strong> {patient?.name ?? "—"}
            </td>
            <td>
              <strong>MRN:</strong> {patient?.mrn ?? "—"}
            </td>
            <td>
              <strong>Age / sex:</strong> {patient?.gender ?? "—"}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Listed:</strong> {fmtDate(surgery.date)}
            </td>
            <td>
              <strong>Time:</strong> {surgery.time}–{endsAt(surgery)}
            </td>
            <td>
              <strong>Theatre:</strong> {surgery.room}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Priority:</strong> {surgery.priority}
            </td>
            <td>
              <strong>Code:</strong> {surgery.code || "—"}
            </td>
            <td>
              <strong>Status:</strong> {surgery.status}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Surgeon:</strong> {surgery.surgeon || "—"}
            </td>
            <td>
              <strong>Assistant:</strong> {surgery.assistant || "—"}
            </td>
            <td>
              <strong>Scrub nurse:</strong> {surgery.scrubNurse || "—"}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Anaesthetist:</strong> {surgery.anaesthetist || "—"}
            </td>
            <td colSpan={2}>
              <strong>Anaesthesia:</strong> {surgery.anaesthesia || "—"}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mb-2">
        <strong>Procedure:</strong> {surgery.procedure}
      </p>
      <p className="mb-3">
        <strong>Diagnosis:</strong> {surgery.diagnosis || "—"}
      </p>
      {surgery.notes ? (
        <p className="mb-3">
          <strong>Team notes:</strong> {surgery.notes}
        </p>
      ) : null}

      <p className="mb-1">
        <strong>Safety checklist:</strong>
      </p>
      <ul className="mb-3 list-inside list-disc">
        {(surgery.checks ?? []).map((c) => (
          <li key={c.name}>
            {c.ready ? "☑" : "☐"} {c.name}
          </li>
        ))}
      </ul>

      <p className="mb-1">
        <strong>Operative findings:</strong> {surgery.findings || "—"}
      </p>
      <p className="mb-3">
        <strong>Post-op instructions:</strong> {surgery.postOpNotes || "—"}
      </p>

      {surgery.startedAt ? (
        <p className="mb-3 text-xs">
          Patient in {fmtDateTime(surgery.startedAt)}
          {surgery.completedAt ? ` · out ${fmtDateTime(surgery.completedAt)}` : ""}
        </p>
      ) : null}

      <div className="mt-8 flex justify-between text-sm">
        <span>
          ______________________
          <br />
          Operating surgeon
        </span>
        <span>
          ______________________
          <br />
          Anaesthetist
        </span>
        <span>
          ______________________
          <br />
          Theatre nurse
        </span>
      </div>
    </PrintOverlay>
  );
}
