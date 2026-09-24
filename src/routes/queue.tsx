import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, ListOrdered, Plus, Printer, Ticket, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useHms } from "@/lib/hms/store";
import { appointmentsOn, nextTokenNo, queueStats, waitingQueue } from "@/lib/hms/selectors";
import { fmtDate, todayISO } from "@/lib/hms/format";
import { APPOINTMENT_TYPES, type Appointment, type AppointmentStatus } from "@/lib/hms/types";
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
import { PatientPicker } from "@/components/hms/pickers";
import { DoctorSelect } from "@/components/hms/DoctorSelect";
import { PrintOverlay } from "@/components/hms/PrintOverlay";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "OPD Token Queue — KEGH HMS" },
      {
        name: "description",
        content: "Live OPD token queue with now-serving, walk-in check-in and printable slips.",
      },
      { property: "og:title", content: "OPD Token Queue — KEGH HMS" },
      {
        property: "og:description",
        content: "Live OPD token queue with now-serving, walk-in check-in and printable slips.",
      },
    ],
  }),
  component: QueuePage,
});

function hhmmNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusTone(s: AppointmentStatus): "green" | "amber" | "red" | "neutral" {
  if (s === "Completed") return "green";
  if (s === "CheckedIn") return "amber";
  if (s === "Cancelled" || s === "NoShow") return "red";
  return "neutral";
}

const blankWalkIn = (): Partial<Appointment> => ({
  patientId: "",
  doctor: "",
  department: "",
  type: "OPD",
  notes: "",
});

function QueuePage() {
  const { state, settings, upsert } = useHms();
  const today = todayISO();

  const [date, setDate] = useState(today);
  const [doctor, setDoctor] = useState("");
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkIn, setWalkIn] = useState<Partial<Appointment>>(blankWalkIn);
  const [slip, setSlip] = useState<Appointment | null>(null);
  const [board, setBoard] = useState(false);

  const stats = useMemo(() => queueStats(state, date), [state, date]);

  /** The day's list narrowed to the doctor filter, if one is set. */
  const visible = useMemo(() => {
    const day = appointmentsOn(state, date);
    return doctor ? day.filter((a) => a.doctor === doctor) : day;
  }, [state, date, doctor]);

  const waiting = useMemo(() => {
    const list = waitingQueue(state, date);
    return doctor ? list.filter((a) => a.doctor === doctor) : list;
  }, [state, date, doctor]);

  const notCheckedIn = visible.filter((a) => a.status === "Scheduled" || a.status === "Confirmed");
  const closed = visible.filter(
    (a) => a.status === "Completed" || a.status === "Cancelled" || a.status === "NoShow",
  );
  const nowServing = waiting[0] ?? null;
  /** Full-day queue (ignores the doctor filter) — used by the counter board. */
  const fullQueue = useMemo(() => waitingQueue(state, date), [state, date]);

  /** Doctors appearing in today's list plus the configured list, for the filter. */
  const doctorOptions = useMemo(() => {
    const set = new Set<string>(settings.doctors ?? []);
    Object.values(state.appointments ?? {}).forEach((a) => a.doctor && set.add(a.doctor));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [settings.doctors, state.appointments]);

  /** Patients ahead of this token in the live queue. */
  const aheadOf = (a: Appointment) =>
    waitingQueue(state, a.date).filter(
      (w) => w.id !== a.id && Number(w.tokenNo ?? 0) < Number(a.tokenNo ?? 0),
    ).length;

  const update = (a: Appointment, patch: Partial<Appointment>) =>
    upsert<Appointment>("appointments", { ...a, ...patch });

  const checkIn = (a: Appointment) => {
    const token = nextTokenNo(state, a.date);
    update(a, { status: "CheckedIn", tokenNo: token, tokenTime: hhmmNow() });
    toast.success(`Token ${token} issued`);
  };

  const saveWalkIn = () => {
    if (!walkIn.patientId) {
      toast.error("Select a patient");
      return;
    }
    const token = nextTokenNo(state, today);
    const now = hhmmNow();
    upsert<Appointment>("appointments", {
      ...walkIn,
      date: today,
      time: now,
      type: walkIn.type ?? "OPD",
      status: "CheckedIn",
      tokenNo: token,
      tokenTime: now,
    } as Appointment);
    toast.success(`Walk-in checked in with token ${token}`);
    setWalkInOpen(false);
  };

  const walkInToken = nextTokenNo(state, today);

  return (
    <div className="space-y-5">
      <PageHeader
        title="OPD token queue"
        subtitle={`${fmtDate(date)} · ${stats.waiting} waiting · ${stats.completed} completed · ${stats.tokens} tokens issued`}
        actions={
          <>
            <Button variant="outline" onClick={() => setBoard(true)}>
              <ListOrdered className="h-4 w-4" /> Print board
            </Button>
            <Button
              onClick={() => {
                setWalkIn(blankWalkIn());
                setWalkInOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4" /> Walk-in check-in
            </Button>
          </>
        }
      />

      <div className="grid items-end gap-3 sm:grid-cols-3">
        <Field label="Queue date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Doctor">
          <Select value={doctor} onChange={(e) => setDoctor(e.target.value)}>
            <option value="">All doctors</option>
            {doctorOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          {date !== today ? (
            <Button variant="ghost" onClick={() => setDate(today)}>
              Back to today
            </Button>
          ) : null}
        </div>
      </div>

      {/* Now serving */}
      {nowServing ? (
        <Card className="sidebar-gradient text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-white/70">
                Now serving · token {nowServing.tokenNo ?? "—"}
              </p>
              <h2 className="text-xl font-bold">
                {state.patients[nowServing.patientId]?.name ?? "—"}
              </h2>
              <p className="mt-1 text-sm text-white/80">
                {nowServing.doctor || "No doctor"}
                {nowServing.department ? ` · ${nowServing.department}` : ""} · {nowServing.type}
                {nowServing.tokenTime ? ` · checked in ${nowServing.tokenTime}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10"
                onClick={() => setSlip(nowServing)}
              >
                <Ticket className="h-4 w-4" /> Token slip
              </Button>
              <Button
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10"
                onClick={() => {
                  update(nowServing, { status: "NoShow" });
                  toast.success("Marked no-show");
                }}
              >
                <XCircle className="h-4 w-4" /> No show
              </Button>
              <Button
                onClick={() => {
                  update(nowServing, { status: "Completed" });
                  toast.success("Consultation done");
                }}
              >
                <CheckCircle2 className="h-4 w-4" /> Consultation done
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nobody is waiting on {fmtDate(date)}. Check in an appointment or add a walk-in to start
            the list.
          </p>
        </Card>
      )}

      {/* Waiting list */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Waiting{doctor ? ` · ${doctor}` : ""}
          </h3>
          <Badge tone={waiting.length ? "amber" : "neutral"}>{waiting.length} waiting</Badge>
        </div>
        <DataTable
          columns={["Token", "Patient", "Doctor", "Type", "Checked in", "Status", ""]}
          rowCount={waiting.length}
          empty="Nobody is in the waiting list."
        >
          {waiting.map((a) => (
            <tr key={a.id}>
              <Td>
                <Badge tone="neutral">{a.tokenNo ?? "—"}</Badge>
              </Td>
              <Td>
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: a.patientId }}
                  className="text-accent underline"
                >
                  {state.patients[a.patientId]?.name ?? "—"}
                </Link>
              </Td>
              <Td>{a.doctor || "—"}</Td>
              <Td>{a.type}</Td>
              <Td className="whitespace-nowrap">{a.tokenTime || "—"}</Td>
              <Td>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap">
                <div className="flex items-center gap-1">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    title="Print token slip"
                    onClick={() => setSlip(a)}
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      update(a, { status: "Completed" });
                      toast.success("Consultation done");
                    }}
                  >
                    Complete
                  </button>
                  <button
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      update(a, { status: "NoShow" });
                      toast.success("Marked no-show");
                    }}
                  >
                    No show
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      </div>

      {/* Booked today but not checked in */}
      <Card>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Not checked in yet
        </h3>
        {notCheckedIn.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nothing pending — every appointment for {fmtDate(date)} is checked in or closed.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {notCheckedIn.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{a.time || "—"}</span>
                <span className="font-medium">{state.patients[a.patientId]?.name ?? "—"}</span>
                <span className="text-muted-foreground">{a.doctor || "No doctor"}</span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                <button
                  className="ml-auto rounded px-2 py-1 text-xs text-accent underline"
                  onClick={() => checkIn(a)}
                >
                  Check in
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Closed */}
      {closed.length > 0 ? (
        <Card>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Closed on {fmtDate(date)}
          </h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {closed.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span>
                  {a.tokenNo ? `#${a.tokenNo} · ` : ""}
                  {state.patients[a.patientId]?.name ?? "—"} · {a.doctor || "No doctor"}
                </span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Walk-in check-in */}
      <Modal open={walkInOpen} onClose={() => setWalkInOpen(false)} title="Walk-in check-in" wide>
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Issues token <strong className="text-foreground">{walkInToken}</strong> for{" "}
          {fmtDate(today)} and puts the patient straight into the waiting list.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker
              value={walkIn.patientId ?? ""}
              onChange={(id) => setWalkIn((f) => ({ ...f, patientId: id }))}
            />
          </Field>
          <Field label="Doctor" className="sm:col-span-2">
            <DoctorSelect
              value={walkIn.doctor ?? ""}
              onChange={(d) => setWalkIn((f) => ({ ...f, doctor: d }))}
            />
          </Field>
          <Field label="Department">
            <Input
              value={walkIn.department ?? ""}
              placeholder="OPD"
              onChange={(e) => setWalkIn((f) => ({ ...f, department: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <Select
              value={walkIn.type ?? "OPD"}
              onChange={(e) =>
                setWalkIn((f) => ({ ...f, type: e.target.value as Appointment["type"] }))
              }
            >
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              value={walkIn.notes ?? ""}
              placeholder="Complaint, instruction…"
              onChange={(e) => setWalkIn((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setWalkInOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveWalkIn}>
            <Plus className="h-4 w-4" /> Issue token {walkInToken}
          </Button>
        </div>
      </Modal>

      {/* Printable token slip */}
      <PrintOverlay open={Boolean(slip)} title="OPD Token Slip" onClose={() => setSlip(null)}>
        {slip ? (
          <div>
            <div className="mb-4 border-2 border-dashed border-slate-400 p-4 text-center">
              <p className="text-xs uppercase tracking-wide">Token number</p>
              <p className="text-5xl font-bold">{slip.tokenNo ?? "—"}</p>
              <p className="mt-1 text-xs">{fmtDate(slip.date)}</p>
            </div>
            <table>
              <tbody>
                <tr>
                  <th className="w-36">Patient</th>
                  <td>{state.patients[slip.patientId]?.name ?? "—"}</td>
                </tr>
                <tr>
                  <th>MRN</th>
                  <td>{state.patients[slip.patientId]?.mrn ?? "—"}</td>
                </tr>
                <tr>
                  <th>Doctor</th>
                  <td>{slip.doctor || "—"}</td>
                </tr>
                <tr>
                  <th>Department</th>
                  <td>{slip.department || "—"}</td>
                </tr>
                <tr>
                  <th>Visit type</th>
                  <td>{slip.type}</td>
                </tr>
                <tr>
                  <th>Checked in at</th>
                  <td>{slip.tokenTime || slip.time || "—"}</td>
                </tr>
                <tr>
                  <th>Patients ahead</th>
                  <td>{aheadOf(slip)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">
              Please wait for your token number to be called at the consultation room.
            </p>
          </div>
        ) : null}
      </PrintOverlay>

      {/* Printable queue board for the counter display */}
      <PrintOverlay
        open={board}
        title={`OPD Queue Board — ${fmtDate(date)}`}
        onClose={() => setBoard(false)}
      >
        <p className="mb-3 text-sm">
          {stats.waiting} waiting · {stats.completed} completed · {stats.tokens} tokens issued
        </p>
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Type</th>
              <th>Checked in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {fullQueue.map((a, i) => (
              <tr key={a.id} className={i === 0 ? "font-bold" : ""}>
                <td>{a.tokenNo ?? "—"}</td>
                <td>{state.patients[a.patientId]?.name ?? "—"}</td>
                <td>{a.doctor || "—"}</td>
                <td>{a.type}</td>
                <td>{a.tokenTime || "—"}</td>
                <td>{i === 0 ? "Now serving" : a.status}</td>
              </tr>
            ))}
            {fullQueue.length === 0 ? (
              <tr>
                <td colSpan={6}>Nobody is waiting.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </PrintOverlay>
    </div>
  );
}
